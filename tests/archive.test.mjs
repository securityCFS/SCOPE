import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveThread,
  isArchiving,
} from "../bridge/archive/thread-lifecycle.mjs";
import { sessionArchiveService } from "../bridge/archive/service.mjs";
import { taskArchiveActions } from "../bridge/workbench/task-archive.mjs";

function fixture() {
  const state = { sessions: {} };
  const events = [];
  let remote = false,
    fail = false;
  const session = {
    host: "h",
    sessionId: "s",
    status: "idle",
    connectionKey: "account-pinned",
    cwd: "/work",
    readOnly: true,
  };
  const manager = {
    sessions: new Map([["h:s", session]]),
    sessionRecords() {
      return [...this.sessions.values()];
    },
    async prepareHost(host, executable, key) {
      events.push(["connect", host, key]);
      return {
        request: async (method) => {
          events.push(method);
          if (method === "thread/read")
            return {
              thread: {
                path: remote
                  ? "/.codex/archived_sessions/s"
                  : "/.codex/sessions/s",
                status: { type: "idle" },
              },
            };
          if (fail) throw new Error("remote unavailable");
          remote = true;
        },
      };
    },
    forgetArchivedSession() {
      events.push("forget");
      this.sessions.delete("h:s");
    },
    archiveSession(...args) {
      return archiveThread(this, ...args);
    },
    async unarchiveSession(_host, _id, _exe, key) {
      events.push(["restore", key]);
      remote = false;
      return { path: "/.codex/sessions/s" };
    },
    async resumeSession(record) {
      this.sessions.set("h:s", record);
    },
  };
  const deps = {
    manager,
    getState: () => state,
    persist: async () => events.push("persist"),
    findAgent: () => ({ title: "Example", cwd: "/work", status: "idle" }),
    getHost: () => ({ reachable: true }),
    executable: () => "codex",
    connectionKey: async () => "active",
    notify() {},
    restored() {},
  };
  return {
    state,
    events,
    manager,
    session,
    deps,
    service: sessionArchiveService(deps),
    fail: (value) => {
      fail = value;
    },
  };
}

test("archive persists intent, archives remote, then hides local; restore retains the pinned account and readonly session", async () => {
  const f = fixture();
  await f.service.change("h", "s", "archive");
  assert.equal(f.events[0], "persist");
  assert.ok(f.events.indexOf("thread/archive") < f.events.indexOf("forget"));
  assert.equal(f.state.sessions["h:s"].archive.phase, "archived");
  assert.equal(f.manager.sessions.size, 0);
  const reloaded = sessionArchiveService(f.deps);
  assert.equal(reloaded.list().length, 1);
  await reloaded.change("h", "s", "restore");
  assert.deepEqual(
    f.events.find((e) => Array.isArray(e) && e[0] === "restore"),
    ["restore", "account-pinned"],
  );
  assert.equal(f.manager.sessions.get("h:s").readOnly, true);
  assert.equal(reloaded.list().length, 0);
});

test("failed remote archive stays visible and retryable; running sessions are never interrupted", async () => {
  const f = fixture();
  f.fail(true);
  await assert.rejects(
    f.service.change("h", "s", "archive"),
    /remote unavailable/,
  );
  assert.equal(f.state.sessions["h:s"].archive.phase, "archiving");
  assert.equal(f.manager.sessions.size, 1);
  assert.equal(f.events.includes("forget"), false);
  f.fail(false);
  await f.service.change("h", "s", "archive");
  assert.equal(f.state.sessions["h:s"].archive.phase, "archived");
  const active = fixture();
  active.session.turnStarting = true;
  await assert.rejects(active.service.change("h", "s", "archive"), /执行/);
  assert.equal(active.events.includes("thread/archive"), false);
});

test("an archive in flight is locked and a lost success reply can be reconciled without resending archive", async () => {
  const f = fixture();
  let release;
  f.manager.prepareHost = async () => ({
    request: (method) =>
      method === "thread/read"
        ? new Promise((resolve) => {
            release = () =>
              resolve({ thread: { path: "/.codex/archived_sessions/s" } });
          })
        : assert.fail(
            "already archived threads must not receive archive twice",
          ),
  });
  const pending = f.manager.archiveSession("h", "s");
  await Promise.resolve();
  assert.equal(isArchiving(f.manager, "h", "s"), true);
  await assert.rejects(f.manager.archiveSession("h", "s"), /正在归档/);
  release();
  await pending;
  assert.equal(isArchiving(f.manager, "h", "s"), false);
});

test("task archives cancel queued work atomically, preserve failed remote archives and never archive manager history", async () => {
  const state = {
    tasks: [
      { id: "queued", kind: "task", status: "queued" },
      {
        id: "done",
        kind: "task",
        provider: "codex",
        status: "completed",
        remote: { sessionId: "s" },
      },
      { id: "running", kind: "task", status: "running" },
      { id: "manager", kind: "manager", status: "completed" },
    ],
  };
  let fail = true,
    calls = 0;
  const action = taskArchiveActions({
    store: {
      async update(fn) {
        return fn(state);
      },
    },
    adapters: {
      codex: {
        async archive() {
          calls++;
          if (fail) throw new Error("offline");
        },
        async restore() {
          calls++;
        },
      },
    },
  });
  await action("queued", "archive");
  assert.equal(state.tasks[0].status, "cancelled");
  assert.ok(state.tasks[0].archivedAt);
  await assert.rejects(action("done", "archive"), /offline/);
  assert.equal(state.tasks[1].archivedAt, undefined);
  fail = false;
  await action("done", "archive");
  assert.ok(state.tasks[1].archivedAt);
  await action("done", "restore");
  assert.equal(state.tasks[1].archivedAt, null);
  await assert.rejects(action("running", "archive"), /尚未结束/);
  await assert.rejects(action("manager", "archive"), /总调度/);
  assert.equal(calls, 3);
});
