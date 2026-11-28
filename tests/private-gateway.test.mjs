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
  parsePortOrigin,
  parsePortProxyPath,
  parsePublicSharePath,
  revokeTrustedDevice,
  rewritePortProxyCss,
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

  // 1b. Cross-site login POST is rejected, while Safari/WebKit same-origin `Origin: null` form POST succeeds
  const crossSiteLogin = await fetch(`${gatewayUrl}/scope-auth`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    body: new URLSearchParams({ token }).toString(),
  });
  assert.equal(crossSiteLogin.status, 403);

  const safariOpaqueLogin = await fetch(`${gatewayUrl}/scope-auth`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "null",
      "sec-fetch-site": "same-origin",
    },
    body: new URLSearchParams({ token }).toString(),
  });
  assert.equal(safariOpaqueLogin.status, 303);

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

function rawRequest(url, { host, method = "GET", headers = {}, body } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        method,
        path: `${target.pathname}${target.search}`,
        headers: { ...(host ? { host } : {}), ...headers },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function startPortProxyFixture(t, gatewayOptions = {}) {
  const seen = [];
  const app = http.createServer((request, response) => {
    seen.push({ url: request.url, cookie: request.headers.cookie || "" });
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "Clear-Site-Data": '"storage"',
      "Set-Cookie": ["scope_port=forged; Path=/", "app_ok=1; Path=/"],
    });
    response.end("<html><head></head><body>forwarded-app</body></html>");
  });
  const appWs = new WebSocketServer({ noServer: true });
  app.on("upgrade", (request, socket, head) => {
    appWs.handleUpgrade(request, socket, head, (ws) => ws.send(`ws:${request.headers.cookie || ""}`));
  });
  const appTarget = await listen(app);
  const appPort = Number(new URL(appTarget).port);
  const forwards = [{ host: "@local", remotePort: appPort, localPort: appPort, localHost: "127.0.0.1", status: "connected" }];
  const bridge = http.createServer((request, response) => {
    if (request.url === "/api/port-forwards") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ forwards }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{}");
  });
  const ui = http.createServer((_request, response) => response.end("ui"));
  const uiTarget = await listen(ui);
  const bridgeTarget = await listen(bridge);
  const token = "port-isolation-test-token-that-is-longer-than-32-chars";
  const gateway = createPrivateGateway({ token, uiTarget, bridgeTarget, ...gatewayOptions });
  const gatewayUrl = await listen(gateway);
  t.after(async () => {
    appWs.close();
    await Promise.all([close(gateway), close(ui), close(bridge), close(app)]);
  });
  const login = await fetch(`${gatewayUrl}/scope-auth`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  const mainCookie = (login.headers.get("set-cookie") || "").split(";", 1)[0];
  return { gateway, gatewayUrl, appPort, mainCookie, seen };
}

test("port proxy strips service-worker/clear-site-data headers and refuses service worker scripts", async (t) => {
  const { gatewayUrl, appPort, mainCookie, seen } = await startPortProxyFixture(t);
  const page = await rawRequest(`${gatewayUrl}/scope-port/${appPort}/`, {
    headers: { cookie: `${mainCookie}; scope_port=leak-me; app_ok=1` },
  });
  assert.equal(page.status, 200);
  assert.match(page.body, /forwarded-app/);
  assert.equal(page.headers["service-worker-allowed"], undefined);
  assert.equal(page.headers["clear-site-data"], undefined);
  const setCookies = [page.headers["set-cookie"] || []].flat();
  assert.equal(setCookies.some((value) => /^scope_port=/.test(value)), false);
  assert.ok(setCookies.some((value) => /^app_ok=1/.test(value)));
  assert.equal(seen.at(-1).cookie.includes("scope_port"), false);
  assert.equal(seen.at(-1).cookie.includes("scope_private"), false);

  const swScript = await rawRequest(`${gatewayUrl}/scope-port/${appPort}/sw.js`, {
    headers: { cookie: mainCookie, "service-worker": "script" },
  });
  assert.equal(swScript.status, 403);
});

