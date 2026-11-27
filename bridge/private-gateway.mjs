import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
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
const DEFAULT_TRUSTED_DEVICE_DAYS = 90;
const SESSION_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;
const MAX_TRUSTED_DEVICES = 50;
const SLIDING_RENEW_INTERVAL_MS = 12 * 60 * 60 * 1000;
const TOUCH_PERSIST_INTERVAL_MS = 5 * 60 * 1000;
const STATE_SYNC_INTERVAL_MS = 1_500;
const PORT_PROXY_PREFIX_RE = /^\/scope-port\/(\d+)(?:(\/.*))?$/;
const PORT_PROXY_MAX_HTML_BYTES = 2 * 1024 * 1024;
const BLOCKED_PROXY_PORTS = new Set([
  22, 53, 2019, 3000, 4815, 4820, 4822, 4880, 4922,
]);

function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function loopbackUrlForPort(localHost, port) {
  const host = localHost === "::1" ? "[::1]" : "127.0.0.1";
  return new URL(`http://${host}:${port}`);
}

export function parsePortProxyPath(pathname = "") {
  const match = PORT_PROXY_PREFIX_RE.exec(pathname);
  if (!match) return null;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  const suffix = match[2] || "";
  return {
    port,
    suffix,
    needsTrailingSlash: suffix === "",
  };
}

function stripGatewayCookies(header = "") {
  if (!header) return "";
  return header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      const eq = part.indexOf("=");
      const name = (eq >= 0 ? part.slice(0, eq) : part).trim();
      if (!name) return false;
      return (
        name !== COOKIE_NAME &&
        name !== "CF_Authorization" &&
        name !== "CF_AppSession"
      );
    })
    .join("; ");
}

function portProxySecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
}

export function rewritePortProxyLocation(location, port) {
  if (typeof location !== "string" || !location) return location;
  const prefix = `/scope-port/${port}`;
  if (location.startsWith("/") && !location.startsWith("//")) {
    if (location === prefix || location.startsWith(`${prefix}/`)) {
      return location;
    }
    return `${prefix}${location}`;
  }
  try {
    const parsed = new URL(location);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const parsedPort = parsed.port
        ? Number(parsed.port)
        : parsed.protocol === "https:"
          ? 443
          : 80;
      const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      if (isLoopbackHostname(host) && parsedPort === port) {
        return `${prefix}${parsed.pathname || "/"}${parsed.search || ""}${parsed.hash || ""}`;
      }
    }
  } catch {
    /* keep relative or non-URL locations untouched */
  }
  return location;
}

function rewritePortProxySetCookie(setCookie, port) {
  const prefix = `/scope-port/${port}/`;
  const isReservedCookie = (value) => {
    const eq = value.indexOf("=");
    const name = (eq >= 0 ? value.slice(0, eq) : value).trim();
    return (
      name === COOKIE_NAME ||
      name === "CF_Authorization" ||
      name === "CF_AppSession"
    );
  };
  const rewriteOne = (value) => {
    if (typeof value !== "string" || isReservedCookie(value)) return null;
    const parts = value
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !/^domain=/i.test(part));
    let hasPath = false;
    const updated = parts.map((part) => {
      if (/^path=/i.test(part)) {
        hasPath = true;
        return `Path=${prefix}`;
      }
      return part;
    });
    if (!hasPath) updated.push(`Path=${prefix}`);
    return updated.join("; ");
  };
  const items = (Array.isArray(setCookie) ? setCookie : [setCookie])
    .map(rewriteOne)
    .filter(Boolean);
  return items.length ? items : null;
}

