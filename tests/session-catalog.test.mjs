import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pythonExecutable } from "../bridge/local/python-probe.mjs";
import { SessionCatalog } from "../bridge/session-catalog/catalog.mjs";

test("catalog scans all three native history formats and keeps only resumable Claude sessions", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "scope-catalog-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codex = path.join(home, ".codex", "sessions");
  const claude = path.join(home, ".claude", "projects", "project");
  const agy = path.join(home, ".gemini", "antigravity-cli");
  await Promise.all([codex, claude, agy].map((dir) => mkdir(dir, { recursive: true })));
  await writeFile(path.join(codex, "one.jsonl"), JSON.stringify({ type: "session_meta", payload: { id: "codex-one", cwd: "/work" } }) + "\n");
  await writeFile(path.join(claude, "two.jsonl"), JSON.stringify({ type: "user", sessionId: "claude-two", cwd: "/work", message: { role: "user", content: "hello Claude" } }) + "\n");
  await mkdir(path.join(claude, "subagents"));
  await writeFile(path.join(claude, "subagents", "child.jsonl"), JSON.stringify({ type: "user", sessionId: "claude-two", message: { content: "wrong title" } }) + "\n");
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, ".codex"), CLAUDE_CONFIG_DIR: path.join(home, ".claude"), PYTHONIOENCODING: "utf-8" };
  const seed = spawnSync(pythonExecutable(), ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('CREATE TABLE conversation_summaries(conversation_id,title,preview,workspace_uris,last_modified_time)'); c.execute(\"INSERT INTO conversation_summaries VALUES ('agy-three','AGY title','preview','[\\\"file:///work\\\"]','2026-11-05')\"); c.commit()", path.join(agy, "conversation_summaries.db")], { env, encoding: "utf8" });
  assert.equal(seed.status, 0, seed.stderr);
  const script = await readFile(new URL("../bridge/session-catalog/probe.py", import.meta.url), "utf8");
  function probe(payload) {
    const result = spawnSync(pythonExecutable(), ["-", Buffer.from(JSON.stringify(payload)).toString("base64url")], { input: script, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  for (let i = 0; i < 2; i++) {
    const result = probe({ operation: "scan" });
    assert.equal(result.entries.length, 3);
    assert.equal(result.entries.find((entry) => entry.provider === "claude").title, "hello Claude");
    assert.equal(result.entries.find((entry) => entry.provider === "antigravity").cwd, "/work");
    assert.deepEqual(result.errors, []);
  }
  assert.equal(probe({ operation: "dialogue", provider: "claude", path: path.join(claude, "two.jsonl") }).messages[0].text, "hello Claude");
});

test("catalog retains cached sessions when one host fails and never sends local probes through SSH", async () => {
  let fails = false;
  const catalog = new SessionCatalog({ hosts: () => [{ alias: "@local", reachable: true }, { alias: "remote", reachable: true }],
    local: async () => ({ code: 0, stdout: '{"entries":[],"errors":[]}' }),
    run: async (host) => { assert.equal(host, "remote"); if (fails) throw new Error("offline"); return { code: 0, stdout: '{"entries":[{"provider":"claude","sessionId":"a","cwd":"/work"}],"errors":[]}' }; },
  });
  await catalog.refresh(true); fails = true; await catalog.refresh(true);
  assert.equal(catalog.records.size, 1);
  assert.equal(catalog.scans.get("remote").stale, true);
  assert.equal(catalog.scans.get("@local").errors.length, 0);
});
