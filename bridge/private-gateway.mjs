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
// Isolated port-proxy origin (opt-in via SCOPE_PORT_ORIGIN): forwarded apps are
// served from a different host and never share the control-plane origin.
const PORT_SESSION_COOKIE = "scope_port";
const PORT_TICKET_PARAM = "__scope_port_ticket";
const PORT_TICKET_TTL_MS = 60 * 1000;
const PORT_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const MAX_PORT_TICKETS = 200;
const MAX_PORT_SESSIONS = 200;
// Response headers a forwarded app must never be able to set on a SCOPE origin.
const PORT_PROXY_STRIPPED_RESPONSE_HEADERS = [
  "service-worker-allowed",
  "clear-site-data",
];
const DEFAULT_TRUSTED_DEVICE_DAYS = 90;
const SESSION_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;
const MAX_TRUSTED_DEVICES = 50;
const SLIDING_RENEW_INTERVAL_MS = 12 * 60 * 60 * 1000;
const TOUCH_PERSIST_INTERVAL_MS = 5 * 60 * 1000;
const STATE_SYNC_INTERVAL_MS = 1_500;
const PORT_PROXY_PREFIX_RE = /^\/scope-port\/(\d+)(?:(\/.*))?$/;
const PUBLIC_SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;
const SHARE_ORIGIN_PREFIX_RE = /^\/s\/([A-Za-z0-9_-]{24,64})(?:(\/.*))?$/;
const SAME_ORIGIN_SHARE_PREFIX_RE = /^\/scope-share\/([A-Za-z0-9_-]{24,64})(?:(\/.*))?$/;
const PUBLIC_SHARE_ALLOWED_METHODS = new Set(["GET", "HEAD"]);
const PUBLIC_SHARE_SAFE_UPSTREAM_HEADERS = [
  "accept",
  "accept-language",
  "range",
  "if-none-match",
  "if-modified-since",
  "user-agent",
  "cache-control",
  "pragma",
];
const PORT_PROXY_MAX_HTML_BYTES = 2 * 1024 * 1024;
const BLOCKED_PROXY_PORTS = new Set([
  22, 53, 2019, 3000, 4815, 4820, 4822, 4880, 4922,
]);

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

export function parsePublicSharePath(pathname = "", { sameOrigin = false } = {}) {
  const re = sameOrigin ? SAME_ORIGIN_SHARE_PREFIX_RE : SHARE_ORIGIN_PREFIX_RE;
  const match = re.exec(pathname);
  if (!match) return null;
  const token = match[1];
  const suffix = match[2] || "";
  const prefix = sameOrigin ? `/scope-share/${token}` : `/s/${token}`;
  return {
    token,
    prefix,
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
        name !== PORT_SESSION_COOKIE &&
        name !== "CF_Authorization" &&
        name !== "CF_AppSession"
      );
    })
    .join("; ");
}

function portProxySecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
}

function publicShareSecurityHeaders(response) {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
}

function sendPublicShareHtml(response, statusCode, { title, summary, detail = "" }) {
  publicShareSecurityHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:20px;background:#f8fafc;color:#0f172a;font:15px/1.6 system-ui,-apple-system,sans-serif}
main{width:min(520px,100%);background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:26px 24px;box-shadow:0 12px 32px rgba(15,23,42,.08)}
.code{display:inline-block;padding:2px 8px;border-radius:999px;background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-size:12px;font-weight:700;margin-bottom:10px}
h1{margin:0 0 8px;font-size:20px;line-height:1.3}
p{margin:0 0 12px;color:#334155}
pre{margin:0;padding:10px 12px;border-radius:10px;background:#f1f5f9;color:#475569;font:12.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow:auto;white-space:pre-wrap;word-break:break-word}
</style>
<main>
<span class="code">HTTP ${statusCode}</span>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(summary)}</p>
${detail ? `<pre>${escapeHtml(detail)}</pre>` : ""}
</main>`);
}

function acceptsHtml(request) {
  const accept = String(request.headers.accept || "").toLowerCase();
  return accept.includes("text/html");
}

function sendPortProxyDiagnosticHtml(response, statusCode, { title, summary, detail = "", tips = [] }) {
  portProxySecurityHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  const tipsHtml = tips.length
    ? `<ul>${tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join("")}</ul>`
    : "";
  response.end(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · SCOPE</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:20px;background:#f8fafc;color:#0f172a;font:15px/1.6 system-ui,-apple-system,sans-serif}
main{width:min(560px,100%);background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:26px 24px;box-shadow:0 12px 32px rgba(15,23,42,.08)}
.code{display:inline-block;padding:2px 8px;border-radius:999px;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:12px;font-weight:700;margin-bottom:10px}
h1{margin:0 0 8px;font-size:20px;line-height:1.3}
p{margin:0 0 12px;color:#334155}
pre{margin:0 0 14px;padding:10px 12px;border-radius:10px;background:#f1f5f9;color:#475569;font:12.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow:auto;white-space:pre-wrap;word-break:break-word}
ul{margin:0 0 18px;padding-left:20px;color:#475569;font-size:13.5px}
li{margin-bottom:6px}
.actions{display:flex;gap:10px;flex-wrap:wrap}
a,button{appearance:none;border-radius:10px;padding:9px 15px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none}
button{border:0;background:#0f172a;color:#fff}
a{border:1px solid #cbd5e1;background:#fff;color:#0f172a}
</style>
<main>
<span class="code">HTTP ${statusCode}</span>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(summary)}</p>
${detail ? `<pre>${escapeHtml(detail)}</pre>` : ""}
${tipsHtml}
<div class="actions"><button type="button" onclick="location.reload()">重试连接</button><a href="/">返回 SCOPE 工作台</a></div>
</main>`);
}