export function rewritePortProxyHtml(html, port) {
  if (typeof html !== "string" || !html) return html;
  const prefix = `/scope-port/${port}`;
  let out = html;
  if (!/<base\b/i.test(out)) {
    const baseTag = `<base href="${prefix}/">`;
    if (/<head\b[^>]*>/i.test(out)) {
      out = out.replace(/<head\b[^>]*>/i, (tag) => `${tag}${baseTag}`);
    } else if (/<html\b[^>]*>/i.test(out)) {
      out = out.replace(
        /<html\b[^>]*>/i,
        (tag) => `${tag}<head>${baseTag}</head>`,
      );
    } else {
      out = `${baseTag}${out}`;
    }
  }
  out = out.replace(
    /(\b(?:href|src|action|poster)\s*=\s*)(["'])\/(?!\/|scope-port\/)/gi,
    `$1$2${prefix}/`,
  );
  return out;
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

const MAX_TEMPORARY_SESSIONS = 200;
const LOGIN_CODE_PARAM = "scope_login";
const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_LOGIN_CODES = 20;

function hashLoginCode(code) {
  return createHash("sha256")
    .update(`scope-login-code:${code}`)
    .digest("base64url");
}

function pruneLoginCodes(entries, now = Date.now()) {
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (entry) =>
      entry &&
      typeof entry.hash === "string" &&
      Date.parse(entry.expiresAt || "") > now,
  );
}

function hashSessionSecret(secret) {
  return createHash("sha256")
    .update(`scope-private-temp-session:${secret}`)
    .digest("base64url");
}

function resolveTrustedDeviceDays(explicit) {
  const raw =
    explicit ??
    (process.env.SCOPE_TRUSTED_DEVICE_DAYS
      ? Number(process.env.SCOPE_TRUSTED_DEVICE_DAYS)
      : DEFAULT_TRUSTED_DEVICE_DAYS);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_TRUSTED_DEVICE_DAYS;
  return Math.min(365, Math.max(1, Math.round(parsed)));
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function inferDeviceName(userAgent = "") {
  const ua = String(userAgent || "");
  let osLabel = "";
  if (/iPhone/i.test(ua)) osLabel = "iPhone";
  else if (/iPad/i.test(ua)) osLabel = "iPad";
  else if (/Android/i.test(ua)) osLabel = "Android";
  else if (/Macintosh|Mac OS X/i.test(ua)) osLabel = "macOS";
  else if (/Windows/i.test(ua)) osLabel = "Windows";
  else if (/Linux/i.test(ua)) osLabel = "Linux";

  let browserLabel = "";
  if (/MicroMessenger/i.test(ua)) browserLabel = "WeChat";
  else if (/Edg(?:A|iOS)?\//i.test(ua)) browserLabel = "Edge";
  else if (/CriOS\/|Chrome\//i.test(ua)) browserLabel = "Chrome";
  else if (/FxiOS\/|Firefox\//i.test(ua)) browserLabel = "Firefox";
  else if (/Safari\//i.test(ua)) browserLabel = "Safari";

  if (osLabel && browserLabel) return `${osLabel} (${browserLabel})`;
  return osLabel || browserLabel || "Browser Device";
}

function sanitizeDeviceName(raw, fallback = "Browser Device") {
  const cleaned = String(raw || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  return cleaned || fallback;
}

function safeRedirectTarget(raw = "/") {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/";
  }
  if (raw === "/scope-auth" || raw.startsWith("/scope-auth/")) {
    return "/";
  }
  return raw;
}

function hashDeviceSecret(deviceId, secret) {
  return createHash("sha256")
    .update(`scope-trusted-device:${deviceId}:${secret}`)
    .digest("base64url");
}

function parseDeviceCookie(raw = "") {
  if (typeof raw !== "string" || !raw.startsWith("d.")) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [, id, secret] = parts;
  if (!/^[a-z0-9_-]{8,36}$/i.test(id) || secret.length < 32) return null;
  return { id, secret };
}

function formatAuthCookie(value, maxAgeSeconds) {
  const safeMaxAge = Math.max(60, Math.round(maxAgeSeconds));
  const expires = new Date(Date.now() + safeMaxAge * 1000).toUTCString();
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${safeMaxAge}; Expires=${expires}`;
}

function formatClearedAuthCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function pruneTrustedDevices(devices, nowMs = Date.now()) {
  if (!Array.isArray(devices)) return [];
  return devices.filter((entry) => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      typeof entry.tokenHash !== "string" ||
      !entry.id ||
      !entry.tokenHash
    ) {
      return false;
    }
    const exp = Date.parse(entry.expiresAt || "");
    return Number.isFinite(exp) && exp > nowMs;
  });
}

function serializeDevice(device, currentDeviceId = null) {
  return {
    id: device.id,
    name: device.name || "Browser Device",
    current: Boolean(currentDeviceId && device.id === currentDeviceId),
    createdAt: device.createdAt || null,
    lastSeenAt: device.lastSeenAt || null,
    expiresAt: device.expiresAt || null,
    userAgent: device.userAgent || "",
  };
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  securityHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
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
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function sendLogin(
  response,
  message = "",
  { nextPath = "/", userAgent = "", trustedDeviceDays = DEFAULT_TRUSTED_DEVICE_DAYS } = {},
) {
  const safeNext = safeRedirectTarget(nextPath);
  const suggestedName = inferDeviceName(userAgent);
  securityHeaders(response);
  response.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>SCOPE 私有访问</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0b1020;color:#e7edf8;font:16px/1.55 system-ui,-apple-system,sans-serif;display:grid;min-height:100dvh;place-items:center;padding:16px}
main{width:min(440px,100%);padding:26px 24px;border:1px solid #334155;border-radius:16px;background:#111827;box-shadow:0 20px 50px rgba(0,0,0,.35)}
h1{margin:0 0 8px;font-size:22px;line-height:1.3}
p{margin:0 0 16px;color:#aebbd0;font-size:14px}
.error{color:#ffb4a8;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);padding:9px 12px;border-radius:10px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
label.field{display:block;margin-bottom:12px}
label.field span{display:block;margin-bottom:5px;font-size:13px;color:#cbd5e1}
input[type="password"],input[type="text"]{width:100%;font:inherit;font-size:16px;padding:12px 14px;border-radius:10px;background:#0b1220;color:#fff;border:1px solid #475569}
input:focus{outline:none;border-color:#60a5fa}
.trust-row{display:flex;align-items:flex-start;gap:10px;margin:14px 0 10px;padding:11px 12px;border-radius:10px;border:1px solid #1e293b;background:#0d1526;cursor:pointer}
.trust-row input{width:18px;height:18px;margin-top:2px;accent-color:#4f7cff;flex-shrink:0}
.trust-copy{font-size:13px;line-height:1.45;color:#dbe4f3}
.trust-copy small{display:block;margin-top:2px;color:#94a3b8;font-size:12px}
button{width:100%;margin-top:12px;padding:13px 16px;border:0;border-radius:10px;background:#4f7cff;color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer}
button:hover{background:#3b6bff}
</style>
<main>
<h1>SCOPE 私有访问</h1>
<p>输入主机生成的访问密钥。勾选“信任此设备”后将自动长期免密，并可在设置或 CLI 中随时单独吊销。</p>
${message ? `<p class="error">${escapeHtml(message)}</p>` : ""}
<form method="post" action="/scope-auth">
<input type="hidden" name="next" value="${escapeHtml(safeNext)}">
<input class="sr-only" name="username" type="text" value="scope" autocomplete="username" readonly tabindex="-1" aria-hidden="true">
<label class="field"><span>访问密钥</span><input name="token" type="password" autocomplete="current-password" placeholder="粘贴访问密钥" required autofocus></label>
<label class="trust-row"><input type="checkbox" name="trustDevice" value="1" checked><span class="trust-copy">信任此设备（${trustedDeviceDays} 天自动续期免密）<small>刷新页面或重新打开不会要求重复验证；支持 iCloud 钥匙串自动保存。</small></span></label>
<label class="field"><span>设备备注名称（可选）</span><input name="deviceName" type="text" maxlength="64" value="${escapeHtml(suggestedName)}" placeholder="例如：我的 iPhone"></label>
<button type="submit">进入 Monitor</button>
</form>
</main>`);
}

function hasSafeWriteOrigin(request, { allowOpaqueLoginOrigin = false } = {}) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method || "")) return true;
  const fetchSite = String(request.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  if (origin === "null") {
    // WebKit/iOS Safari can send `Origin: null` on form POSTs (e.g. under strict
    // referrer policies or 401 error documents). Allow same-origin Sec-Fetch-Site,
    // or login forms without Sec-Fetch-Site (which still verify the 256-bit token).
    if (fetchSite === "same-origin") return true;
    return allowOpaqueLoginOrigin && !fetchSite;
  }
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
  refreshCookie = null,
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
      if (refreshCookie) {
        const existing = headers["set-cookie"];
        headers["set-cookie"] = existing
          ? [...(Array.isArray(existing) ? existing : [existing]), refreshCookie]
          : [refreshCookie];
      }
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

function sanitizePortProxyHeaders(
  request,
  target,
  prefix,
  { isUpgrade = false } = {},
) {
  const forwarded = { ...request.headers, host: target.host };
  const keptCookie = stripGatewayCookies(request.headers.cookie || "");
  if (keptCookie) forwarded.cookie = keptCookie;
  else delete forwarded.cookie;
  delete forwarded["cf-access-jwt-assertion"];
  delete forwarded["cf-access-authenticated-user-email"];
  delete forwarded["x-forwarded-for"];
  delete forwarded["x-forwarded-host"];
  forwarded["x-forwarded-prefix"] = prefix;
  forwarded["x-forwarded-proto"] =
    request.headers["x-forwarded-proto"] ||
    (request.socket?.encrypted ? "https" : "http");
  if (!isUpgrade) {
    forwarded["accept-encoding"] = "identity";
  }
  if (request.headers.origin) {
    try {
      const originHost = new URL(request.headers.origin).host;
      if (originHost === request.headers.host) {
        forwarded.origin = `http://${target.host}`;
      } else {
        delete forwarded.origin;
      }
    } catch {
      delete forwarded.origin;
    }
  }
  if (request.headers.referer) {
    try {
      const ref = new URL(request.headers.referer);
      if (ref.host === request.headers.host && ref.pathname.startsWith(prefix)) {
        const stripped = ref.pathname.slice(prefix.length) || "/";
        forwarded.referer = `http://${target.host}${stripped}${ref.search}`;
      } else {
        delete forwarded.referer;
      }
    } catch {
      delete forwarded.referer;
    }
  }
  return forwarded;
}

function proxyPortRequest(request, response, target, upstreamPath, port) {
  const prefix = `/scope-port/${port}`;
  const upstream = http.request(
    {
      hostname: target.hostname.replace(/^\[|\]$/g, ""),
      port: target.port,
      method: request.method,
      path: upstreamPath,
      headers: sanitizePortProxyHeaders(request, target, prefix),
    },
    (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers };
      delete headers["access-control-allow-origin"];
      delete headers["access-control-allow-credentials"];
      const statusCode = upstreamResponse.statusCode || 502;
      if (
        statusCode >= 300 &&
        statusCode < 400 &&
        typeof headers.location === "string"
      ) {
        headers.location = rewritePortProxyLocation(headers.location, port);
      }
      if (headers["set-cookie"]) {
        const scoped = rewritePortProxySetCookie(headers["set-cookie"], port);
        if (scoped) headers["set-cookie"] = scoped;
        else delete headers["set-cookie"];
      }
      const contentType = String(headers["content-type"] || "").toLowerCase();
      const shouldRewriteHtml =
        request.method !== "HEAD" &&
        contentType.includes("text/html") &&
        !headers["content-encoding"];
      if (!shouldRewriteHtml) {
        portProxySecurityHeaders(response);
        response.writeHead(statusCode, headers);
        upstreamResponse.pipe(response);
        return;
      }

      const chunks = [];
      let totalBytes = 0;
      let bypassed = false;
      upstreamResponse.on("data", (chunk) => {
        if (bypassed) {
          response.write(chunk);
          return;
        }
        totalBytes += chunk.length;
        if (totalBytes > PORT_PROXY_MAX_HTML_BYTES) {
          bypassed = true;
          portProxySecurityHeaders(response);
          response.writeHead(statusCode, headers);
          for (const prev of chunks) response.write(prev);
          chunks.length = 0;
          response.write(chunk);
          return;
        }
        chunks.push(chunk);
      });
      upstreamResponse.on("end", () => {
        if (bypassed) {
          response.end();
          return;
        }
        const rawHtml = Buffer.concat(chunks).toString("utf8");
        const rewritten = rewritePortProxyHtml(rawHtml, port);
        const body = Buffer.from(rewritten, "utf8");
        delete headers["transfer-encoding"];
        headers["content-length"] = String(body.length);
        portProxySecurityHeaders(response);
        response.writeHead(statusCode, headers);
        response.end(body);
      });
      upstreamResponse.on("error", (error) => {
        if (response.headersSent) response.destroy(error);
        else {
          portProxySecurityHeaders(response);
          response.writeHead(502, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              error: `Proxied local service error: ${error.message}`,
            }),
          );
        }
      });
    },
  );
  upstream.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    portProxySecurityHeaders(response);
    response.writeHead(502, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: `Proxied local service unavailable: ${error.message}`,
      }),
    );
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
  customHeaders = null,
) {
  const upstream = http.request({
    hostname: target.hostname.replace(/^\[|\]$/g, ""),
    port: target.port,
    method: request.method,
    path: `${target.pathname.replace(/\/$/, "")}${pathname}`,
    headers:
      customHeaders ||
      sanitizeHeaders(request.headers, target, stripBrowserOrigin),
  });
  upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    const status = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`;
    const headers = Object.entries(response.headers)
      .flatMap(([key, value]) =>
        Array.isArray(value)
          ? value.map((item) => `${key}: ${item}`)
          : [`${key}: ${value}`],
      )
      .join("\r\n");
    socket.write(`${status}${headers}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    socket.on("close", () => upstreamSocket.destroy());
    upstreamSocket.on("close", () => socket.destroy());
  });
  upstream.on("response", (response) => {
    const status = response.statusCode || 502;
    const message = response.statusMessage || "Bad Gateway";
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
    response.resume();
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
}

function fetchAllowedPortsFromBridge(bridge, blockedPorts) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: bridge.hostname.replace(/^\[|\]$/g, ""),
        port: bridge.port,
        method: "GET",
        path: `${bridge.pathname.replace(/\/$/, "")}/api/port-forwards`,
        headers: { host: bridge.host, accept: "application/json" },
        timeout: 3_000,
      },
      (res) => {
        if ((res.statusCode || 500) !== 200) {
          res.resume();
          resolve(new Map());
          return;
        }
        const chunks = [];
        let total = 0;
        res.on("data", (chunk) => {
          total += chunk.length;
          if (total <= 512_000) chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const forwards = Array.isArray(payload?.forwards)
              ? payload.forwards
              : [];
            const allowedMap = new Map();
            for (const entry of forwards) {
              if (entry?.status !== "connected") continue;
              const localPort = Number(entry?.localPort);
              if (
                !Number.isInteger(localPort) ||
                localPort < 1 ||
                localPort > 65_535 ||
                blockedPorts.has(localPort)
              ) {
                continue;
              }
              const localHost =
                entry?.localHost === "::1" ? "::1" : "127.0.0.1";
              allowedMap.set(localPort, { port: localPort, localHost });
            }
            resolve(allowedMap);
          } catch {
            resolve(new Map());
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(new Map());
    });
    req.on("error", () => resolve(new Map()));
    req.end();
  });
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