test("isolated port origin hands off with single-use tickets and never shares the control-plane origin", async (t) => {
  // Both origins hit the same socket; the gateway tells them apart by Host header.
  const portOrigin = "http://ports.localhost:4999";
  const portHost = "ports.localhost:4999";
  const { gatewayUrl, appPort, mainCookie, seen } = await startPortProxyFixture(t, { portOrigin });
  const portsUrl = gatewayUrl;

  // Control-plane origin: authenticated GET is redirected with a ticket; nothing is proxied.
  const handoff = await rawRequest(`${gatewayUrl}/scope-port/${appPort}/dash?tab=1`, { headers: { cookie: mainCookie } });
  assert.equal(handoff.status, 303);
  const location = new URL(handoff.headers.location);
  assert.equal(location.origin, portOrigin);
  assert.equal(location.pathname, `/scope-port/${appPort}/dash`);
  assert.equal(location.searchParams.get("tab"), "1");
  const ticket = location.searchParams.get("__scope_port_ticket");
  assert.ok(ticket && ticket.length >= 32);
  assert.equal(seen.length, 0, "control-plane origin must not proxy forwarded apps");
  assert.equal((await rawRequest(`${gatewayUrl}/scope-port/${appPort}/`)).status, 401);
  assert.equal(
    (await rawRequest(`${gatewayUrl}/scope-port/${appPort}/`, { method: "POST", headers: { cookie: mainCookie, origin: gatewayUrl } })).status,
    403,
  );

  // Port origin: only /scope-port/* exists, and only with a port session.
  assert.equal((await rawRequest(`${portsUrl}/`, { host: portHost, headers: { cookie: mainCookie } })).status, 404);
  assert.equal((await rawRequest(`${portsUrl}/scope-api/api/health`, { host: portHost, headers: { cookie: mainCookie } })).status, 404);
  assert.equal(
    (await rawRequest(`${portsUrl}/scope-auth`, { host: portHost, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "token=x" })).status,
    404,
  );
  assert.equal((await rawRequest(`${portsUrl}/scope-port/${appPort}/`, { host: portHost, headers: { cookie: mainCookie } })).status, 401);

  const exchange = await rawRequest(`${portsUrl}${location.pathname}${location.search}`, { host: portHost });
  assert.equal(exchange.status, 303);
  assert.equal(exchange.headers.location, `/scope-port/${appPort}/dash?tab=1`);
  const portCookieHeader = [exchange.headers["set-cookie"]].flat()[0] || "";
  assert.match(portCookieHeader, /^scope_port=/);
  assert.match(portCookieHeader, /Path=\/scope-port\//);
  assert.match(portCookieHeader, /HttpOnly/);
  const portCookie = portCookieHeader.split(";", 1)[0];
  assert.equal(
    (await rawRequest(`${portsUrl}${location.pathname}${location.search}`, { host: portHost })).status,
    403,
    "tickets are single-use",
  );

  const page = await rawRequest(`${portsUrl}/scope-port/${appPort}/`, { host: portHost, headers: { cookie: portCookie } });
  assert.equal(page.status, 200);
  assert.match(page.body, /forwarded-app/);
  assert.equal(seen.at(-1).cookie.includes("scope_port"), false);

  // The port session is worthless on the control plane.
  assert.equal((await rawRequest(`${gatewayUrl}/scope-api/api/health`, { headers: { cookie: portCookie } })).status, 401);

  // WebSockets: port origin needs a port session; the control plane refuses /scope-port upgrades.
  const wsMessage = (url, headers) =>
    new Promise((resolve) => {
      const socket = new WebSocket(url, { headers });
      socket.once("message", (data) => { resolve(String(data)); socket.close(); });
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
      socket.once("error", () => resolve("error"));
    });
  const wsBase = gatewayUrl.replace(/^http/, "ws");
  assert.equal(await wsMessage(`${wsBase}/scope-port/${appPort}/ws`, { host: portHost, origin: portOrigin, cookie: portCookie }), "ws:");
  assert.equal(await wsMessage(`${wsBase}/scope-port/${appPort}/ws`, { host: portHost, origin: portOrigin }), 401);
  assert.equal(await wsMessage(`${wsBase}/scope-port/${appPort}/ws`, { cookie: mainCookie }), 403);

  // Signing out of SCOPE drops forwarded-app sessions too.
  await fetch(`${gatewayUrl}/scope-auth/logout`, { method: "POST", headers: { cookie: mainCookie } });
  assert.equal((await rawRequest(`${portsUrl}/scope-port/${appPort}/`, { host: portHost, headers: { cookie: portCookie } })).status, 401);
});

test("parsePortOrigin accepts bare https origins and rejects unsafe values", () => {
  assert.equal(parsePortOrigin(""), null);
  assert.equal(parsePortOrigin("https://scope-ports.example.com").host, "scope-ports.example.com");
  assert.equal(parsePortOrigin("http://ports.localhost:4820").host, "ports.localhost:4820");
  for (const bad of ["http://scope-ports.example.com", "https://x.example.com/path", "https://x.example.com/?a=1", "https://u:p@x.example.com", "not a url"]) {
    assert.throws(() => parsePortOrigin(bad), Error, bad);
  }
});

test("port proxy rewrites CSS urls, remapped remotePort redirects, runtime shim, and diagnostic HTML errors", async (t) => {
  assert.equal(
    rewritePortProxyLocation("http://127.0.0.1:3000/dashboard", 13000, 3000),
    "/scope-port/13000/dashboard",
  );
  assert.equal(
    rewritePortProxyLocation("/cdn-cgi/access/logout", 8787),
    "/cdn-cgi/access/logout",
  );
  assert.equal(
    rewritePortProxyCss(
      "body{background:url('/img/bg.png');font:url(/fonts/a.woff2);keep:url(data:image/png;base64,AAA);ext:url(//cdn.example.com/x.png);done:url(/scope-port/8787/ok.png)}",
      8787,
    ),
    "body{background:url('/scope-port/8787/img/bg.png');font:url(/scope-port/8787/fonts/a.woff2);keep:url(data:image/png;base64,AAA);ext:url(//cdn.example.com/x.png);done:url(/scope-port/8787/ok.png)}",
  );

  const withShim = rewritePortProxyHtml(
    '<html><head><title>SPA</title><style>.x{background:url("/bg.svg")}</style></head><body><script src="/cdn-cgi/scripts/beacon.js"></script><script src="/app.js"></script></body></html>',
    5173,
  );
  assert.match(withShim, /<base href="\/scope-port\/5173\/"><title>SPA<\/title>/);
  assert.match(withShim, /url\("\/scope-port\/5173\/bg\.svg"\)/);
  assert.match(withShim, /src="\/cdn-cgi\/scripts\/beacon\.js"/);
  assert.match(withShim, /src="\/scope-port\/5173\/app\.js"/);
  assert.match(withShim, /\/cdn-cgi\//);
  assert.match(withShim, /data-scope-port-shim/);
  assert.equal(
    rewritePortProxyHtml("<html><head></head><body></body></html>", 5173, {
      injectRuntimeShim: false,
    }).includes("data-scope-port-shim"),
    false,
  );

  let seenHost = "";
  const app = http.createServer((request, response) => {
    seenHost = request.headers.host || "";
    if (request.url === "/style.css") {
      response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      response.end('body{background:url("/static/bg.png")}');
      return;
    }
    if (request.url === "/drop") {
      request.socket.destroy();
      return;
    }
    response.writeHead(302, { Location: "http://localhost:3000/home" });
    response.end();
  });
  const appTarget = await listen(app);
  const appPort = Number(new URL(appTarget).port);
  const bridge = http.createServer((request, response) => {
    if (request.url === "/api/port-forwards") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          forwards: [
            {
              host: "gpu-a",
              remotePort: 3000,
              localPort: appPort,
              localHost: "127.0.0.1",
              status: "connected",
            },
          ],
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const ui = http.createServer((_req, res) => res.end("ui"));
  const uiTarget = await listen(ui);
  const bridgeTarget = await listen(bridge);
  const token = "diagnostic-and-css-rewrite-test-token-over-32-chars";
  const gateway = createPrivateGateway({ token, uiTarget, bridgeTarget });
  const gatewayUrl = await listen(gateway);

  t.after(async () => {
    await Promise.all([close(gateway), close(ui), close(bridge), close(app)]);
  });

  const login = await fetch(`${gatewayUrl}/scope-auth`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  const cookie = (login.headers.get("set-cookie") || "").split(";", 1)[0];

  const cssRes = await fetch(`${gatewayUrl}/scope-port/${appPort}/style.css`, {
    headers: { cookie },
  });
  assert.equal(cssRes.status, 200);
  assert.equal(seenHost, "127.0.0.1:3000");
  assert.match(await cssRes.text(), new RegExp(`url\\("/scope-port/${appPort}/static/bg\\.png"\\)`));

  const redirRes = await fetch(`${gatewayUrl}/scope-port/${appPort}/`, {
    headers: { cookie },
    redirect: "manual",
  });
  assert.equal(redirRes.status, 302);
  assert.equal(redirRes.headers.get("location"), `/scope-port/${appPort}/home`);

  // Browser navigation to dropped upstream returns actionable HTML diagnostic page
  const dropHtml = await fetch(`${gatewayUrl}/scope-port/${appPort}/drop`, {
    headers: { cookie, accept: "text/html,application/xhtml+xml" },
  });
  assert.equal(dropHtml.status, 502);
  assert.match(dropHtml.headers.get("content-type") || "", /text\/html/);
  assert.match(await dropHtml.text(), /未能返回有效 HTTP 响应/);

  // API client (no text/html Accept) still receives JSON
  const dropJson = await fetch(`${gatewayUrl}/scope-port/${appPort}/drop`, {
    headers: { cookie, accept: "application/json" },
  });
  assert.equal(dropJson.status, 502);
  assert.match(dropJson.headers.get("content-type") || "", /application\/json/);

  // Browser navigation to unopened port returns helpful HTML diagnostic page
  const closedHtml = await fetch(`${gatewayUrl}/scope-port/59999/`, {
    headers: { cookie, accept: "text/html" },
  });
  assert.equal(closedHtml.status, 403);
  assert.match(closedHtml.headers.get("content-type") || "", /text\/html/);
  assert.match(await closedHtml.text(), /尚未在 SCOPE 中开放/);
});

test("opt-in public static share enforces isolated read-only GET/HEAD, strips cookies, blocks WS/SW, and honors revoke/expiry", async (t) => {
  const token = "public-share-test-master-token-over-32-chars-long";
  const validShareToken = "ShareToken_0123456789abcdefghijKLMN";
  const shareOrigin = "http://share.localhost:4998";
  const shareHost = "share.localhost:4998";
  let activeShare = {
    token: validShareToken,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    mode: "readonly-static",
  };
  const upstreamSeen = [];

  assert.deepEqual(parsePublicSharePath(`/s/${validShareToken}`), {
    token: validShareToken,
    prefix: `/s/${validShareToken}`,
    suffix: "",
    needsTrailingSlash: true,
  });
  assert.deepEqual(
    parsePublicSharePath(`/scope-share/${validShareToken}/docs/index.html`, { sameOrigin: true }),
    {
      token: validShareToken,
      prefix: `/scope-share/${validShareToken}`,
      suffix: "/docs/index.html",
      needsTrailingSlash: false,
    },
  );
  assert.equal(parsePublicSharePath("/s/too-short"), null);

  const staticDoc = http.createServer((request, response) => {
    upstreamSeen.push({
      method: request.method,
      url: request.url,
      cookie: request.headers.cookie || "",
      authorization: request.headers.authorization || "",
      cfJwt: request.headers["cf-access-jwt-assertion"] || "",
      origin: request.headers.origin || "",
      referer: request.headers.referer || "",
      range: request.headers.range || "",
    });
    if (request.url === "/style.css") {
      response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      response.end('body{background:url("/assets/fig.png")}');
      return;
    }
    if (request.url === "/go") {
      response.writeHead(302, { Location: "/chapter/1" });
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": "leak=1; Path=/",
      "Service-Worker-Allowed": "/",
      "Clear-Site-Data": '"cookies"',
      "Access-Control-Allow-Origin": "*",
    });
    response.end('<html><head><title>Report</title></head><body><img src="/assets/chart.png"><script src="/app.js"></script></body></html>');
  });
  const docTarget = await listen(staticDoc);
  const docPort = Number(new URL(docTarget).port);

  const bridge = http.createServer((request, response) => {
    if (request.url === "/api/port-forwards") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          forwards: [
            {
              host: "@local",
              remotePort: docPort,
              localPort: docPort,
              localHost: "127.0.0.1",
              status: "connected",
              label: "Static Docs",
              publicShare: activeShare,
            },
          ],
        }),
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  const ui = http.createServer((_req, res) => res.end("scope-ui"));
  const uiTarget = await listen(ui);
  const bridgeTarget = await listen(bridge);

  // Reject identical portOrigin and shareOrigin
  assert.throws(
    () =>
      createPrivateGateway({
        token,
        uiTarget,
        bridgeTarget,
        portOrigin: "https://same.example.com",
        shareOrigin: "https://same.example.com",
      }),
    /Share origin must differ from port origin/,
  );

  const gateway = createPrivateGateway({
    token,
    uiTarget,
    bridgeTarget,
    portCacheTtlMs: 0,
    shareOrigin,
  });
  const gatewayUrl = await listen(gateway);
  t.after(async () => {
    await Promise.all([close(gateway), close(ui), close(bridge), close(staticDoc)]);
  });

  // Main origin stays locked; /scope-share/ is NOT served on main origin when allowSameOriginShare is false
  assert.equal((await rawRequest(`${gatewayUrl}/`)).status, 401);
  assert.equal((await rawRequest(`${gatewayUrl}/scope-share/${validShareToken}/`)).status, 401);

  // Authenticated /scope-auth/session reports shareOrigin & publicShareEnabled
  const login = await fetch(`${gatewayUrl}/scope-auth`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  const mainCookie = (login.headers.get("set-cookie") || "").split(";", 1)[0];
  const sessionInfo = await (
    await fetch(`${gatewayUrl}/scope-auth/session`, { headers: { cookie: mainCookie } })
  ).json();
  assert.equal(sessionInfo.shareOrigin, shareOrigin);
  assert.equal(sessionInfo.sameOriginShareEnabled, false);
  assert.equal(sessionInfo.publicShareEnabled, true);

  // Share origin refuses control-plane / non-share paths with 404
  assert.equal((await rawRequest(`${gatewayUrl}/`, { host: shareHost })).status, 404);
  assert.equal((await rawRequest(`${gatewayUrl}/scope-api/api/health`, { host: shareHost })).status, 404);
  assert.equal((await rawRequest(`${gatewayUrl}/scope-port/${docPort}/`, { host: shareHost })).status, 404);

  // Bare /s/<token> redirects with 307 to /s/<token>/
  const bare = await rawRequest(`${gatewayUrl}/s/${validShareToken}?v=1`, { host: shareHost });
  assert.equal(bare.status, 307);
  assert.equal(bare.headers.location, `/s/${validShareToken}/?v=1`);

  // Public unauthenticated GET works, rewrites paths, strips cookies & dangerous headers, sets noindex/no-referrer
  const docRes = await rawRequest(`${gatewayUrl}/s/${validShareToken}/`, {
    host: shareHost,
    headers: {
      cookie: `${mainCookie}; secret=leak`,
      authorization: "Bearer secret",
      "cf-access-jwt-assertion": "jwt-leak",
      origin: "https://evil.example",
      referer: "https://evil.example/ref",
      range: "bytes=0-100",
    },
  });
  assert.equal(docRes.status, 200);
  assert.match(docRes.body, new RegExp(`<base href="/s/${validShareToken}/">`));
  assert.match(docRes.body, new RegExp(`src="/s/${validShareToken}/assets/chart\\.png"`));
  assert.match(docRes.body, /data-scope-port-shim/);
  assert.equal(docRes.body.includes("window.WebSocket="), false);
  assert.equal(docRes.headers["x-robots-tag"], "noindex, nofollow, noarchive");
  assert.equal(docRes.headers["referrer-policy"], "no-referrer");
  assert.equal(docRes.headers["set-cookie"], undefined);
  assert.equal(docRes.headers["service-worker-allowed"], undefined);
  assert.equal(docRes.headers["clear-site-data"], undefined);
  assert.equal(docRes.headers["access-control-allow-origin"], undefined);
  assert.equal(upstreamSeen.at(-1).cookie, "");
  assert.equal(upstreamSeen.at(-1).authorization, "");
  assert.equal(upstreamSeen.at(-1).cfJwt, "");
  assert.equal(upstreamSeen.at(-1).origin, "");
  assert.equal(upstreamSeen.at(-1).referer, "");
  assert.equal(upstreamSeen.at(-1).range, "bytes=0-100");

  // CSS and Location redirect rewriting under /s/<token>
  const cssRes = await rawRequest(`${gatewayUrl}/s/${validShareToken}/style.css`, { host: shareHost });
  assert.equal(cssRes.status, 200);
  assert.match(cssRes.body, new RegExp(`url\\("/s/${validShareToken}/assets/fig\\.png"\\)`));
  const redirRes = await rawRequest(`${gatewayUrl}/s/${validShareToken}/go`, { host: shareHost });
  assert.equal(redirRes.status, 302);
  assert.equal(redirRes.headers.location, `/s/${validShareToken}/chapter/1`);

  // HEAD allowed; POST/PUT/DELETE rejected with 405; Service-Worker rejected with 403; WS rejected with 403
  assert.equal((await rawRequest(`${gatewayUrl}/s/${validShareToken}/`, { host: shareHost, method: "HEAD" })).status, 200);
  const postRes = await rawRequest(`${gatewayUrl}/s/${validShareToken}/submit`, {
    host: shareHost,
    method: "POST",
    body: "x=1",
  });
  assert.equal(postRes.status, 405);
  assert.equal(postRes.headers.allow, "GET, HEAD");
  assert.equal(
    (await rawRequest(`${gatewayUrl}/s/${validShareToken}/sw.js`, {
      host: shareHost,
      headers: { "service-worker": "script" },
    })).status,
    403,
  );
  const wsStatus = await new Promise((resolve) => {
    const socket = new WebSocket(`${gatewayUrl.replace(/^http/, "ws")}/s/${validShareToken}/ws`, {
      headers: { host: shareHost },
    });
    socket.once("unexpected-response", (_req, res) => resolve(res.statusCode));
    socket.once("error", () => resolve("error"));
  });
  assert.equal(wsStatus, 403);

  // Expiry immediately returns 404
  activeShare = { ...activeShare, expiresAt: new Date(Date.now() - 1000).toISOString() };
  const expiredHtml = await rawRequest(`${gatewayUrl}/s/${validShareToken}/`, {
    host: shareHost,
    headers: { accept: "text/html" },
  });
  assert.equal(expiredHtml.status, 404);
  assert.match(expiredHtml.body, /分享文档链接无效或已撤销/);
  assert.equal(expiredHtml.body.includes("返回 SCOPE"), false);

  // Revoke immediately returns 404 JSON for API clients
  activeShare = null;
  const revokedJson = await rawRequest(`${gatewayUrl}/s/${validShareToken}/`, {
    host: shareHost,
    headers: { accept: "application/json" },
  });
  assert.equal(revokedJson.status, 404);
});

test("allowSameOriginShare enables unauthenticated read-only /scope-share/<token>/ while keeping main routes locked", async (t) => {
  const token = "same-origin-share-test-master-token-over-32-chars";
  const shareToken = "SameOriginShareToken_0123456789abcd";
  const staticDoc = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end('<html><head></head><body><a href="/next">Next</a></body></html>');
  });
  const docTarget = await listen(staticDoc);
  const docPort = Number(new URL(docTarget).port);
  const bridge = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        forwards: [
          {
            host: "@local",
            remotePort: docPort,
            localPort: docPort,
            localHost: "127.0.0.1",
            status: "connected",
            publicShare: { token: shareToken, expiresAt: null, mode: "readonly-static" },
          },
        ],
      }),
    );
  });
  const ui = http.createServer((_req, res) => res.end("ui"));
  const uiTarget = await listen(ui);
  const bridgeTarget = await listen(bridge);
  const gateway = createPrivateGateway({
    token,
    uiTarget,
    bridgeTarget,
    portCacheTtlMs: 0,
    allowSameOriginShare: true,
  });
  const gatewayUrl = await listen(gateway);
  t.after(async () => {
    await Promise.all([close(gateway), close(ui), close(bridge), close(staticDoc)]);
  });

  // Main app remains 401 without auth
  assert.equal((await rawRequest(`${gatewayUrl}/`)).status, 401);
  // Read-only GET on /scope-share/<token>/ works without auth
  const res = await rawRequest(`${gatewayUrl}/scope-share/${shareToken}/`);
  assert.equal(res.status, 200);
  assert.match(res.body, new RegExp(`href="/scope-share/${shareToken}/next"`));
  assert.equal(res.headers["x-robots-tag"], "noindex, nofollow, noarchive");
  // POST rejected with 405
  assert.equal((await rawRequest(`${gatewayUrl}/scope-share/${shareToken}/`, { method: "POST" })).status, 405);
});
