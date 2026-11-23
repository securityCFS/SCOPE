import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCodexExecutable } from "../bridge/local/executable.mjs";
import { localHistoryReader } from "../bridge/local/history.mjs";

test("Windows npm installation resolves to its native binary without running command wrappers", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "scope-codex-resolution-"));
  try {
    const native = path.join(temp, "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe");
    await mkdir(path.dirname(native), { recursive: true });
    await writeFile(native, "fixture");
    const shim = path.join(temp, "codex.cmd");
    await writeFile(shim, "must never execute");
    assert.equal(resolveCodexExecutable({ PATH: temp }, "win32", "x64"), native);
    assert.equal(resolveCodexExecutable({ SCOPE_LOCAL_CODEX: shim }, "win32", "x64"), native);
    assert.equal(resolveCodexExecutable({ SCOPE_LOCAL_CODEX: path.join(temp, "missing.exe"), PATH: temp }, "win32", "x64"), null);
    assert.equal(resolveCodexExecutable({ PATH: temp }, "win32", "arm64"), null);
    await rm(native);
    assert.equal(resolveCodexExecutable({ PATH: temp }, "win32", "x64"), null);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("unmanaged local history reads known files and pages older messages without starting Codex", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "scope-local-history-"));
  const filename = path.join(temp, "rollout.jsonl");
  try {
    const rows = [1, 2, 3].flatMap(i => [
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `question${i}` }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `answer${i}` }] } },
    ]);
    await writeFile(filename, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    const read = localHistoryReader({ manager: { sessionRecords: () => [], prepareHost: () => { throw new Error("must not start Codex"); } },
      findRollout: (_host, id) => id === "known" ? { path: filename } : null });
    const latest = await read({ host: "@local", sessionId: "known", path: "/ignored/client-path", limit: 2, dialogueOnly: true });
    assert.deepEqual(latest.events.map(event => event.text), ["question3", "answer3"]);
    assert.equal(latest.hasMore, true);
    const older = await read({ host: "@local", sessionId: "known", limit: 2, before: latest.nextBefore, dialogueOnly: true });
    assert.deepEqual(older.events.map(event => event.text), ["question2", "answer2"]);
    await assert.rejects(read({ host: "@local", sessionId: "unknown", path: filename }), /未找到本机会话/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
