import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { createPrivateGateway } from "../bridge/private-gateway.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("private gateway authenticates, strips the token, and proxies UI/API", async (t) => {
  const ui = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("scope-ui");
  });
  const bridge = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      method: request.method,
      url: request.url,
      body: Buffer.concat(chunks).toString("utf8"),
      leakedCookie: Boolean(request.headers.cookie),
      leakedOrigin: Boolean(request.headers.origin),
    }));
  });
  const uiTarget = await listen(ui);
  const bridgeTarget = await listen(bridge);
  const token = "test-token-that-is-definitely-longer-than-32-characters";
  const gateway = createPrivateGateway({ token, uiTarget, bridgeTarget });
  const gatewayUrl = await listen(gateway);
  t.after(async () => {
    await Promise.all([close(gateway), close(ui), close(bridge)]);
  });

  const denied = await fetch(gatewayUrl);
  assert.equal(denied.status, 401);
  assert.match(await denied.text(), /SCOPE 私有访问/);

  const invalid = await fetch(`${gatewayUrl}/?token=wrong`, {
    redirect: "manual",
  });
  assert.equal(invalid.status, 401);

  const bootstrap = await fetch(
    `${gatewayUrl}/somewhere?token=${encodeURIComponent(token)}&view=jobs`,
    { redirect: "manual" },
  );
  assert.equal(bootstrap.status, 303);
  assert.equal(bootstrap.headers.get("location"), "/somewhere?view=jobs");
  const setCookie = bootstrap.headers.get("set-cookie");
  assert.match(setCookie ?? "", /HttpOnly/i);
  assert.match(setCookie ?? "", /Secure/i);
  assert.match(setCookie ?? "", /SameSite=Strict/i);
  assert.doesNotMatch(setCookie ?? "", new RegExp(token));
  const cookie = setCookie.split(";", 1)[0];

  const uiResponse = await fetch(gatewayUrl, {
    headers: { cookie },
  });
  assert.equal(uiResponse.status, 200);
  assert.equal(await uiResponse.text(), "scope-ui");

  const apiResponse = await fetch(`${gatewayUrl}/scope-api/api/refresh?full=1`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ refresh: true }),
  });
  assert.equal(apiResponse.status, 200);
  assert.deepEqual(await apiResponse.json(), {
    method: "POST",
    url: "/api/refresh?full=1",
    body: '{"refresh":true}',
    leakedCookie: false,
    leakedOrigin: false,
  });

  const rejectedWrite = await fetch(
    `${gatewayUrl}/scope-api/api/session/instruct`,
    {
      method: "POST",
      headers: {
        cookie,
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  assert.equal(rejectedWrite.status, 403);
});

test("private gateway refuses non-loopback upstreams and weak tokens", () => {
  assert.throws(
    () => createPrivateGateway({ token: "short" }),
    /at least 32 characters/,
  );
  assert.throws(
    () =>
      createPrivateGateway({
        token: "a".repeat(32),
        uiTarget: "http://192.0.2.1:3000",
      }),
    /loopback URL/,
  );
});

test("private gateway authenticates and routes terminal WebSockets to Bridge", async (t) => {
  const ui = http.createServer((_request, response) => response.end("ui"));
  const bridge = http.createServer((_request, response) => response.end("bridge"));
  const terminalServer = new WebSocketServer({ noServer: true });
  bridge.on("upgrade", (request, socket, head) => {
    terminalServer.handleUpgrade(request, socket, head, (webSocket) => {
      terminalServer.emit("connection", webSocket, request);
    });
  });
  terminalServer.on("connection", (webSocket, request) => {
    webSocket.send(JSON.stringify({
      url: request.url,
      leakedCookie: Boolean(request.headers.cookie),
      leakedOrigin: Boolean(request.headers.origin),
    }));
  });

  const uiTarget = await listen(ui);
  const bridgeTarget = await listen(bridge);
  const token = "terminal-test-token-that-is-longer-than-thirty-two-characters";
  const gateway = createPrivateGateway({ token, uiTarget, bridgeTarget });
  const gatewayUrl = await listen(gateway);
  t.after(async () => {
    terminalServer.close();
    await Promise.all([close(gateway), close(ui), close(bridge)]);
  });

  const bootstrap = await fetch(`${gatewayUrl}/?token=${encodeURIComponent(token)}`, {
    redirect: "manual",
  });
  const cookie = bootstrap.headers.get("set-cookie").split(";", 1)[0];
  const socketUrl = gatewayUrl.replace(/^http/, "ws") +
    "/scope-api/terminal?host=gpu-box&mode=shell";
  const result = await new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl, {
      headers: { cookie, origin: gatewayUrl },
    });
    socket.once("message", (payload) => {
      resolve(JSON.parse(payload.toString("utf8")));
      socket.close();
    });
    socket.once("error", reject);
  });

  assert.deepEqual(result, {
    url: "/terminal?host=gpu-box&mode=shell",
    leakedCookie: false,
    leakedOrigin: false,
  });
});

test("shared gateway rejects unlisted socket peers even with spoofed forwarding headers", async (t) => {
  const gateway = createPrivateGateway({ token: "a".repeat(40), allowedClients: ["192.0.2.1"] });
  const url = await listen(gateway);
  t.after(() => close(gateway));
  const denied = await fetch(url + "/scope-auth", { method: "POST", headers: { "x-forwarded-for": "192.0.2.1" }, body: "token=" + "a".repeat(40) });
  assert.equal(denied.status, 403);
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url.replace("http:", "ws:") + "/scope-api/terminal");
    socket.on("unexpected-response", (_request, response) => { assert.equal(response.statusCode, 403); response.resume(); socket.terminate(); resolve(); });
    socket.on("error", () => {});
    socket.on("open", () => { socket.close(); reject(Error("unexpected access")); });
  });
});