async function readJsonBody(request) {
  const raw = await readFormBody(request);
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON object body required");
  }
  return parsed;
}

async function readPrivateAccessState(stateFile) {
  try {
    const raw = JSON.parse(await readFile(stateFile, "utf8"));
    return raw && typeof raw === "object" ? raw : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writePrivateAccessState(stateFile, payload) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  const tempFile = `${stateFile}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(tempFile, 0o600).catch(() => {});
  await rename(tempFile, stateFile);
}

async function writePrivateAccessTokenFile(
  stateFile,
  token,
  rotatedAt = null,
  trustedDevices = [],
) {
  const payload = {
    token,
    createdAt: new Date().toISOString(),
    ...(rotatedAt ? { rotatedAt } : {}),
    trustedDevices: pruneTrustedDevices(trustedDevices),
  };
  await writePrivateAccessState(stateFile, payload);
}

export async function loadOrCreatePrivateAccessToken(
  stateFile = DEFAULT_STATE_FILE,
) {
  const state = await readPrivateAccessState(stateFile);
  if (state && typeof state.token === "string" && state.token.length >= 32) {
    return state.token;
  }

  const token = randomBytes(32).toString("base64url");
  await writePrivateAccessTokenFile(stateFile, token, null, []);
  return token;
}

export async function rotatePrivateAccessToken(
  stateFile = DEFAULT_STATE_FILE,
  { keepTrustedDevices = false } = {},
) {
  const existing = keepTrustedDevices
    ? await readPrivateAccessState(stateFile)
    : null;
  const kept = keepTrustedDevices
    ? pruneTrustedDevices(existing?.trustedDevices)
    : [];
  const token = randomBytes(32).toString("base64url");
  await writePrivateAccessTokenFile(
    stateFile,
    token,
    new Date().toISOString(),
    kept,
  );
  return token;
}

/**
 * Mint a single-use login code for one-tap Login URLs. Only its hash is stored
 * (next to the token, 0600); the running gateway consumes it on first use, and
 * rotating the access token discards every outstanding code.
 */
export async function createLoginCode(
  stateFile = DEFAULT_STATE_FILE,
  { ttlMs = LOGIN_CODE_TTL_MS } = {},
) {
  const state = await readPrivateAccessState(stateFile);
  if (!state || typeof state.token !== "string" || state.token.length < 32) {
    throw new Error("Private access token is not initialized");
  }
  const code = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const codes = pruneLoginCodes(state.loginCodes);
  codes.push({ hash: hashLoginCode(code), expiresAt });
  await writePrivateAccessState(stateFile, {
    ...state,
    loginCodes: codes.slice(-MAX_LOGIN_CODES),
  });
  return { code, expiresAt };
}

export async function listTrustedDevices(stateFile = DEFAULT_STATE_FILE) {
  const state = await readPrivateAccessState(stateFile);
  if (!state) return [];
  return pruneTrustedDevices(state.trustedDevices).map((device) =>
    serializeDevice(device),
  );
}

export async function revokeTrustedDevice(
  deviceId,
  stateFile = DEFAULT_STATE_FILE,
) {
  const state = await readPrivateAccessState(stateFile);
  if (!state || typeof state.token !== "string" || state.token.length < 32) {
    return { removedCount: 0, remainingCount: 0 };
  }
  const active = pruneTrustedDevices(state.trustedDevices);
  const next =
    deviceId === "*"
      ? []
      : active.filter((entry) => entry.id !== deviceId);
  const removedCount = active.length - next.length;
  if (removedCount > 0 || active.length !== (state.trustedDevices || []).length) {
    await writePrivateAccessState(stateFile, {
      ...state,
      trustedDevices: next,
    });
  }
  return { removedCount, remainingCount: next.length };
}

function defaultUiTarget() {
  return (
    process.env.SCOPE_PRIVATE_UI ||
    `http://127.0.0.1:${Number(process.env.SCOPE_UI_PORT || 3000)}`
  );
}