export function rewriteProxyLocation(location, prefix, port, remotePort = port) {
  if (typeof location !== "string" || !location) return location;
  if (location.startsWith("/") && !location.startsWith("//")) {
    if (
      location === prefix ||
      location.startsWith(`${prefix}/`) ||
      location.startsWith("/cdn-cgi/")
    ) {
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
      if (
        isLoopbackHostname(host) &&
        (parsedPort === port || (remotePort && parsedPort === Number(remotePort)))
      ) {
        return `${prefix}${parsed.pathname || "/"}${parsed.search || ""}${parsed.hash || ""}`;
      }
    }
  } catch {
    /* keep relative or non-URL locations untouched */
  }
  return location;
}

export function rewritePortProxyLocation(location, port, remotePort = port) {
  return rewriteProxyLocation(location, `/scope-port/${port}`, port, remotePort);
}

export function rewriteProxyCss(css, prefix) {
  if (typeof css !== "string" || !css) return css;
  const escapedPrefix = escapeRegExp(prefix.replace(/^\//, ""));
  const re = new RegExp(
    `url\\(\\s*(["']?)\\/(?!\\/|${escapedPrefix}\\/)([^)"']*)\\1\\s*\\)`,
    "gi",
  );
  return css.replace(
    re,
    (_m, quote, rest) => `url(${quote}${prefix}/${rest}${quote})`,
  );
}

export function rewritePortProxyCss(css, port) {
  return rewriteProxyCss(css, `/scope-port/${port}`);
}

function rewritePortProxySetCookie(setCookie, port) {
  const prefix = `/scope-port/${port}/`;
  const isReservedCookie = (value) => {
    const eq = value.indexOf("=");
    const name = (eq >= 0 ? value.slice(0, eq) : value).trim();
    return (
      name === COOKIE_NAME ||
      name === PORT_SESSION_COOKIE ||
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

function buildProxyRuntimeShim(prefix, { allowWebSocket = true } = {}) {
  const wsPatch = allowWebSocket
    ? `var W=window.WebSocket;if(typeof W==="function"){var SW=function(u,p){var nu=typeof u==="string"?rw(u):u;return p!==undefined?new W(nu,p):new W(nu);};SW.prototype=W.prototype;SW.CONNECTING=W.CONNECTING;SW.OPEN=W.OPEN;SW.CLOSING=W.CLOSING;SW.CLOSED=W.CLOSED;window.WebSocket=SW;}var E=window.EventSource;if(typeof E==="function"){var SE=function(u,c){return new E(typeof u==="string"?rw(u):u,c);};SE.prototype=E.prototype;window.EventSource=SE;}`
    : "";
  return `<script data-scope-port-shim>(function(){var P=${JSON.stringify(prefix)};function rw(u){if(typeof u!=="string"||!u)return u;if(u.indexOf(P+"/")===0||u===P||u.indexOf("/cdn-cgi/")===0)return u;if(u[0]==="/"&&u[1]!=="/")return P+u;try{var x=new URL(u,location.href);if(x.origin===location.origin&&x.pathname.indexOf(P+"/")!==0&&x.pathname!==P&&x.pathname.indexOf("/cdn-cgi/")!==0){return x.origin+P+x.pathname+x.search+x.hash;}if((x.protocol==="ws:"||x.protocol==="wss:")&&x.host===location.host&&x.pathname.indexOf(P+"/")!==0&&x.pathname!==P&&x.pathname.indexOf("/cdn-cgi/")!==0){return x.protocol+"//"+x.host+P+x.pathname+x.search+x.hash;}}catch(e){}return u;}var f=window.fetch;if(typeof f==="function"){window.fetch=function(i,n){if(typeof i==="string"){i=rw(i);}else if(i&&typeof Request!=="undefined"&&i instanceof Request){var ni=rw(i.url);if(ni!==i.url)i=new Request(ni,i);}return f.call(this,i,n);};}var X=window.XMLHttpRequest;if(X&&X.prototype&&X.prototype.open){var xo=X.prototype.open;X.prototype.open=function(m,u){var a=[].slice.call(arguments);if(typeof u==="string")a[1]=rw(u);return xo.apply(this,a);};}${wsPatch}})();</script>`;
}

export function rewriteProxyHtml(
  html,
  prefix,
  { injectRuntimeShim = true, allowWebSocket = true } = {},
) {
  if (typeof html !== "string" || !html) return html;
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
  const escapedPrefix = escapeRegExp(prefix.replace(/^\//, ""));
  const attrRe = new RegExp(
    `(\\b(?:href|src|action|poster)\\s*=\\s*)(["'])\\/(?!\\/|cdn-cgi\\/|${escapedPrefix}\\/)`,
    "gi",
  );
  out = out.replace(attrRe, `$1$2${prefix}/`);
  out = out.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m, open, body, close) => `${open}${rewriteProxyCss(body, prefix)}${close}`,
  );
  if (injectRuntimeShim && !out.includes("data-scope-port-shim")) {
    const shim = buildProxyRuntimeShim(prefix, { allowWebSocket });
    if (/<script\b/i.test(out)) {
      out = out.replace(/<script\b/i, (tag) => `${shim}${tag}`);
    } else if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, (tag) => `${shim}${tag}`);
    } else {
      out = `${out}${shim}`;
    }
  }
  return out;
}

export function rewritePortProxyHtml(
  html,
  port,
  { injectRuntimeShim = true } = {},
) {
  return rewriteProxyHtml(html, `/scope-port/${port}`, {
    injectRuntimeShim,
    allowWebSocket: true,
  });
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

/**
 * Validate an isolated port-proxy origin such as `https://scope-ports.example.com`.
 * Plain http:// is only accepted for loopback / `*.localhost` test hosts.
 */
export function parsePortOrigin(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw new Error(`Invalid port origin: ${value}`);
  }
  const host = parsed.hostname.toLowerCase();
  const localTestHost = isLoopbackHostname(host) || host.endsWith(".localhost");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localTestHost)) {
    throw new Error("Port origin must use https:// (http:// only for *.localhost tests)");
  }
  if (
    (parsed.pathname && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Port origin must be a bare origin like https://scope-ports.example.com");
  }
  return parsed;
}

function hashPortSecret(kind, secret) {
  return createHash("sha256")
    .update(`scope-port-${kind}:${secret}`)
    .digest("base64url");
}

function formatPortSessionCookie(value, maxAgeSeconds) {
  const safeMaxAge = Math.max(0, Math.round(maxAgeSeconds));
  return `${PORT_SESSION_COOKIE}=${value}; Path=/scope-port/; HttpOnly; Secure; SameSite=Lax; Max-Age=${safeMaxAge}`;
}

function isServiceWorkerScriptRequest(request) {
  return String(request.headers["service-worker"] || "").toLowerCase() === "script";
}

function sendPortOriginText(response, statusCode, message) {
  portProxySecurityHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
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
  const bodyless =
    (request.method === "GET" || request.method === "HEAD") &&
    !request.headers["content-length"] &&
    !request.headers["transfer-encoding"];
  if (bodyless) {
    upstream.end();
  } else {
    request.pipe(upstream);
  }
}

function upstreamHostHeaderForPort(target, remotePort) {
  const parsed = Number(remotePort);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 && parsed !== Number(target.port)) {
    const host = target.hostname.includes(":") ? `[${target.hostname.replace(/^\[|\]$/g, "")}]` : target.hostname;
    return parsed === 80 ? host : `${host}:${parsed}`;
  }
  return target.host;
}

function sanitizePortProxyHeaders(
  request,
  target,
  prefix,
  { isUpgrade = false, upstreamHostHeader = target.host } = {},
) {
  const forwarded = { ...request.headers, host: upstreamHostHeader };
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
    for (const hop of [
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "proxy-connection",
      "te",
      "trailer",
      "upgrade",
    ]) {
      delete forwarded[hop];
    }
  }
  if (request.headers.origin) {
    try {
      const originHost = new URL(request.headers.origin).host;
      if (originHost === request.headers.host) {
        forwarded.origin = `http://${upstreamHostHeader}`;
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
        forwarded.referer = `http://${upstreamHostHeader}${stripped}${ref.search}`;
      } else {
        delete forwarded.referer;
      }
    } catch {
      delete forwarded.referer;
    }
  }
  return forwarded;
}

