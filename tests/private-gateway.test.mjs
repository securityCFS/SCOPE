import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import {
  createLoginCode,
  createPrivateGateway,
  inferDeviceName,
  listTrustedDevices,
  loadOrCreatePrivateAccessToken,
  parsePortProxyPath,
  revokeTrustedDevice,
  rewritePortProxyHtml,
  rewritePortProxyLocation,
} from "../bridge/private-gateway.mjs";

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
  const stateDir = mkdtempSync(path.join(tmpdir(), "scope-login-code-"));
  const stateFile = path.join(stateDir, "private-access.json");
  writeFileSync(stateFile, JSON.stringify({ token, trustedDevices: [] }));
  const gateway = createPrivateGateway({ token, stateFile, uiTarget, bridgeTarget });
  const gatewayUrl = await listen(gateway);
  t.after(async () => {
    rmSync(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await Promise.all([close(gateway), close(ui), close(bridge)]);
  });

  const denied = await fetch(gatewayUrl);
  assert.equal(denied.status, 401);
  assert.match(await denied.text(), /SCOPE 私有访问/);

  const invalid = await fetch(`${gatewayUrl}/?token=wrong`, {
    redirect: "manual",
  });
  assert.equal(invalid.status, 401);

  // A legacy master-token link is stripped from the URL but no longer signs in.
  const legacy = await fetch(
    `${gatewayUrl}/somewhere?token=${encodeURIComponent(token)}&view=jobs`,
    { redirect: "manual" },
  );
  assert.equal(legacy.status, 303);
  assert.equal(legacy.headers.get("location"), "/somewhere?view=jobs");
  assert.equal(legacy.headers.get("set-cookie"), null);

  const { code } = await createLoginCode(stateFile);
  assert.equal(readFileSync(stateFile, "utf8").includes(code), false);
  const bootstrap = await fetch(
    `${gatewayUrl}/somewhere?scope_login=${encodeURIComponent(code)}&view=jobs`,
    { redirect: "manual" },
  );
  assert.equal(bootstrap.status, 303);
  assert.equal(bootstrap.headers.get("location"), "/somewhere?view=jobs");
  const setCookie = bootstrap.headers.get("set-cookie");
  assert.match(setCookie ?? "", /HttpOnly/i);
  assert.match(setCookie ?? "", /Secure/i);
  assert.match(setCookie ?? "", /SameSite=Lax/i);
  assert.match(setCookie ?? "", /Expires=/i);
  assert.doesNotMatch(setCookie ?? "", new RegExp(token));
  const cookie = setCookie.split(";", 1)[0];

  // Login codes are single-use.
  const replay = await fetch(`${gatewayUrl}/?scope_login=${encodeURIComponent(code)}`, { redirect: "manual" });
  assert.equal(replay.status, 401);
  assert.match(await replay.text(), /一次性登录链接无效/);
  assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).loginCodes.length, 0);

  // Expired codes are rejected.
  const expired = await createLoginCode(stateFile, { ttlMs: -1 });
  const late = await fetch(`${gatewayUrl}/?scope_login=${encodeURIComponent(expired.code)}`, { redirect: "manual" });
  assert.equal(late.status, 401);

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

  const bootstrap = await fetch(`${gatewayUrl}/scope-auth`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
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

test("port proxy path, redirect, and HTML rewriting helpers handle subpaths safely", () => {
  assert.deepEqual(parsePortProxyPath("/scope-port/4871"), {
    port: 4871,
    suffix: "",
    needsTrailingSlash: true,
  });
  assert.deepEqual(parsePortProxyPath("/scope-port/4871/assets/app.js"), {
    port: 4871,
    suffix: "/assets/app.js",
    needsTrailingSlash: false,
  });
  assert.equal(parsePortProxyPath("/scope-port/99999/"), null);
  assert.equal(parsePortProxyPath("/scope-port/abc/"), null);

  assert.equal(rewritePortProxyLocation("/login?next=/", 4871), "/scope-port/4871/login?next=/");
  assert.equal(rewritePortProxyLocation("/scope-port/4871/done", 4871), "/scope-port/4871/done");
  assert.equal(rewritePortProxyLocation("http://127.0.0.1:4871/app?x=1", 4871), "/scope-port/4871/app?x=1");
  assert.equal(rewritePortProxyLocation("http://localhost:4871/app", 4871), "/scope-port/4871/app");
  assert.equal(rewritePortProxyLocation("https://example.com/out", 4871), "https://example.com/out");

  const html = '<!doctype html><html><head><title>App</title><link rel="stylesheet" href="/css/main.css"></head><body><script src="/js/app.js"></script><script src="//cdn.example.com/lib.js"></script><a href="/scope-port/4871/keep">keep</a><form action="/submit"></form></body></html>';
  const rewritten = rewritePortProxyHtml(html, 4871);
  assert.match(rewritten, /<head><base href="\/scope-port\/4871\/"><title>App<\/title>/);
  assert.match(rewritten, /href="\/scope-port\/4871\/css\/main\.css"/);
  assert.match(rewritten, /src="\/scope-port\/4871\/js\/app\.js"/);
  assert.match(rewritten, /src="\/\/cdn\.example\.com\/lib\.js"/);
  assert.match(rewritten, /href="\/scope-port\/4871\/keep"/);
  assert.match(rewritten, /action="\/scope-port\/4871\/submit"/);
});

test("private gateway proxies authenticated allowlisted /scope-port HTTP & WebSockets and blocks unregistered/control ports", async (t) => {
  const ui = http.createServer((_request, response) => response.end("ui"));
  const allowedForwards = [];

  const appServer = http.createServer((request, response) => {
    if (request.url === "/redirect-rel") {
      response.writeHead(302, { Location: "/dashboard?tab=1" });
      response.end();
      return;
    }
    if (request.url === "/redirect-abs") {
      const port = appServer.address().port;
      response.writeHead(302, { Location: `http://127.0.0.1:${port}/hello` });
      response.end();
      return;
    }
    if (request.url === "/inspect") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        url: request.url,
        cookie: request.headers.cookie || "",
        prefix: request.headers["x-forwarded-prefix"] || "",
      }));
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": [
        "app_session=ok; Path=/; Domain=localhost",
        "scope_private=hijack; Path=/",
      ],
    });
    response.end('<html><head><title>Demo</title></head><body><script src="/bundle.js"></script></body></html>');
  });

  const appWs = new WebSocketServer({ noServer: true });
  appServer.on("upgrade", (request, socket, head) => {
    appWs.handleUpgrade(request, socket, head, (ws) => {
      ws.send(JSON.stringify({
        url: request.url,
        cookie: request.headers.cookie || "",
      }));
    });
  });

  const bridge = http.createServer((request, response) => {
    if (request.url === "/api/port-forwards") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ forwards: allowedForwards }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/port-forwards/stop") {
      allowedForwards.length = 0;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const uiTarget = await listen(ui);
  const bridgeTarget = await listen(bridge);
  const appTarget = await listen(appServer);
  const uiPort = new URL(uiTarget).port;
  const bridgePort = new URL(bridgeTarget).port;
  const appPort = Number(new URL(appTarget).port);
  const token = "port-proxy-test-token-that-is-well-over-thirty-two-chars";
  const gateway = createPrivateGateway({ token, uiTarget, bridgeTarget });
  const gatewayUrl = await listen(gateway);

  t.after(async () => {
    appWs.close();
    await Promise.all([close(gateway), close(ui), close(bridge), close(appServer)]);
  });

  // Unauthenticated access returns 401
  const unauth = await fetch(`${gatewayUrl}/scope-port/${appPort}/`);
  assert.equal(unauth.status, 401);

  const bootstrap = await fetch(`${gatewayUrl}/scope-auth`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  const cookie = bootstrap.headers.get("set-cookie").split(";", 1)[0];

  // Unregistered port returns 403
  const beforeAllow = await fetch(`${gatewayUrl}/scope-port/${appPort}/`, {
    headers: { cookie },
  });
  assert.equal(beforeAllow.status, 403);

  // Even if Bridge listed UI/Bridge/4815 ports, gateway hard-blocks them
  allowedForwards.push(
    { host: "@local", remotePort: Number(bridgePort), localPort: Number(bridgePort), status: "connected" },
    { host: "@local", remotePort: Number(uiPort), localPort: Number(uiPort), status: "connected" },
    { host: "@local", remotePort: 4815, localPort: 4815, status: "connected" },
    { host: "@local", remotePort: appPort, localPort: appPort, localHost: "127.0.0.1", status: "connected" },
  );
  assert.equal(
    (await fetch(`${gatewayUrl}/scope-port/${bridgePort}/`, { headers: { cookie } })).status,
    403,
  );
  assert.equal(
    (await fetch(`${gatewayUrl}/scope-port/${uiPort}/`, { headers: { cookie } })).status,
    403,
  );
  assert.equal(
    (await fetch(`${gatewayUrl}/scope-port/4815/`, { headers: { cookie } })).status,
    403,
  );

  // Bare /scope-port/<port> redirects 307 to trailing slash preserving query
  const bare = await fetch(`${gatewayUrl}/scope-port/${appPort}?v=2`, {
    headers: { cookie },
    redirect: "manual",
  });
  assert.equal(bare.status, 307);
  assert.equal(bare.headers.get("location"), `/scope-port/${appPort}/?v=2`);

  // Proxied HTML injects <base>, rewrites root-absolute attrs, scopes Set-Cookie, drops reserved cookie & strict CSP
  const htmlRes = await fetch(`${gatewayUrl}/scope-port/${appPort}/`, {
    headers: { cookie },
  });
  assert.equal(htmlRes.status, 200);
  assert.equal(htmlRes.headers.get("content-security-policy"), null);
  assert.equal(htmlRes.headers.get("x-frame-options"), "SAMEORIGIN");
  const setCookies = htmlRes.headers.getSetCookie();
  assert.equal(setCookies.length, 1);
  assert.match(setCookies[0], /app_session=ok/);
  assert.match(setCookies[0], new RegExp(`Path=/scope-port/${appPort}/`));
  assert.doesNotMatch(setCookies[0], /Domain=/i);
  const htmlBody = await htmlRes.text();
  assert.match(htmlBody, new RegExp(`<base href="/scope-port/${appPort}/">`));
  assert.match(htmlBody, new RegExp(`src="/scope-port/${appPort}/bundle\\.js"`));

  // Gateway strips scope_private & CF_Authorization while forwarding app cookies
  const inspectRes = await fetch(`${gatewayUrl}/scope-port/${appPort}/inspect`, {
    headers: { cookie: `${cookie}; CF_Authorization=cf-secret; app_session=ok` },
  });
  assert.deepEqual(await inspectRes.json(), {
    url: "/inspect",
    cookie: "app_session=ok",
    prefix: `/scope-port/${appPort}`,
  });

  // Redirect rewriting (relative & loopback absolute)
  const redirRel = await fetch(`${gatewayUrl}/scope-port/${appPort}/redirect-rel`, {
    headers: { cookie },
    redirect: "manual",
  });
  assert.equal(redirRel.status, 302);
  assert.equal(redirRel.headers.get("location"), `/scope-port/${appPort}/dashboard?tab=1`);

  const redirAbs = await fetch(`${gatewayUrl}/scope-port/${appPort}/redirect-abs`, {
    headers: { cookie },
    redirect: "manual",
  });
  assert.equal(redirAbs.status, 302);
  assert.equal(redirAbs.headers.get("location"), `/scope-port/${appPort}/hello`);

  // WebSocket upgrade proxies cleanly and strips prefix & gateway cookie
  const wsResult = await new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${gatewayUrl.replace(/^http/, "ws")}/scope-port/${appPort}/ws?room=demo`,
      { headers: { cookie: `${cookie}; app_session=ok`, origin: gatewayUrl } },
    );
    socket.once("message", (payload) => {
      resolve(JSON.parse(payload.toString("utf8")));
      socket.close();
    });
    socket.once("error", reject);
  });
  assert.deepEqual(wsResult, {
    url: "/ws?room=demo",
    cookie: "app_session=ok",
  });

  // Stopping the forward via /scope-api/api/port-forwards/stop immediately revokes HTTP & WS access
  const stopRes = await fetch(`${gatewayUrl}/scope-api/api/port-forwards/stop`, {
    method: "POST",
    headers: { cookie, origin: gatewayUrl, "content-type": "application/json" },
    body: JSON.stringify({ host: "@local", remotePort: appPort }),
  });
  assert.equal(stopRes.status, 200);

  const afterRevoke = await fetch(`${gatewayUrl}/scope-port/${appPort}/`, {
    headers: { cookie },
  });
  assert.equal(afterRevoke.status, 403);

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${gatewayUrl.replace(/^http/, "ws")}/scope-port/${appPort}/ws`,
      { headers: { cookie, origin: gatewayUrl } },
    );
    socket.on("unexpected-response", (_req, response) => {
      assert.equal(response.statusCode, 403);
      response.resume();
      socket.terminate();
      resolve();
    });
    socket.on("error", () => {});
    socket.on("open", () => {
      socket.close();
      reject(new Error("WebSocket should have been revoked"));
    });
  });
});