function defaultBridgeTarget() {
  return (
    process.env.SCOPE_PRIVATE_BRIDGE ||
    `http://127.0.0.1:${Number(process.env.SCOPE_BRIDGE_PORT || 4815)}`
  );
}

export function createPrivateGateway({
  token,
  tls,
  allowedClients = [],
  uiTarget = defaultUiTarget(),
  bridgeTarget = defaultBridgeTarget(),
  stateFile = null,
  trustedDeviceDays: explicitTrustedDeviceDays,
  portCacheTtlMs = 300,
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

  const trustedDays = resolveTrustedDeviceDays(explicitTrustedDeviceDays);
  const trustedTtlSeconds = trustedDays * 24 * 60 * 60;
  const trustedTtlMs = trustedTtlSeconds * 1000;

  let trustedDevices = [];
  // Temporary (untrusted-device) sessions: random per-login secrets kept only
  // in memory, so logout / revoke-others / restart invalidate them.
  const temporarySessions = new Map();

  const pruneTemporarySessions = (now = Date.now()) => {
    for (const [key, expiresAtMs] of temporarySessions) {
      if (expiresAtMs <= now) temporarySessions.delete(key);
    }
  };

  const mintTemporarySession = () => {
    const now = Date.now();
    pruneTemporarySessions(now);
    while (temporarySessions.size >= MAX_TEMPORARY_SESSIONS) {
      temporarySessions.delete(temporarySessions.keys().next().value);
    }
    const secret = randomBytes(32).toString("base64url");
    temporarySessions.set(
      hashSessionSecret(secret),
      now + SESSION_COOKIE_MAX_AGE_SECONDS * 1000,
    );
    return formatAuthCookie(`s.${secret}`, SESSION_COOKIE_MAX_AGE_SECONDS);
  };

  const consumeLoginCode = (code) => {
    if (!stateFile || typeof code !== "string" || code.length < 16) {
      return Promise.resolve(false);
    }
    const run = stateWriteQueue.then(async () => {
      const state = await readPrivateAccessState(stateFile);
      if (!state) return false;
      const codes = pruneLoginCodes(state.loginCodes);
      const wanted = hashLoginCode(code);
      const index = codes.findIndex((entry) => equalSecret(entry.hash, wanted));
      if (index < 0) return false;
      codes.splice(index, 1);
      await writePrivateAccessState(stateFile, { ...state, loginCodes: codes });
      return true;
    });
    stateWriteQueue = run.catch(() => {});
    return run.catch(() => false);
  };

  const temporarySessionKey = (raw) =>
    typeof raw === "string" && raw.startsWith("s.") && raw.length > 2
      ? hashSessionSecret(raw.slice(2))
      : null;
  let loadedStateMtimeMs = -1;
  let lastStateStatAt = 0;
  let stateWriteQueue = Promise.resolve();

  const syncTrustedDevicesFromDisk = async (force = false) => {
    if (!stateFile) return;
    const now = Date.now();
    if (!force && loadedStateMtimeMs >= 0 && now - lastStateStatAt < STATE_SYNC_INTERVAL_MS) {
      return;
    }
    lastStateStatAt = now;
    try {
      const info = await stat(stateFile);
      if (!force && info.mtimeMs === loadedStateMtimeMs) return;
      const state = await readPrivateAccessState(stateFile);
      trustedDevices = pruneTrustedDevices(state?.trustedDevices, now);
      loadedStateMtimeMs = info.mtimeMs;
    } catch (error) {
      if (error.code === "ENOENT") {
        loadedStateMtimeMs = 0;
      }
    }
  };

  const persistTrustedDevices = () => {
    if (!stateFile) return Promise.resolve();
    const snapshot = pruneTrustedDevices(trustedDevices);
    stateWriteQueue = stateWriteQueue
      .then(async () => {
        const existing = (await readPrivateAccessState(stateFile)) || {};
        const nextState = {
          ...existing,
          token:
            typeof existing.token === "string" && existing.token.length >= 32
              ? existing.token
              : token,
          createdAt: existing.createdAt || new Date().toISOString(),
          trustedDevices: snapshot,
        };
        await writePrivateAccessState(stateFile, nextState);
        const info = await stat(stateFile).catch(() => null);
        if (info) {
          loadedStateMtimeMs = info.mtimeMs;
          lastStateStatAt = Date.now();
        }
      })
      .catch(() => {});
    return stateWriteQueue;
  };

  const mintTrustedDevice = async ({ name, userAgent = "" }) => {
    await syncTrustedDevicesFromDisk(true);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expiresAt = new Date(now + trustedTtlMs).toISOString();
    const id = `dev_${randomBytes(8).toString("hex")}`;
    const secret = randomBytes(32).toString("base64url");
    const device = {
      id,
      name: sanitizeDeviceName(name, inferDeviceName(userAgent)),
      tokenHash: hashDeviceSecret(id, secret),
      userAgent: String(userAgent || "").slice(0, 240),
      createdAt: nowIso,
      lastSeenAt: nowIso,
      expiresAt,
    };
    const active = pruneTrustedDevices(trustedDevices, now);
    active.push(device);
    if (active.length > MAX_TRUSTED_DEVICES) {
      active.sort(
        (left, right) =>
          Date.parse(right.lastSeenAt || right.createdAt || 0) -
          Date.parse(left.lastSeenAt || left.createdAt || 0),
      );
      active.length = MAX_TRUSTED_DEVICES;
    }
    trustedDevices = active;
    await persistTrustedDevices();
    return {
      device,
      cookieHeader: formatAuthCookie(`d.${id}.${secret}`, trustedTtlSeconds),
    };
  };

  const resolveAuth = async (request) => {
    const cookies = parseCookies(request.headers.cookie);
    const raw = cookies[COOKIE_NAME] || "";
    if (!raw) return { ok: false, mode: null, device: null, refreshCookie: null };

    const parsedDevice = parseDeviceCookie(raw);
    if (parsedDevice) {
      await syncTrustedDevicesFromDisk();
      const now = Date.now();
      const device = trustedDevices.find((entry) => entry.id === parsedDevice.id);
      if (!device) {
        return { ok: false, mode: null, device: null, refreshCookie: null };
      }
      const expMs = Date.parse(device.expiresAt || "");
      if (!Number.isFinite(expMs) || expMs <= now) {
        return { ok: false, mode: null, device: null, refreshCookie: null };
      }
      const expected = hashDeviceSecret(parsedDevice.id, parsedDevice.secret);
      if (!equalSecret(expected, device.tokenHash)) {
        return { ok: false, mode: null, device: null, refreshCookie: null };
      }
      const lastSeenMs = Date.parse(device.lastSeenAt || device.createdAt || 0) || 0;
      let refreshCookie = null;
      const shouldRenew =
        now - lastSeenMs >= SLIDING_RENEW_INTERVAL_MS ||
        expMs - now < trustedTtlMs * 0.85;
      if (shouldRenew) {
        device.lastSeenAt = new Date(now).toISOString();
        device.expiresAt = new Date(now + trustedTtlMs).toISOString();
        refreshCookie = formatAuthCookie(raw, trustedTtlSeconds);
        void persistTrustedDevices();
      } else if (now - lastSeenMs >= TOUCH_PERSIST_INTERVAL_MS) {
        device.lastSeenAt = new Date(now).toISOString();
        void persistTrustedDevices();
      }
      return { ok: true, mode: "trusted-device", device, refreshCookie };
    }

    const sessionKey = temporarySessionKey(raw);
    if (sessionKey) {
      const expiresAtMs = temporarySessions.get(sessionKey);
      if (expiresAtMs && expiresAtMs > Date.now()) {
        return { ok: true, mode: "session", device: null, sessionKey, refreshCookie: null };
      }
      temporarySessions.delete(sessionKey);
    }

    return { ok: false, mode: null, device: null, refreshCookie: null };
  };

  const listPublicDevices = async (currentDeviceId = null) => {
    await syncTrustedDevicesFromDisk(true);
    const active = pruneTrustedDevices(trustedDevices);
    trustedDevices = active;
    return [...active]
      .sort(
        (left, right) =>
          Date.parse(right.lastSeenAt || right.createdAt || 0) -
          Date.parse(left.lastSeenAt || left.createdAt || 0),
      )
      .map((device) => serializeDevice(device, currentDeviceId));
  };

  const blockedPorts = new Set(BLOCKED_PROXY_PORTS);
  if (ui.port) blockedPorts.add(Number(ui.port));
  if (bridge.port) blockedPorts.add(Number(bridge.port));

  let portCache = new Map();
  let portCacheFetchedAt = 0;
  let portFetchInFlight = null;

  const invalidatePortCache = () => {
    portCacheFetchedAt = 0;
  };

  let server;
  const isBlockedProxyPort = (port) => {
    if (blockedPorts.has(port)) return true;
    const addr = server?.address?.();
    if (addr && typeof addr === "object" && addr.port === port) return true;
    return false;
  };

  const refreshAllowedPorts = async () => {
    if (!portFetchInFlight) {
      portFetchInFlight = fetchAllowedPortsFromBridge(bridge, blockedPorts)
        .then((next) => {
          portCache = next;
          portCacheFetchedAt = Date.now();
          return next;
        })
        .finally(() => {
          portFetchInFlight = null;
        });
    }
    return portFetchInFlight;
  };

  const resolveAllowedPortTarget = async (port) => {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
    if (isBlockedProxyPort(port)) return null;
    const now = Date.now();
    const fresh = portCacheTtlMs > 0 && now - portCacheFetchedAt <= portCacheTtlMs;
    if (fresh && portCache.has(port)) {
      return portCache.get(port);
    }
    const next = await refreshAllowedPorts();
    return next.get(port) || null;
  };

  const handler = async (request, response) => {
    if (!allowed(request)) {
      response.writeHead(403); response.end("Client address is not allowed"); return;
    }
    const requestUrl = new URL(request.url || "/", "http://scope.local");

    if (request.method === "POST" && requestUrl.pathname === "/scope-auth") {
      if (!hasSafeWriteOrigin(request, { allowOpaqueLoginOrigin: true })) {
        securityHeaders(response);
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Cross-site login rejected" }));
        return;
      }
      try {
        const form = new URLSearchParams(await readFormBody(request));
        const nextTarget = safeRedirectTarget(form.get("next") || "/");
        if (!equalSecret(form.get("token") || "", token)) {
          sendLogin(response, "访问密钥不正确。", {
            nextPath: nextTarget,
            userAgent: request.headers["user-agent"] || "",
            trustedDeviceDays: trustedDays,
          });
          return;
        }
        const trustParam = form.get("trustDevice");
        const trustDevice = trustParam === "1" || trustParam === "on" || trustParam === "true";
        let setCookieHeader;
        if (trustDevice) {
          const minted = await mintTrustedDevice({
            name: form.get("deviceName") || "",
            userAgent: request.headers["user-agent"] || "",
          });
          setCookieHeader = minted.cookieHeader;
        } else {
          setCookieHeader = mintTemporarySession();
        }
        securityHeaders(response);
        response.writeHead(303, {
          Location: nextTarget,
          "Set-Cookie": setCookieHeader,
        });
        response.end();
      } catch {
        sendLogin(response, "请求无效。", {
          userAgent: request.headers["user-agent"] || "",
          trustedDeviceDays: trustedDays,
        });
      }
      return;
    }

    const loginCode = requestUrl.searchParams.get(LOGIN_CODE_PARAM);
    if (loginCode !== null) {
      const trustFlag = requestUrl.searchParams.get("trust");
      requestUrl.searchParams.delete(LOGIN_CODE_PARAM);
      requestUrl.searchParams.delete("trust");
      const nextPath = safeRedirectTarget(`${requestUrl.pathname}${requestUrl.search}`);
      if (!(await consumeLoginCode(loginCode))) {
        sendLogin(response, "一次性登录链接无效、已使用或已过期，请重新生成或手动输入访问密钥。", {
          nextPath,
          userAgent: request.headers["user-agent"] || "",
          trustedDeviceDays: trustedDays,
        });
        return;
      }
      const setCookieHeader =
        trustFlag === "0" || trustFlag === "false"
          ? mintTemporarySession()
          : (
              await mintTrustedDevice({
                name: "",
                userAgent: request.headers["user-agent"] || "",
              })
            ).cookieHeader;
      securityHeaders(response);
      response.writeHead(303, { Location: nextPath, "Set-Cookie": setCookieHeader });
      response.end();
      return;
    }

    // Legacy `?token=<master token>` links no longer sign anyone in. Strip the
    // secret from the address bar (and keep it away from upstream apps).
    const legacyToken = requestUrl.searchParams.get("token");
    if (legacyToken && equalSecret(legacyToken, token)) {
      requestUrl.searchParams.delete("token");
      requestUrl.searchParams.delete("trust");
      securityHeaders(response);
      response.writeHead(303, {
        Location: safeRedirectTarget(`${requestUrl.pathname}${requestUrl.search}`),
      });
      response.end();
      return;
    }

    const auth = await resolveAuth(request);
    if (!auth.ok) {
      sendLogin(response, "", {
        nextPath: `${requestUrl.pathname}${requestUrl.search}`,
        userAgent: request.headers["user-agent"] || "",
        trustedDeviceDays: trustedDays,
      });
      return;
    }

    if (!hasSafeWriteOrigin(request)) {
      securityHeaders(response);
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Cross-site write rejected" }));
      return;
    }

    if (requestUrl.pathname === "/scope-auth/session" && request.method === "GET") {
      const devices = await listPublicDevices(auth.device?.id || null);
      sendJson(
        response,
        200,
        {
          gateway: true,
          authMode: auth.mode,
          currentDeviceId: auth.device?.id || null,
          trustedDeviceDays: trustedDays,
          devices,
        },
        auth.refreshCookie ? { "Set-Cookie": auth.refreshCookie } : {},
      );
      return;
    }

    if (
      requestUrl.pathname === "/scope-auth/devices/trust" &&
      request.method === "POST"
    ) {
      try {
        const body = await readJsonBody(request);
        const ua = request.headers["user-agent"] || "";
        const desiredName = sanitizeDeviceName(body.name, inferDeviceName(ua));
        if (auth.device) {
          await syncTrustedDevicesFromDisk(true);
          const existing = trustedDevices.find((item) => item.id === auth.device.id);
          if (existing) {
            existing.name = desiredName;
            existing.lastSeenAt = new Date().toISOString();
            existing.expiresAt = new Date(Date.now() + trustedTtlMs).toISOString();
            await persistTrustedDevices();
            const devices = await listPublicDevices(existing.id);
            sendJson(response, 200, {
              ok: true,
              device: serializeDevice(existing, existing.id),
              devices,
            });
            return;
          }
        }
        const minted = await mintTrustedDevice({ name: desiredName, userAgent: ua });
        if (auth.sessionKey) temporarySessions.delete(auth.sessionKey);
        const devices = await listPublicDevices(minted.device.id);
        sendJson(
          response,
          200,
          {
            ok: true,
            device: serializeDevice(minted.device, minted.device.id),
            devices,
          },
          { "Set-Cookie": minted.cookieHeader },
        );
      } catch (error) {
        sendJson(response, 400, { error: error.message || "Invalid request" });
      }
      return;
    }

    if (
      requestUrl.pathname === "/scope-auth/devices/revoke-others" &&
      request.method === "POST"
    ) {
      await syncTrustedDevicesFromDisk(true);
      const keepId = auth.device?.id || null;
      const before = pruneTrustedDevices(trustedDevices);
      trustedDevices = keepId
        ? before.filter((item) => item.id === keepId)
        : [];
      let removedSessions = 0;
      for (const key of [...temporarySessions.keys()]) {
        if (key === auth.sessionKey) continue;
        temporarySessions.delete(key);
        removedSessions += 1;
      }
      const removedCount = before.length - trustedDevices.length;
      await persistTrustedDevices();
      const devices = await listPublicDevices(keepId);
      sendJson(response, 200, { ok: true, removedCount, removedSessions, devices });
      return;
    }

    if (requestUrl.pathname === "/scope-auth/logout" && request.method === "POST") {
      if (auth.sessionKey) temporarySessions.delete(auth.sessionKey);
      if (auth.device?.id) {
        await syncTrustedDevicesFromDisk(true);
        trustedDevices = pruneTrustedDevices(trustedDevices).filter(
          (item) => item.id !== auth.device.id,
        );
        await persistTrustedDevices();
      }
      sendJson(
        response,
        200,
        { ok: true },
        { "Set-Cookie": formatClearedAuthCookie() },
      );
      return;
    }

    const deviceMatch = /^\/scope-auth\/devices\/([a-z0-9_-]{8,36})$/i.exec(
      requestUrl.pathname,
    );
    if (deviceMatch) {
      const targetId = deviceMatch[1];
      if (request.method === "PATCH") {
        try {
          const body = await readJsonBody(request);
          const nextName = sanitizeDeviceName(body.name, "");
          if (!nextName) {
            sendJson(response, 400, { error: "Device name is required" });
            return;
          }
          await syncTrustedDevicesFromDisk(true);
          const target = trustedDevices.find((item) => item.id === targetId);
          if (!target) {
            sendJson(response, 404, { error: "Trusted device not found" });
            return;
          }
          target.name = nextName;
          await persistTrustedDevices();
          const devices = await listPublicDevices(auth.device?.id || null);
          sendJson(response, 200, {
            ok: true,
            device: serializeDevice(target, auth.device?.id || null),
            devices,
          });
        } catch (error) {
          sendJson(response, 400, { error: error.message || "Invalid request" });
        }
        return;
      }
      if (request.method === "DELETE") {
        await syncTrustedDevicesFromDisk(true);
        const before = pruneTrustedDevices(trustedDevices);
        trustedDevices = before.filter((item) => item.id !== targetId);
        const removed = before.length !== trustedDevices.length;
        if (!removed) {
          sendJson(response, 404, { error: "Trusted device not found" });
          return;
        }
        await persistTrustedDevices();
        const revokedCurrent = Boolean(auth.device?.id && auth.device.id === targetId);
        const devices = await listPublicDevices(
          revokedCurrent ? null : auth.device?.id || null,
        );
        sendJson(
          response,
          200,
          { ok: true, revokedCurrent, devices },
          revokedCurrent ? { "Set-Cookie": formatClearedAuthCookie() } : {},
        );
        return;
      }
    }

    if (requestUrl.pathname.startsWith("/scope-port/")) {
      const parsed = parsePortProxyPath(requestUrl.pathname);
      if (!parsed) {
        securityHeaders(response);
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Invalid port proxy path" }));
        return;
      }
      const targetInfo = await resolveAllowedPortTarget(parsed.port);
      if (!targetInfo) {
        securityHeaders(response);
        response.writeHead(403, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            error: `Port ${parsed.port} is not currently open in SCOPE`,
          }),
        );
        return;
      }
      if (parsed.needsTrailingSlash) {
        portProxySecurityHeaders(response);
        response.writeHead(307, {
          Location: `/scope-port/${parsed.port}/${requestUrl.search}`,
        });
        response.end();
        return;
      }
      proxyPortRequest(
        request,
        response,
        loopbackUrlForPort(targetInfo.localHost, targetInfo.port),
        `${parsed.suffix}${requestUrl.search}`,
        parsed.port,
      );
      return;
    }

    if (requestUrl.pathname.startsWith("/scope-api/")) {
      const apiPath = requestUrl.pathname.slice("/scope-api".length);
      if (apiPath.startsWith("/api/port-forwards")) {
        invalidatePortCache();
        response.once("finish", invalidatePortCache);
      }
      proxyRequest(
        request,
        response,
        bridge,
        `${apiPath}${requestUrl.search}`,
        true,
        auth.refreshCookie,
      );
      return;
    }
    proxyRequest(
      request,
      response,
      ui,
      `${requestUrl.pathname}${requestUrl.search}`,
      false,
      auth.refreshCookie,
    );
  };
  server = tls ? https.createServer(tls, handler) : http.createServer(handler);

  server.on("upgrade", async (request, socket, head) => {
    try {
      if (!allowed(request) || (request.headers.origin && !hasSafeWriteOrigin({ headers: request.headers, method: "POST" }))) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      const wsAuth = await resolveAuth(request);
      if (!wsAuth.ok) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const requestUrl = new URL(request.url || "/", "http://scope.local");
      if (requestUrl.pathname.startsWith("/scope-port/")) {
        const parsed = parsePortProxyPath(requestUrl.pathname);
        if (!parsed) {
          socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
          return;
        }
        const targetInfo = await resolveAllowedPortTarget(parsed.port);
        if (!targetInfo) {
          socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          return;
        }
        const target = loopbackUrlForPort(targetInfo.localHost, targetInfo.port);
        const upstreamPath = `${parsed.suffix || "/"}${requestUrl.search}`;
        proxyUpgrade(
          request,
          socket,
          head,
          target,
          upstreamPath,
          false,
          sanitizePortProxyHeaders(
            request,
            target,
            `/scope-port/${parsed.port}`,
            { isUpgrade: true },
          ),
        );
        return;
      }
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
    } catch {
      socket.destroy();
    }
  });

  return server;
}

export async function startPrivateGateway({
  host = "127.0.0.1",
  port = Number(process.env.SCOPE_PRIVATE_PORT || 4820),
  stateFile = process.env.SCOPE_PRIVATE_STATE || DEFAULT_STATE_FILE,
  uiTarget = defaultUiTarget(),
  bridgeTarget = defaultBridgeTarget(),
  trustedDeviceDays,
} = {}) {
  if (!isLoopbackHostname(host)) {
    throw new Error("Private gateway must listen on loopback");
  }
  const token =
    process.env.SCOPE_PRIVATE_GATEWAY_TOKEN ||
    (await loadOrCreatePrivateAccessToken(stateFile));
  const server = createPrivateGateway({
    token,
    stateFile,
    uiTarget,
    bridgeTarget,
    trustedDeviceDays,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return { server, token, host, port, stateFile };
}