function sendPortProxyUpstreamError(request, response, port, message) {
  console.warn(
    `[scope-port] 502 port=${port} method=${request.method || "GET"} path=${request.url || "/"}: ${message}`,
  );
  if (acceptsHtml(request)) {
    sendPortProxyDiagnosticHtml(response, 502, {
      title: `端口 ${port} 的服务未能返回有效 HTTP 响应`,
      summary: `SCOPE 网关已接通转发通道，但目标服务（127.0.0.1:${port}）提前断开了连接或未响应 HTTP 协议。`,
      detail: message,
      tips: [
        "如果服务是在 Agent 会话里后台启动的（例如 python3 -m http.server），终端关闭后 stdout/stderr 管道失效会导致每次请求直接断连；请以 </dev/null >/dev/null 2>&1 方式重启服务。",
        "确认远端或本机进程仍在运行，且该端口提供的是 HTTP 服务（非纯 TCP / VNC / HTTPS-only 端口）。",
        "确认服务监听在 127.0.0.1、::1 或 0.0.0.0 上，然后在 SCOPE 端口面板刷新状态后重试。",
      ],
    });
    return;
  }
  portProxySecurityHeaders(response);
  response.writeHead(502, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: message }));
}

function proxyPortRequest(
  request,
  response,
  target,
  upstreamPath,
  port,
  { remotePort = port } = {},
) {
  const prefix = `/scope-port/${port}`;
  const upstreamHostHeader = upstreamHostHeaderForPort(target, remotePort);
  const upstream = http.request(
    {
      hostname: target.hostname.replace(/^\[|\]$/g, ""),
      port: target.port,
      method: request.method,
      path: upstreamPath,
      headers: sanitizePortProxyHeaders(request, target, prefix, {
        upstreamHostHeader,
      }),
    },
    (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers };
      delete headers["access-control-allow-origin"];
      delete headers["access-control-allow-credentials"];
      delete headers.connection;
      delete headers["keep-alive"];
      delete headers["proxy-connection"];
      delete headers.upgrade;
      for (const name of PORT_PROXY_STRIPPED_RESPONSE_HEADERS) delete headers[name];
      const statusCode = upstreamResponse.statusCode || 502;
      if (
        statusCode >= 300 &&
        statusCode < 400 &&
        typeof headers.location === "string"
      ) {
        headers.location = rewritePortProxyLocation(
          headers.location,
          port,
          remotePort,
        );
      }
      if (headers["set-cookie"]) {
        const scoped = rewritePortProxySetCookie(headers["set-cookie"], port);
        if (scoped) headers["set-cookie"] = scoped;
        else delete headers["set-cookie"];
      }
      const contentType = String(headers["content-type"] || "").toLowerCase();
      const isHtml =
        request.method !== "HEAD" &&
        contentType.includes("text/html") &&
        !headers["content-encoding"];
      const isCss =
        request.method !== "HEAD" &&
        contentType.includes("text/css") &&
        !headers["content-encoding"];
      if (!isHtml && !isCss) {
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
        const rawText = Buffer.concat(chunks).toString("utf8");
        const rewritten = isHtml
          ? rewritePortProxyHtml(rawText, port, {
              injectRuntimeShim: !headers["content-security-policy"],
            })
          : rewritePortProxyCss(rawText, port);
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
          sendPortProxyUpstreamError(
            request,
            response,
            port,
            `Proxied local service error: ${error.message}`,
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
    sendPortProxyUpstreamError(
      request,
      response,
      port,
      `Proxied local service unavailable: ${error.message}`,
    );
  });
  const bodyless =
    (request.method === "GET" || request.method === "HEAD") &&
    !request.headers["content-length"] &&
    !request.headers["transfer-encoding"];
  if (bodyless) {
    upstream.end();
  } else {
    request.pipe(upstream);
  }
}

function sendPublicShareUpstreamError(request, response, message) {
  if (acceptsHtml(request)) {
    sendPublicShareHtml(response, 502, {
      title: "分享文档暂时不可访问",
      summary: "上游静态文档服务未返回有效的 HTTP 响应，请稍后重试或联系分享者确认服务正在运行。",
      detail: message,
    });
    return;
  }
  publicShareSecurityHeaders(response);
  response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: message }));
}