test("private gateway supports persistent trusted devices, rename, per-device & live CLI revocation, and session upgrade", async (t) => {
  assert.equal(
    inferDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1"),
    "iPhone (Safari)",
  );
  assert.equal(
    inferDeviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0"),
    "Windows (Edge)",
  );

  const dir = mkdtempSync(path.join(tmpdir(), "scope-trusted-devices-"));
  const stateFile = path.join(dir, "private-access.json");
  const token = await loadOrCreatePrivateAccessToken(stateFile);
  const ui = http.createServer((_request, response) => response.end("ui-ok"));
  const bridge = http.createServer((_request, response) => response.end("{}"));
  const uiTarget = await listen(ui);
  const bridgeTarget = await listen(bridge);
  const gateway = createPrivateGateway({
    token,
    stateFile,
    uiTarget,
    bridgeTarget,
    trustedDeviceDays: 90,
  });
  const gatewayUrl = await listen(gateway);

  t.after(async () => {
    await Promise.all([close(gateway), close(ui), close(bridge)]);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  // 1. Login page includes username autocomplete & trusted device checkbox
  const loginHtml = await (await fetch(gatewayUrl)).text();
  assert.match(loginHtml, /autocomplete="username"/);
  assert.match(loginHtml, /name="trustDevice"/);

  // 2. Sign in with trustDevice=1 on Device A (iPhone)
  const loginA = await fetch(`${gatewayUrl}/scope-auth`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) Version/18.2 Mobile Safari/604.1",
    },
    body: new URLSearchParams({
      token,
      trustDevice: "1",
      deviceName: "My iPhone 16",
      next: "/?view=chat",
    }).toString(),
  });
  assert.equal(loginA.status, 303);
  assert.equal(loginA.headers.get("location"), "/?view=chat");
  const setCookieA = loginA.headers.get("set-cookie") || "";
  assert.match(setCookieA, /scope_private=d\.dev_[a-f0-9]+\./);
  assert.match(setCookieA, /SameSite=Lax/i);
  assert.match(setCookieA, /Max-Age=7776000/i);
  assert.match(setCookieA, /Expires=/i);
  const cookieA = setCookieA.split(";", 1)[0];
  const rawSecretA = cookieA.split(".")[2];

  // Raw device secret must NEVER be stored in private-access.json
  const rawStateText = readFileSync(stateFile, "utf8");
  assert.equal(rawStateText.includes(rawSecretA), false);

  // 3. Inspect /scope-auth/session on Device A
  const sessionA = await (
    await fetch(`${gatewayUrl}/scope-auth/session`, {
      headers: { cookie: cookieA },
    })
  ).json();
  assert.equal(sessionA.gateway, true);
  assert.equal(sessionA.authMode, "trusted-device");
  assert.equal(sessionA.trustedDeviceDays, 90);
  assert.equal(sessionA.devices.length, 1);
  assert.equal(sessionA.devices[0].name, "My iPhone 16");
  assert.equal(sessionA.devices[0].current, true);
  assert.equal("tokenHash" in sessionA.devices[0], false);
  const deviceAId = sessionA.currentDeviceId;

  // 4. Rename Device A via PATCH /scope-auth/devices/:id
  const renameRes = await fetch(`${gatewayUrl}/scope-auth/devices/${deviceAId}`, {
    method: "PATCH",
    headers: { cookie: cookieA, "content-type": "application/json" },
    body: JSON.stringify({ name: "iPhone Pro" }),
  });
  assert.equal(renameRes.status, 200);
  const renamed = await renameRes.json();
  assert.equal(renamed.device.name, "iPhone Pro");

  // 5. Sign in as temporary session (unchecked trustDevice) on Device B, then upgrade to trusted
  const loginB = await fetch(`${gatewayUrl}/scope-auth`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  assert.equal(loginB.status, 303);
  const setCookieB = loginB.headers.get("set-cookie") || "";
  assert.match(setCookieB, /Max-Age=86400/i);
  const cookieBTemp = setCookieB.split(";", 1)[0];

  const sessionBTemp = await (
    await fetch(`${gatewayUrl}/scope-auth/session`, {
      headers: { cookie: cookieBTemp },
    })
  ).json();
  assert.equal(sessionBTemp.authMode, "session");
  assert.equal(sessionBTemp.currentDeviceId, null);

  const upgradeB = await fetch(`${gatewayUrl}/scope-auth/devices/trust`, {
    method: "POST",
    headers: { cookie: cookieBTemp, "content-type": "application/json" },
    body: JSON.stringify({ name: "Work MacBook" }),
  });
  assert.equal(upgradeB.status, 200);
  const cookieBTrusted = (upgradeB.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(cookieBTrusted, /scope_private=d\.dev_/);
  const upgradedBody = await upgradeB.json();
  const deviceBId = upgradedBody.device.id;

  // 6. Revoke others from Device A -> Device B is immediately locked out (401), Device A still works (200)
  const revokeOthers = await fetch(`${gatewayUrl}/scope-auth/devices/revoke-others`, {
    method: "POST",
    headers: { cookie: cookieA },
  });
  assert.equal(revokeOthers.status, 200);
  assert.equal((await revokeOthers.json()).removedCount, 1);

  assert.equal(
    (await fetch(gatewayUrl, { headers: { cookie: cookieBTrusted } })).status,
    401,
  );
  assert.equal(
    (await fetch(gatewayUrl, { headers: { cookie: cookieA } })).status,
    200,
  );

  // 7. Disk helper lists Device A and revoking on disk takes effect without restarting gateway
  const listed = await listTrustedDevices(stateFile);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, deviceAId);
  assert.notEqual(deviceAId, deviceBId);

  const revoked = await revokeTrustedDevice(deviceAId, stateFile);
  assert.equal(revoked.removedCount, 1);
  assert.equal(revoked.remainingCount, 0);

  // Wait past STATE_SYNC_INTERVAL_MS (1.5s) and confirm Device A is rejected live
  await new Promise((resolve) => setTimeout(resolve, 1_650));
  assert.equal(
    (await fetch(gatewayUrl, { headers: { cookie: cookieA } })).status,
    401,
  );
});

