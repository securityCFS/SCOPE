import assert from "node:assert/strict";
import test from "node:test";
import { remoteResumeValidator } from "../bridge/remote-rollout-locks.mjs";
import { AppServerManager } from "../bridge/app-server-client.mjs";

test("failed namespace validation prevents any daemon connection or resume", async () => {
  const calls = [];
  const validator = remoteResumeValidator(async (...args) => { calls.push(args); return { code: 77, stderr: "private lock namespace" }; });
  const manager = new AppServerManager({
    spawnConnection: () => { throw new Error("must not spawn"); },
    validateResume: validator,
  });
  await assert.rejects(manager.resumeSession({ host: "remote", sessionId: "session", path: "/private/sessions/thread.jsonl", connectionKey: "account-example" }), /private lock namespace/);
  assert.equal(calls.length, 1);
  assert.match(calls[0][2], /shared_locks/);
  assert.equal(manager.connections.size, 0);
});

test("successful validation allows shared rollout and ignores non-profile connections", async () => {
  let calls = 0;
  const validate = remoteResumeValidator(async () => { calls++; return { code: 0 }; });
  await validate({ host: "remote", path: "/shared/sessions/a.jsonl", connectionKey: "account-example" });
  await validate({ host: "remote", path: "/shared/sessions/a.jsonl", connectionKey: "active" });
  await validate({ host: "remote", connectionKey: "account-example" });
  assert.equal(calls, 1);
});
