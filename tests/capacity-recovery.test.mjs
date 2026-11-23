import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPACITY_CONTINUE_PROMPT,
  countModelCapacityWarnings,
  errorText,
  hasUnansweredModelCapacityWarning,
  isModelCapacityError,
  isTransientCodexBackendError,
} from "../bridge/capacity-recovery.mjs";

test("recognizes only the transient selected-model capacity failure", () => {
  assert.equal(
    isModelCapacityError({
      message: "Selected model is at capacity. Please try a different model.",
      codexErrorInfo: { httpStatusCode: 429 },
    }),
    true,
  );
  assert.equal(
    isModelCapacityError({ message: "Usage limit exceeded for this account" }),
    false,
  );
  assert.equal(isModelCapacityError({ message: "context window exceeded" }), false);
});

test("recognizes only retryable Codex Responses endpoint failures", () => {
  assert.equal(
    isTransientCodexBackendError(
      "unexpected status 404 Not Found: Unknown error, url: https://chatgpt.com/backend-api/codex/responses",
    ),
    true,
  );
  assert.equal(
    isTransientCodexBackendError("404: a requested output file is missing"),
    false,
  );
});

test("extracts nested protocol errors without looping on circular values", () => {
  const failure = { error: { additionalDetails: "capacity detail" } };
  failure.self = failure;
  assert.match(errorText(failure), /capacity detail/);
});

test("counts capacity warnings retained in a tmux pane", () => {
  const preview = [
    "⚠ Selected model is at capacity. Please try a different model.",
    "> 继续",
    "⚠ Selected model is currently at capacity. Please try again.",
  ].join("\n");
  assert.equal(countModelCapacityWarnings(preview), 2);
  assert.equal(CAPACITY_CONTINUE_PROMPT, "继续");
});

test("distinguishes a stuck tmux warning from one already followed up", () => {
  const warning =
    "⚠ Selected model is at capacity. Please try a different model.";
  assert.equal(hasUnansweredModelCapacityWarning(`${warning}\n\n› `), true);
  assert.equal(
    hasUnansweredModelCapacityWarning(`${warning}\n\n› 继续\n• 正在继续任务`),
    false,
  );
  assert.equal(
    hasUnansweredModelCapacityWarning(`${warning}\n› 继续\n${warning}\n› `),
    true,
  );
});
