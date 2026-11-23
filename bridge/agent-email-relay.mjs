import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const MAX_REQUEST_BYTES = 32 * 1024;
const VALID_STATUSES = new Set(["completed", "failed", "needs_attention"]);

function clean(value, limit = 4_000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, limit);
}

function digest(value) {
  return createHash("sha256").update(String(value ?? "")).digest();
}

function equalSecret(actual, expected) {
  return timingSafeEqual(digest(actual), digest(expected));
}

function bearerToken(request) {
  const authorization = clean(request.headers.authorization, 2_000);
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw new Error("request-too-large");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body || "{}");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

export function normalizeAgentEmailEvent(payload) {
  const status = clean(payload?.status, 40).toLowerCase();
  const title = clean(payload?.title, 240);
  const summary = clean(payload?.summary, 8_000);
  if (!VALID_STATUSES.has(status)) {
    throw new Error("status must be completed, failed, or needs_attention");
  }
  if (!title || !summary) throw new Error("title and summary are required");

  const host = clean(payload?.host, 300) || "unknown-host";
  const agent = clean(payload?.agent, 80) || "agent";
  const session = clean(payload?.session, 300);
  const cwd = clean(payload?.cwd, 1_000);
  const suppliedDetails = Array.isArray(payload?.details)
    ? payload.details.slice(0, 12).map((item) => clean(item, 2_000)).filter(Boolean)
    : [];
  const details = [
    `Status: ${status}`,
    `Agent: ${agent}`,
    `Host: ${host}`,
    session ? `Session: ${session}` : "",
    cwd ? `Directory: ${cwd}` : "",
    ...suppliedDetails,
  ].filter(Boolean);
  const keyMaterial = JSON.stringify({ status, title, summary, host, agent, session, cwd });

  return {
    key: `agent-completion:${createHash("sha256").update(keyMaterial).digest("hex")}`,
    severity: status,
    title: `[${host}] ${title}`,
    summary,
    details,
    timestamp: clean(payload?.timestamp, 100) || new Date().toISOString(),
  };
}

export function createAgentEmailRelayServer({ token, notifier }) {
  if (typeof token !== "string" || token.length < 32) {
    throw new Error("Agent email relay token must contain at least 32 characters");
  }
  if (!notifier || typeof notifier.notify !== "function") {
    throw new Error("Agent email relay requires an email notifier");
  }

  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", "http://scope-agent-email.local");
    if (request.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(response, 200, {
        service: "scope-agent-email-relay",
        email: notifier.publicState(),
      });
      return;
    }

    if (request.method !== "POST" || requestUrl.pathname !== "/v1/notify") {
      sendJson(response, 404, { error: "not-found" });
      return;
    }
    if (!equalSecret(bearerToken(request), token)) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }

    try {
      const event = normalizeAgentEmailEvent(await readJsonBody(request));
      const result = await notifier.notify(event);
      if (result.sent || result.reason === "duplicate") {
        sendJson(response, 200, {
          accepted: true,
          sent: Boolean(result.sent),
          duplicate: result.reason === "duplicate",
        });
        return;
      }
      sendJson(response, 503, {
        accepted: false,
        error: clean(result.reason || "email-send-failed", 600),
      });
    } catch (error) {
      const invalid = ["SyntaxError", "TypeError"].includes(error?.name) ||
        /required|status|request-too-large/.test(error?.message || "");
      sendJson(response, invalid ? 400 : 500, {
        error: clean(error?.message || "relay-failed", 600),
      });
    }
  });
}

export async function loadOrCreateAgentEmailRelayState(filename, defaults = {}) {
  try {
    const parsed = JSON.parse(await readFile(filename, "utf8"));
    if (typeof parsed.token === "string" && parsed.token.length >= 32) {
      return { ...defaults, ...parsed };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const state = {
    token: randomBytes(32).toString("base64url"),
    createdAt: new Date().toISOString(),
    ...defaults,
  };
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return state;
}
