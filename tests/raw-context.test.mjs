import { bridgeSource } from "./helpers/bridge-source.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function rawContextProbe() {
  const source = await bridgeSource();
  const marker = "const RAW_CONTEXT_PROBE = String.raw`";
  const start = source.indexOf(marker);
  const finish = source.indexOf("const HISTORY_PROBE", start + marker.length);
  assert.notEqual(start, -1);
  assert.notEqual(finish, -1);
  const chunk = source.slice(start + marker.length, finish);
  return chunk.slice(0, chunk.lastIndexOf("`;"));
}

test("raw context starts at the latest compact boundary and preserves records", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "scope-raw-context-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "rollout.jsonl");
  const lines = [
    { type: "session_meta", payload: { id: "raw-test" } },
    { type: "response_item", payload: { type: "message", content: "old" } },
    { type: "compacted", payload: { message: "summary" } },
    { type: "turn_context", payload: { model: "gpt-test" } },
    { type: "event_msg", payload: { type: "token_count" } },
    { type: "response_item", payload: { type: "message", content: "new" } },
  ];
  await writeFile(
    filename,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );

  const python = process.platform === "win32" ? "python" : "python3";
  const completed = spawnSync(python, ["-", filename], {
    input: await rawContextProbe(),
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    timeout: 20_000,
  });
  assert.equal(completed.status, 0, completed.stderr);
  const result = JSON.parse(completed.stdout);
  assert.equal(result.format, "codex-rollout-context/v1");
  assert.equal(result.sessionMeta.payload.id, "raw-test");
  assert.deepEqual(
    result.records.map((record) => record.type),
    ["compacted", "turn_context", "response_item"],
  );
  assert.equal(result.records.at(-1).payload.content, "new");
  assert.equal(result.truncated, false);
});
