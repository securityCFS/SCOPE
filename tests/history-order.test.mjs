import { bridgeSource } from "./helpers/bridge-source.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function event(type, payload, timestamp) {
  return JSON.stringify({ timestamp, type, payload });
}

async function writeRollout(root, name, id, lastEventAt, mtime) {
  const directory = path.join(root, ".codex", "sessions", "2026", "07", "27");
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, name);
  await writeFile(
    filename,
    [
      event(
        "session_meta",
        {
          id,
          cwd: `/workspace/${id}`,
          timestamp: "2026-07-01T00:00:00Z",
          source: "cli",
        },
        "2026-07-01T00:00:00Z",
      ),
      event(
        "event_msg",
        { type: "agent_message", message: `${id} completed` },
        lastEventAt,
      ),
    ].join("\n") + "\n",
    "utf8",
  );
  await utimes(filename, mtime, mtime);
}

async function writeArchivedRollout(root, name, id, lastEventAt, mtime) {
  const directory = path.join(
    root,
    ".codex",
    "archived_sessions",
    "2026",
    "07",
    "27",
  );
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, name);
  await writeFile(
    filename,
    [
      event(
        "session_meta",
        { id, cwd: `/workspace/${id}`, timestamp: lastEventAt, source: "cli" },
        lastEventAt,
      ),
      event(
        "event_msg",
        { type: "agent_message", message: `${id} archived` },
        lastEventAt,
      ),
    ].join("\n") + "\n",
    "utf8",
  );
  await utimes(filename, mtime, mtime);
}

async function historyProbe() {
  const source = await bridgeSource();
  const marker = "const HISTORY_PROBE = String.raw`";
  const start = source.indexOf(marker);
  const finish = source.indexOf(
    "const ASSISTANT_SEARCH_PROBE",
    start + marker.length,
  );
  assert.notEqual(start, -1);
  assert.notEqual(finish, -1);
  const chunk = source.slice(start + marker.length, finish);
  return chunk.slice(0, chunk.lastIndexOf("`;"));
}

test("inactive sessions are ranked by their last rollout event, not file mtime", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "scope-history-order-"));
  t.after(() => rm(home, { recursive: true, force: true }));

  await writeRollout(
    home,
    "actually-recent.jsonl",
    "actually-recent",
    "2026-07-27T08:00:00Z",
    new Date("2026-07-10T00:00:00Z"),
  );
  await writeRollout(
    home,
    "touched-but-stale.jsonl",
    "touched-but-stale",
    "2026-07-12T08:00:00Z",
    new Date("2026-07-27T09:00:00Z"),
  );

  const python = process.platform === "win32" ? "python" : "python3";
  const completed = spawnSync(python, ["-", "10", "recent"], {
    input: await historyProbe(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
    },
    timeout: 20_000,
  });
  assert.equal(completed.status, 0, completed.stderr);
  const result = JSON.parse(completed.stdout);
  assert.deepEqual(
    result.sessions.map((session) => session.id),
    ["actually-recent", "touched-but-stale"],
  );
  assert.equal(result.sessions[0].lastEventAt, "2026-07-27T08:00:00Z");
  assert.equal(result.sessions[1].lastEventAt, "2026-07-12T08:00:00Z");
  assert.ok(
    result.sessions[0].mtimeMs < result.sessions[1].mtimeMs,
    "test fixture must keep misleading mtimes",
  );
});

test("oldest history order is applied before the per-host limit", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "scope-history-oldest-"));
  t.after(() => rm(home, { recursive: true, force: true }));

  const fixtures = [
    ["first.jsonl", "first", "2026-07-01T08:00:00Z"],
    ["second.jsonl", "second", "2026-07-02T08:00:00Z"],
    ["third.jsonl", "third", "2026-07-03T08:00:00Z"],
    ["fourth.jsonl", "fourth", "2026-07-04T08:00:00Z"],
  ];
  for (const [filename, id, timestamp] of fixtures) {
    await writeRollout(home, filename, id, timestamp, new Date(timestamp));
  }

  const python = process.platform === "win32" ? "python" : "python3";
  const completed = spawnSync(python, ["-", "2", "oldest"], {
    input: await historyProbe(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
    },
    timeout: 20_000,
  });
  assert.equal(completed.status, 0, completed.stderr);
  const result = JSON.parse(completed.stdout);
  assert.deepEqual(
    result.sessions.map((session) => session.id),
    ["first", "second"],
  );
  assert.equal(result.totalFiles, 4);
  assert.equal(result.truncated, true);
});

test("history scan keeps archived rollouts visible and marks them recoverable", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "scope-history-archive-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeArchivedRollout(
    home,
    "archived.jsonl",
    "archived-session",
    "2026-07-27T08:00:00Z",
    new Date("2026-07-27T08:00:00Z"),
  );

  const python = process.platform === "win32" ? "python" : "python3";
  const completed = spawnSync(python, ["-", "10", "recent"], {
    input: await historyProbe(),
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
    timeout: 20_000,
  });
  assert.equal(completed.status, 0, completed.stderr);
  const result = JSON.parse(completed.stdout);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].id, "archived-session");
  assert.equal(result.sessions[0].archived, true);
  assert.match(result.sessions[0].path.replaceAll("\\", "/"), /archived_sessions/);
});