function sanitizePublicShareHeaders(
  request,
  prefix,
  { upstreamHostHeader },
) {
  const forwarded = {
    host: upstreamHostHeader,
    "accept-encoding": "identity",
    "x-forwarded-prefix": prefix,
    "x-forwarded-proto":
      request.headers["x-forwarded-proto"] ||
      (request.socket?.encrypted ? "https" : "http"),
  };
  for (const name of PUBLIC_SHARE_SAFE_UPSTREAM_HEADERS) {
    const value = request.headers[name];
    if (typeof value === "string" && value) {
      forwarded[name] = value;
    }
  }
  return forwarded;
}

function proxyPublicShareRequest(
  request,
  response,
  target,
  upstreamPath,
  prefix,
  { port, remotePort = port } = {},
) {
  const upstreamHostHeader = upstreamHostHeaderForPort(target, remotePort);
  const upstream = http.request(
    {
      hostname: target.hostname.replace(/^\[|\]$/g, ""),
      port: target.port,
      method: request.method,
      path: upstreamPath,
      headers: sanitizePublicShareHeaders(request, prefix, {
        upstreamHostHeader,
      }),
    },
    (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers };
      delete headers["set-cookie"];
      delete headers["access-control-allow-origin"];
      delete headers["access-control-allow-credentials"];
      delete headers["www-authenticate"];
      delete headers.connection;
      delete headers["keep-alive"];
      delete headers["proxy-connection"];
      delete headers.upgrade;
      for (const name of PORT_PROXY_STRIPPED_RESPONSE_HEADERS) delete headers[name];
      const statusCode = upstreamResponse.statusCode || 502;
      if (
        statusCode >= 300 &&
        statusCode < 400 &&
        typeof headers.location === "string"
      ) {
        headers.location = rewriteProxyLocation(
          headers.location,
          prefix,
          port,
          remotePort,
        );
      }
      const contentType = String(headers["content-type"] || "").toLowerCase();
      const isHtml =
        request.method !== "HEAD" &&
        contentType.includes("text/html") &&
        !headers["content-encoding"];
      const isCss =
        request.method !== "HEAD" &&
        contentType.includes("text/css") &&
        !headers["content-encoding"];
      if (!isHtml && !isCss) {
        publicShareSecurityHeaders(response);
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
          publicShareSecurityHeaders(response);
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
        const rawText = Buffer.concat(chunks).toString("utf8");
        const rewritten = isHtml
          ? rewriteProxyHtml(rawText, prefix, {
              injectRuntimeShim: !headers["content-security-policy"],
              allowWebSocket: false,
            })
          : rewriteProxyCss(rawText, prefix);
        const body = Buffer.from(rewritten, "utf8");
        delete headers["transfer-encoding"];
        headers["content-length"] = String(body.length);
        publicShareSecurityHeaders(response);
        response.writeHead(statusCode, headers);
        response.end(body);
      });
      upstreamResponse.on("error", (error) => {
        if (response.headersSent) response.destroy(error);
        else {
          sendPublicShareUpstreamError(
            request,
            response,
            `Shared document service error: ${error.message}`,
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
    sendPublicShareUpstreamError(
      request,
      response,
      `Shared document service unavailable: ${error.message}`,
    );
  });
  upstream.end();
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
  const empty = () => ({ ports: new Map(), shares: new Map() });
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
          resolve(empty());
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
            const sharesMap = new Map();
            const nowMs = Date.now();
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
              const parsedRemote = Number(entry?.remotePort);
              const remotePort =
                Number.isInteger(parsedRemote) &&
                parsedRemote >= 1 &&
                parsedRemote <= 65_535
                  ? parsedRemote
                  : localPort;
              allowedMap.set(localPort, { port: localPort, remotePort, localHost });
              const share = entry?.publicShare;
              if (
                share &&
                typeof share.token === "string" &&
                PUBLIC_SHARE_TOKEN_RE.test(share.token)
              ) {
                const expMs = share.expiresAt ? Date.parse(share.expiresAt) : null;
                if (expMs === null || (Number.isFinite(expMs) && expMs > nowMs)) {
                  sharesMap.set(share.token, {
                    token: share.token,
                    port: localPort,
                    remotePort,
                    localHost,
                    label: typeof entry.label === "string" ? entry.label : "",
                    expiresAt: share.expiresAt || null,
                  });
                }
              }
            }
            resolve({ ports: allowedMap, shares: sharesMap });
          } catch {
            resolve(empty());
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(empty());
    });
    req.on("error", () => resolve(empty()));
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
  portOrigin = "",
  shareOrigin = "",
  allowSameOriginShare = false,
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

  const portOriginUrl = parsePortOrigin(portOrigin);
  const shareOriginUrl = parsePortOrigin(shareOrigin);
  if (portOriginUrl && shareOriginUrl && portOriginUrl.host === shareOriginUrl.host) {
    throw new Error("Share origin must differ from port origin");
  }
  const sameOriginShareEnabled = Boolean(allowSameOriginShare);
  const portTickets = new Map();
  const portSessions = new Map();

  const isPortOriginRequest = (request) =>
    Boolean(portOriginUrl) &&
    String(request.headers.host || "").toLowerCase() === portOriginUrl.host;

  const isShareOriginRequest = (request) =>
    Boolean(shareOriginUrl) &&
    String(request.headers.host || "").toLowerCase() === shareOriginUrl.host;

  const pruneExpiring = (map, now = Date.now()) => {
    for (const [key, entry] of map) {
      const expiresAtMs = typeof entry === "number" ? entry : entry.expiresAtMs;
      if (expiresAtMs <= now) map.delete(key);
    }
  };

  const capMap = (map, max) => {
    while (map.size >= max) map.delete(map.keys().next().value);
  };

  const mintPortTicket = () => {
    pruneExpiring(portTickets);
    capMap(portTickets, MAX_PORT_TICKETS);
    const secret = randomBytes(32).toString("base64url");
    portTickets.set(hashPortSecret("ticket", secret), {
      expiresAtMs: Date.now() + PORT_TICKET_TTL_MS,
    });
    return secret;
  };

  const consumePortTicket = (secret) => {
    if (typeof secret !== "string" || secret.length < 16) return false;
    pruneExpiring(portTickets);
    const key = hashPortSecret("ticket", secret);
    const entry = portTickets.get(key);
    portTickets.delete(key);
    return Boolean(entry && entry.expiresAtMs > Date.now());
  };

  const mintPortSession = () => {
    pruneExpiring(portSessions);
    capMap(portSessions, MAX_PORT_SESSIONS);
    const secret = randomBytes(32).toString("base64url");
    portSessions.set(
      hashPortSecret("session", secret),
      Date.now() + PORT_SESSION_MAX_AGE_SECONDS * 1000,
    );
    return formatPortSessionCookie(secret, PORT_SESSION_MAX_AGE_SECONDS);
  };

  const hasPortSession = (request) => {
    const raw = parseCookies(request.headers.cookie)[PORT_SESSION_COOKIE];
    if (!raw) return false;
    const key = hashPortSecret("session", raw);
    const expiresAtMs = portSessions.get(key);
    if (expiresAtMs && expiresAtMs > Date.now()) return true;
    portSessions.delete(key);
    return false;
  };

  // Forwarded-app sessions cannot be attributed to a device, so any sign-out or
  // revocation conservatively drops all of them; users simply reopen the port.
  const dropPortSessions = () => {
    portSessions.clear();
    portTickets.clear();
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

  let portCache = { ports: new Map(), shares: new Map() };
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
    if (fresh && portCache.ports.has(port)) {
      return portCache.ports.get(port);
    }
    const next = await refreshAllowedPorts();
    return next.ports.get(port) || null;
  };

  const resolvePublicShareTarget = async (shareToken) => {
    if (typeof shareToken !== "string" || !PUBLIC_SHARE_TOKEN_RE.test(shareToken)) {
      return null;
    }
    const now = Date.now();
    const fresh = portCacheTtlMs > 0 && now - portCacheFetchedAt <= portCacheTtlMs;
    let candidate = fresh ? portCache.shares.get(shareToken) || null : null;
    if (!candidate) {
      const next = await refreshAllowedPorts();
      candidate = next.shares.get(shareToken) || null;
    }
    if (!candidate || !equalSecret(shareToken, candidate.token)) return null;
    if (isBlockedProxyPort(candidate.port)) return null;
    if (candidate.expiresAt) {
      const expMs = Date.parse(candidate.expiresAt);
      if (!Number.isFinite(expMs) || expMs <= Date.now()) return null;
    }
    return candidate;
  };

  const servePublicShare = async (
    request,
    response,
    requestUrl,
    { sameOrigin = false } = {},
  ) => {
    if (isServiceWorkerScriptRequest(request)) {
      publicShareSecurityHeaders(response);
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Service workers are not allowed on public share links");
      return;
    }
    if (!PUBLIC_SHARE_ALLOWED_METHODS.has(request.method || "")) {
      publicShareSecurityHeaders(response);
      response.writeHead(405, {
        Allow: "GET, HEAD",
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(
        JSON.stringify({
          error: "Public document shares are read-only (GET/HEAD only)",
        }),
      );
      return;
    }
    const parsed = parsePublicSharePath(requestUrl.pathname, { sameOrigin });
    if (!parsed) {
      publicShareSecurityHeaders(response);
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const targetInfo = await resolvePublicShareTarget(parsed.token);
    if (!targetInfo) {
      if (acceptsHtml(request)) {
        sendPublicShareHtml(response, 404, {
          title: "分享文档链接无效或已撤销",
          summary: "此公网静态文档链接可能已过期、已被作者撤销，或对应静态服务已停止。",
        });
        return;
      }
      publicShareSecurityHeaders(response);
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          error: "Public share link is invalid, expired, or revoked",
        }),
      );
      return;
    }
    if (parsed.needsTrailingSlash) {
      publicShareSecurityHeaders(response);
      response.writeHead(307, {
        Location: `${parsed.prefix}/${requestUrl.search}`,
      });
      response.end();
      return;
    }
    proxyPublicShareRequest(
      request,
      response,
      loopbackUrlForPort(targetInfo.localHost, targetInfo.port),
      `${parsed.suffix}${requestUrl.search}`,
      parsed.prefix,
      { port: targetInfo.port, remotePort: targetInfo.remotePort },
    );
  };

  const servePortProxy = async (request, response, requestUrl) => {
    if (isServiceWorkerScriptRequest(request)) {
      // A forwarded app must never install a service worker on a SCOPE origin.
      sendPortOriginText(response, 403, "Service workers are not allowed through the SCOPE port proxy");
      return;
    }
    const parsed = parsePortProxyPath(requestUrl.pathname);
    if (!parsed) {
      securityHeaders(response);
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Invalid port proxy path" }));
      return;
    }
    const targetInfo = await resolveAllowedPortTarget(parsed.port);
    if (!targetInfo) {
      if (acceptsHtml(request)) {
        sendPortProxyDiagnosticHtml(response, 403, {
          title: `端口 ${parsed.port} 尚未在 SCOPE 中开放`,
          summary: `为了安全，SCOPE 私有网关仅放行你在工作台「端口」面板中显式开放或 SSH 转发的端口。`,
          tips: [
            `回到 SCOPE 工作台，点击右上角「端口」按钮，确认端口 ${parsed.port} 已处于「已开放 / 已转发」状态。`,
            "如果刚刚重启过 SCOPE，请重新点击对应端口的「开放打开 / 转发打开」。",
          ],
        });
        return;
      }
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
      { remotePort: targetInfo.remotePort },
    );
  };

  const handlePortOriginRequest = async (request, response, requestUrl) => {
    if (!requestUrl.pathname.startsWith("/scope-port/")) {
      sendPortOriginText(response, 404, "Not found");
      return;
    }
    const ticket = requestUrl.searchParams.get(PORT_TICKET_PARAM);
    if (ticket !== null) {
      requestUrl.searchParams.delete(PORT_TICKET_PARAM);
      if (!consumePortTicket(ticket)) {
        sendPortOriginText(response, 403, "This port link expired. Reopen the port from the SCOPE workbench.");
        return;
      }
      portProxySecurityHeaders(response);
      response.writeHead(303, {
        Location: safeRedirectTarget(`${requestUrl.pathname}${requestUrl.search}`),
        "Set-Cookie": mintPortSession(),
      });
      response.end();
      return;
    }
    if (!hasPortSession(request)) {
      sendPortOriginText(response, 401, "Open this port from the SCOPE workbench to sign in.");
      return;
    }
    if (!hasSafeWriteOrigin(request)) {
      sendPortOriginText(response, 403, "Cross-site write rejected");
      return;
    }
    await servePortProxy(request, response, requestUrl);
  };

  const handler = async (request, response) => {
    if (!allowed(request)) {
      response.writeHead(403); response.end("Client address is not allowed"); return;
    }
    const requestUrl = new URL(request.url || "/", "http://scope.local");

    if (isPortOriginRequest(request)) {
      await handlePortOriginRequest(request, response, requestUrl);
      return;
    }

    if (isShareOriginRequest(request)) {
      await servePublicShare(request, response, requestUrl, { sameOrigin: false });
      return;
    }

    if (sameOriginShareEnabled && requestUrl.pathname.startsWith("/scope-share/")) {
      await servePublicShare(request, response, requestUrl, { sameOrigin: true });
      return;
    }

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
          shareOrigin: shareOriginUrl ? shareOriginUrl.origin : null,
          sameOriginShareEnabled,
          publicShareEnabled: Boolean(shareOriginUrl || sameOriginShareEnabled),
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
      dropPortSessions();
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
      dropPortSessions();
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
        dropPortSessions();
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
      if (portOriginUrl) {
        // Never execute forwarded apps on the control-plane origin: hand the
        // browser a single-use ticket for the isolated port origin instead.
        if (!["GET", "HEAD"].includes(request.method || "")) {
          sendJson(response, 403, { error: "Port proxy is served from the isolated port origin" });
          return;
        }
        const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, portOriginUrl);
        target.searchParams.set(PORT_TICKET_PARAM, mintPortTicket());
        securityHeaders(response);
        response.writeHead(303, { Location: target.toString() });
        response.end();
        return;
      }
      await servePortProxy(request, response, requestUrl);
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

  const upgradePortProxy = async (request, socket, head, requestUrl) => {
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
    proxyUpgrade(
      request,
      socket,
      head,
      target,
      `${parsed.suffix || "/"}${requestUrl.search}`,
      false,
      sanitizePortProxyHeaders(
        request,
        target,
        `/scope-port/${parsed.port}`,
        {
          isUpgrade: true,
          upstreamHostHeader: upstreamHostHeaderForPort(
            target,
            targetInfo.remotePort,
          ),
        },
      ),
    );
  };

  server.on("upgrade", async (request, socket, head) => {
    try {
      if (!allowed(request) || (request.headers.origin && !hasSafeWriteOrigin({ headers: request.headers, method: "POST" }))) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      const requestUrl = new URL(request.url || "/", "http://scope.local");
      if (isPortOriginRequest(request)) {
        if (!requestUrl.pathname.startsWith("/scope-port/")) {
          socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
          return;
        }
        if (!hasPortSession(request)) {
          socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        await upgradePortProxy(request, socket, head, requestUrl);
        return;
      }
      if (isShareOriginRequest(request) || requestUrl.pathname.startsWith("/scope-share/")) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      const wsAuth = await resolveAuth(request);
      if (!wsAuth.ok) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (requestUrl.pathname.startsWith("/scope-port/")) {
        if (portOriginUrl) {
          socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          return;
        }
        await upgradePortProxy(request, socket, head, requestUrl);
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
  portOrigin = process.env.SCOPE_PORT_ORIGIN || "",
  shareOrigin = process.env.SCOPE_SHARE_ORIGIN || "",
  allowSameOriginShare = process.env.SCOPE_ALLOW_SAME_ORIGIN_SHARE === "1" ||
    process.env.SCOPE_ALLOW_SAME_ORIGIN_SHARE === "true",
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
    portOrigin,
    shareOrigin,
    allowSameOriginShare,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    server,
    token,
    host,
    port,
    stateFile,
    portOrigin: portOrigin || null,
    shareOrigin: shareOrigin || null,
    allowSameOriginShare: Boolean(allowSameOriginShare),
  };
}
