import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_FILE = path.resolve(
  MODULE_DIR,
  "../.scope/private-access.json",
);
const COOKIE_NAME = "scope_private";

function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function loopbackTarget(value, label) {
  const target = new URL(value);
  if (target.protocol !== "http:" || !isLoopbackHostname(target.hostname)) {
    throw new Error(`${label} must be an http:// loopback URL`);
  }
  return target;
}

function stableDigest(value) {
  return createHash("sha256").update(value).digest();
}

function equalSecret(actual, expected) {
  const left = stableDigest(actual || "");
  const right = stableDigest(expected);
  return timingSafeEqual(left, right);
}

function cookieValue(token) {
  return createHash("sha256")
    .update(`scope-private-session:${token}`)
    .digest("base64url");
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, ...value]) => [key, value.join("=")]),
  );
}

function securityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'self' ws: wss:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "));
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function sendLogin(response, message = "") {
  securityHeaders(response);
  response.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SCOPE 私有访问</title>
<style>
body{margin:0;background:#0b1020;color:#e7edf8;font:17px/1.55 system-ui;display:grid;min-height:100vh;place-items:center}
main{width:min(440px,calc(100vw - 36px));padding:28px;border:1px solid #334155;border-radius:16px;background:#111827}
input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px 14px;border-radius:10px}
input{background:#0b1220;color:#fff;border:1px solid #475569}button{margin-top:12px;border:0;background:#4f7cff;color:#fff;font-weight:700}
p{color:#aebbd0}.error{color:#ffb4a8}
</style>
<main><h1>SCOPE 私有访问</h1><p>输入本机生成的访问密钥。通过后会写入安全 Cookie，地址栏不会保留密钥。</p>
${message ? `<p class="error">${message}</p>` : ""}
<form method="post" action="/scope-auth"><input name="token" type="password" autocomplete="current-password" required autofocus aria-label="访问密钥"><button>进入 Monitor</button></form></main>`);
}

function authenticated(request, token) {
  const cookies = parseCookies(request.headers.cookie);
  return equalSecret(cookies[COOKIE_NAME] || "", cookieValue(token));
}

function hasSafeWriteOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method || "")) return true;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function sanitizeHeaders(headers, target, stripBrowserOrigin = false) {
  const forwarded = { ...headers, host: target.host };
  delete forwarded.cookie;
  delete forwarded.authorization;
  delete forwarded["x-forwarded-for"];
  delete forwarded["x-forwarded-host"];
  delete forwarded["x-forwarded-proto"];
  if (stripBrowserOrigin) {
    delete forwarded.origin;
    delete forwarded.referer;
  }
  return forwarded;
}

function proxyRequest(
  request,
  response,
  target,
  pathname,
  stripBrowserOrigin = false,
) {
  const targetPath = `${target.pathname.replace(/\/$/, "")}${pathname}`;
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      method: request.method,
      path: targetPath,
      headers: sanitizeHeaders(request.headers, target, stripBrowserOrigin),
    },
    (upstreamResponse) => {
      securityHeaders(response);
      const headers = { ...upstreamResponse.headers };
      delete headers["access-control-allow-origin"];
      delete headers["access-control-allow-credentials"];
      response.writeHead(upstreamResponse.statusCode || 502, headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    securityHeaders(response);
    response.writeHead(502, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: `Local service unavailable: ${error.message}` }));
  });
  request.pipe(upstream);
}

function proxyUpgrade(
  request,
  socket,
  head,
  target,
  pathname = request.url,
  stripBrowserOrigin = false,
) {
  const upstream = http.request({
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: `${target.pathname.replace(/\/$/, "")}${pathname}`,
    headers: sanitizeHeaders(request.headers, target, stripBrowserOrigin),
  });
  upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    const status = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`;
    const headers = Object.entries(response.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");
    socket.write(`${status}${headers}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    socket.on("close", () => upstreamSocket.destroy());
    upstreamSocket.on("close", () => socket.destroy());
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
}

async function readFormBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 8_192) throw new Error("request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function loadOrCreatePrivateAccessToken(
  stateFile = DEFAULT_STATE_FILE,
) {
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    if (typeof state.token === "string" && state.token.length >= 32) {
      return state.token;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const token = randomBytes(32).toString("base64url");
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(
    stateFile,
    `${JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return token;
}

export function createPrivateGateway({
  token,
  tls,
  allowedClients = [],
  uiTarget = process.env.SCOPE_PRIVATE_UI || "http://127.0.0.1:3000",
  bridgeTarget =
    process.env.SCOPE_PRIVATE_BRIDGE || "http://127.0.0.1:4815",
} = {}) {
  if (typeof token !== "string" || token.length < 32) {
    throw new Error("A private access token of at least 32 characters is required");
  }
  const ui = loopbackTarget(uiTarget, "UI target");
  const bridge = loopbackTarget(bridgeTarget, "Bridge target");
  if (allowedClients.some(address => !isIP(address))) throw new Error("Client allowlist must contain IP addresses");
  const allowed = request => !allowedClients.length || allowedClients.includes(
    (request.socket.remoteAddress || "").replace(/^::ffff:/, ""),
  );

  const handler = async (request, response) => {
    if (!allowed(request)) {
      response.writeHead(403); response.end("Client address is not allowed"); return;
    }
    const requestUrl = new URL(request.url || "/", "http://scope.local");

    if (request.method === "POST" && requestUrl.pathname === "/scope-auth") {
      try {
        const form = new URLSearchParams(await readFormBody(request));
        if (!equalSecret(form.get("token") || "", token)) {
          sendLogin(response, "访问密钥不正确。");
          return;
        }
        securityHeaders(response);
        response.writeHead(303, {
          Location: "/",
          "Set-Cookie": `${COOKIE_NAME}=${cookieValue(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,
        });
        response.end();
      } catch {
        sendLogin(response, "请求无效。");
      }
      return;
    }

    const queryToken = requestUrl.searchParams.get("token");
    if (queryToken && equalSecret(queryToken, token)) {
      requestUrl.searchParams.delete("token");
      securityHeaders(response);
      response.writeHead(303, {
        Location: `${requestUrl.pathname}${requestUrl.search}`,
        "Set-Cookie": `${COOKIE_NAME}=${cookieValue(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,
      });
      response.end();
      return;
    }

    if (!authenticated(request, token)) {
      sendLogin(response);
      return;
    }

    if (!hasSafeWriteOrigin(request)) {
      securityHeaders(response);
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Cross-site write rejected" }));
      return;
    }

    if (requestUrl.pathname.startsWith("/scope-api/")) {
      const apiPath = requestUrl.pathname.slice("/scope-api".length);
      proxyRequest(
        request,
        response,
        bridge,
        `${apiPath}${requestUrl.search}`,
        true,
      );
      return;
    }
    proxyRequest(
      request,
      response,
      ui,
      `${requestUrl.pathname}${requestUrl.search}`,
    );
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

  server.on("upgrade", (request, socket, head) => {
    if (!allowed(request) || (request.headers.origin && !hasSafeWriteOrigin({ headers: request.headers, method: "POST" }))) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    if (!authenticated(request, token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const requestUrl = new URL(request.url || "/", "http://scope.local");
    if (requestUrl.pathname.startsWith("/scope-api/")) {
      const bridgePath = requestUrl.pathname.slice("/scope-api".length);
      proxyUpgrade(
        request,
        socket,
        head,
        bridge,
        `${bridgePath}${requestUrl.search}`,
        true,
      );
      return;
    }
    proxyUpgrade(
      request,
      socket,
      head,
      ui,
      `${requestUrl.pathname}${requestUrl.search}`,
    );
  });

  return server;
}

export async function startPrivateGateway({
  host = "127.0.0.1",
  port = Number(process.env.SCOPE_PRIVATE_PORT || 4820),
  stateFile = process.env.SCOPE_PRIVATE_STATE || DEFAULT_STATE_FILE,
} = {}) {
  if (!isLoopbackHostname(host)) {
    throw new Error("Private gateway must listen on loopback");
  }
  const token =
    process.env.SCOPE_PRIVATE_GATEWAY_TOKEN ||
    (await loadOrCreatePrivateAccessToken(stateFile));
  const server = createPrivateGateway({ token });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return { server, token, host, port, stateFile };
}
