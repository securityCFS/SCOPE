export const CAPACITY_CONTINUE_PROMPT = "继续";

export const DEFAULT_CAPACITY_RETRY_DELAYS_MS = Object.freeze([
  3_000,
  10_000,
  30_000,
  60_000,
  120_000,
]);

const MODEL_CAPACITY_PATTERN = /selected model is(?: currently)? at capacity/i;
// Codex occasionally accepts a turn and then receives an edge/backend error
// from its own Responses endpoint. Limit retries to this exact endpoint and
// retryable statuses; ordinary 404s from a user's command are never retried.
const TRANSIENT_CODEX_BACKEND_PATTERN =
  /unexpected status\s+(?:404|408|429|500|502|503|504)\b[\s\S]{0,1000}chatgpt\.com\/backend-api\/codex\/responses/i;

export function errorText(value, limit = 30_000) {
  const parts = [];
  const seen = new Set();

  function visit(candidate, depth) {
    if (parts.join("\n").length >= limit || depth > 6 || candidate == null) {
      return;
    }
    if (typeof candidate === "string") {
      if (candidate) parts.push(candidate);
      return;
    }
    if (["number", "boolean", "bigint"].includes(typeof candidate)) {
      parts.push(String(candidate));
      return;
    }
    if (typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    if (candidate instanceof Error) {
      visit(candidate.message, depth + 1);
      visit(candidate.cause, depth + 1);
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    const preferredKeys = [
      "message",
      "error",
      "additionalDetails",
      "codexErrorInfo",
      "details",
      "turn",
      "data",
    ];
    const keys = [
      ...preferredKeys.filter((key) => key in candidate),
      ...Object.keys(candidate).filter((key) => !preferredKeys.includes(key)),
    ];
    for (const key of keys) visit(candidate[key], depth + 1);
  }

  visit(value, 0);
  return parts.join("\n").slice(0, limit);
}

export function isModelCapacityError(value) {
  return MODEL_CAPACITY_PATTERN.test(errorText(value));
}

export function isTransientCodexBackendError(value) {
  return TRANSIENT_CODEX_BACKEND_PATTERN.test(errorText(value));
}

export function countModelCapacityWarnings(value) {
  return (String(value || "").match(
    /selected model is(?: currently)? at capacity/gi,
  ) || []).length;
}

export function hasUnansweredModelCapacityWarning(value) {
  const text = String(value || "");
  const matches = Array.from(
    text.matchAll(/selected model is(?: currently)? at capacity/gi),
  );
  const latest = matches.at(-1);
  if (!latest) return false;
  const tail = text.slice((latest.index || 0) + latest[0].length);
  // Codex TUI keeps submitted user prompts in scrollback as `› text`. If a
  // non-empty prompt follows the latest warning, that warning was handled.
  return !/(?:^|\n)\s*[›»>]\s+\S/m.test(tail);
}