test("private gateway temporary sessions are random, revocable, and never derived from the access token", async (t) => {
  const { createHash } = await import("node:crypto");
  const dir = mkdtempSync(path.join(tmpdir(), "scope-temp-sessions-"));
  const stateFile = path.join(dir, "private-access.json");
  const token = await loadOrCreatePrivateAccessToken(stateFile);
  const ui = http.createServer((_request, response) => response.end("ui-ok"));
  const bridge = http.createServer((_request, response) => response.end("{}"));
  const uiTarget = await listen(ui);
  const bridgeTarget = await listen(bridge);
  const gateway = createPrivateGateway({ token, stateFile, uiTarget, bridgeTarget });
  const gatewayUrl = await listen(gateway);
  t.after(async () => {
    await Promise.all([close(gateway), close(ui), close(bridge)]);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const loginTemp = async () => {
    const response = await fetch(`${gatewayUrl}/scope-auth`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    assert.equal(response.status, 303);
    return (response.headers.get("set-cookie") || "").split(";", 1)[0];
  };
  const status = async (cookie) => (await fetch(gatewayUrl, { headers: { cookie } })).status;

  // The pre-hardening cookie was sha256("scope-private-session:" + token): it must no longer work.
  const legacy = createHash("sha256").update(`scope-private-session:${token}`).digest("base64url");
  assert.equal(await status(`scope_private=${legacy}`), 401);

  const first = await loginTemp();
  const second = await loginTemp();
  assert.match(first, /^scope_private=s\./);
  assert.notEqual(first, second);
  assert.equal(first.includes(token), false);
  assert.equal(await status(first), 200);
  assert.equal(await status(second), 200);

  // A one-time login link with trust=0 also mints a random temporary session.
  const { code: tempCode } = await createLoginCode(stateFile);
  const queryLogin = await fetch(`${gatewayUrl}/?scope_login=${encodeURIComponent(tempCode)}&trust=0`, { redirect: "manual" });
  assert.equal(queryLogin.status, 303);
  const third = (queryLogin.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(third, /^scope_private=s\./);

  // Logout kills only the current temporary session.
  const logout = await fetch(`${gatewayUrl}/scope-auth/logout`, { method: "POST", headers: { cookie: first } });
  assert.equal(logout.status, 200);
  assert.equal(await status(first), 401);
  assert.equal(await status(second), 200);

  // Revoke-others from one session signs out every other temporary session.
  const revoke = await fetch(`${gatewayUrl}/scope-auth/devices/revoke-others`, { method: "POST", headers: { cookie: second } });
  assert.equal(revoke.status, 200);
  assert.equal((await revoke.json()).removedSessions, 1);
  assert.equal(await status(third), 401);
  assert.equal(await status(second), 200);

  // Upgrading to a trusted device retires the temporary session cookie.
  const upgrade = await fetch(`${gatewayUrl}/scope-auth/devices/trust`, {
    method: "POST",
    headers: { cookie: second, "content-type": "application/json" },
    body: JSON.stringify({ name: "Laptop" }),
  });
  assert.equal(upgrade.status, 200);
  const trusted = (upgrade.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.equal(await status(second), 401);
  assert.equal(await status(trusted), 200);
});
