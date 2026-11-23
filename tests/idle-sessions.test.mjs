import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { idleSessionTimeout, releaseIdleSessions } from "../bridge/idle-sessions.mjs";

function fixture() {
  const manager = new EventEmitter();
  const session = { host: "h", sessionId: "one", status: "idle", lastEventAt: new Date(0).toISOString(), connectionKey: "account-one" };
  Object.assign(manager, { sessions: new Map([["h:one", session]]), items: new Map([["h:one:item", {}], ["h:two:item", {}]]),
    requests: new Map(), capacityRecoveries: new Map(), now: () => 60 * 60_000, isConnected: () => true });
  const calls = [];
  manager.prepareHost = async () => ({ request: async (method) => {
    calls.push(method);
    return method === "thread/read" ? { thread: { status: { type: "idle" } } } : { status: "unsubscribed" };
  } });
  return { manager, session, calls };
}

test("idle release preserves recovery metadata and sibling caches without interrupts", async () => {
  const { manager, calls } = fixture();
  let event;
  manager.on("session-release", e => { event = e; });
  assert.equal((await releaseIdleSessions(manager)).length, 1);
  assert.deepEqual(calls, ["thread/read", "thread/unsubscribe"]);
  assert.equal(manager.sessions.size, 0);
  assert.equal(manager.items.has("h:two:item"), true);
  assert.equal(manager.items.has("h:one:item"), false);
  assert.equal(event.reason, "idle");
  assert.equal(event.record.connectionKey, "account-one");
  assert.equal(event.record.resumeOnRecovery, false);
  assert.equal(event.record.profileSwitching, undefined);
});

test("busy, recent, offline, approval and recovering sessions are never released", async () => {
  for (const change of [s => s.status = "working", s => s.status = "offline", s => s.turnStarting = true,
    s => s.activeTurnId = "turn", s => s.profileSwitching = true, s => s.profileHandoff = true,
    s => s.lastEventAt = new Date(60 * 60_000).toISOString(), s => s.lastEventAt = "unknown"]) {
    const { manager, session, calls } = fixture(); change(session);
    assert.deepEqual(await releaseIdleSessions(manager), []);
    assert.equal(calls.length, 0);
  }
  for (const status of ["pending", "responding", "disconnected"]) {
    const { manager, calls } = fixture();
    manager.requests.set("approval", { host: "h", threadId: "one", status });
    await releaseIdleSessions(manager); assert.equal(calls.length, 0);
  }
  const { manager, calls } = fixture(); manager.capacityRecoveries.set("h:one", {});
  await releaseIdleSessions(manager); assert.equal(calls.length, 0);
});

test("remote activity, racing notifications and failed unsubscribe retain the session", async () => {
  for (const mode of ["busy", "unknown", "notification", "failure"]) {
    const { manager, session } = fixture(); let unsubscribed = false;
    manager.prepareHost = async () => ({ request: async method => {
      if (method === "thread/read") {
        if (mode === "notification") session.lastEventAt = new Date(manager.now()).toISOString();
        return { thread: { status: { type: mode === "busy" ? "active" : mode === "unknown" ? "unknown" : "idle" } } };
      }
      if (mode === "failure") throw new Error("disconnected");
      unsubscribed = true;
    } });
    assert.deepEqual(await releaseIdleSessions(manager), []);
    assert.equal(unsubscribed, false);
    assert.equal(manager.sessions.size, 1);
    assert.equal(session.profileSwitching, undefined);
    assert.equal(session.idleReleasing, undefined);
  }
});

test("timeout configuration defaults safely and zero disables cleanup", async () => {
  assert.equal(idleSessionTimeout(""), 30 * 60_000);
  assert.equal(idleSessionTimeout("invalid"), 30 * 60_000);
  assert.equal(idleSessionTimeout("-1"), 30 * 60_000);
  assert.equal(idleSessionTimeout("45"), 45 * 60_000);
  const { manager, calls } = fixture();
  await releaseIdleSessions(manager, { timeoutMs: idleSessionTimeout("0") });
  assert.equal(calls.length, 0);
});

function multiFixture() {
  const manager = new EventEmitter();
  const sOldest = {
    host: "h",
    sessionId: "old",
    status: "idle",
    connectedAt: new Date(1000).toISOString(),
    lastEventAt: new Date(2000).toISOString(),
    connectionKey: "a",
  };
  const sMiddle = {
    host: "h",
    sessionId: "mid",
    status: "idle",
    connectedAt: new Date(2000).toISOString(),
    lastEventAt: new Date(5000).toISOString(),
    connectionKey: "a",
  };
  const sNewest = {
    host: "h",
    sessionId: "new",
    status: "idle",
    connectedAt: new Date(3000).toISOString(),
    lastEventAt: new Date(9000).toISOString(),
    connectionKey: "a",
  };
  const sReserved = {
    host: "h",
    sessionId: "pinned",
    status: "idle",
    connectedAt: new Date(500).toISOString(),
    lastEventAt: new Date(500).toISOString(),
    connectionKey: "a",
  };
  Object.assign(manager, {
    sessions: new Map([
      ["h:new", sNewest],
      ["h:pinned", sReserved],
      ["h:mid", sMiddle],
      ["h:old", sOldest],
    ]),
    items: new Map(),
    requests: new Map(),
    capacityRecoveries: new Map(),
    now: () => 60 * 60_000,
    isConnected: () => true,
  });
  const unsubscribed = [];
  manager.prepareHost = async () => ({
    request: async (method, params) => {
      if (method === "thread/read") return { thread: { status: { type: "idle" } } };
      if (method === "thread/unsubscribe") unsubscribed.push(params.threadId);
      return { status: "unsubscribed" };
    },
  });
  return { manager, unsubscribed };
}

test("pool cleanup rechecks a later candidate's handoff lock after awaiting an earlier release", async () => {
  const { manager } = multiFixture();
  const mid = manager.sessions.get("h:mid");
  const unsubscribed = [];
  manager.prepareHost = async () => ({ request: async (method, input) => {
    if (method === "thread/read") {
      if (input.threadId === "old") mid.profileHandoff = true;
      return { thread: { status: { type: "idle" } } };
    }
    unsubscribed.push(input.threadId);
    return { status: "unsubscribed" };
  } });
  await releaseIdleSessions(manager, { residentLimit: 1, timeoutMs: 1000, isReserved: (_host, id) => id === "pinned" });
  assert.equal(unsubscribed.includes("mid"), false);
  assert.equal(manager.sessions.get("h:mid"), mid);
  assert.equal(mid.profileHandoff, true);
});

test("resident pool keeps sessions alive up to limit and evicts oldest overflow first", async () => {
  const { manager, unsubscribed } = multiFixture();
  // With 4 connected sessions and residentLimit = 4, nothing is evicted even past timeoutMs
  assert.deepEqual(
    await releaseIdleSessions(manager, { timeoutMs: 1000, residentLimit: 4 }),
    [],
  );
  assert.equal(manager.sessions.size, 4);

  // Lowering pool limit to 2 (or via per-host fn) evicts oldest 2 non-reserved sessions ("old", "mid")
  const released = await releaseIdleSessions(manager, {
    timeoutMs: 1000,
    residentLimit: (host) => (host === "h" ? 2 : 0),
    isReserved: (_host, sessionId) => sessionId === "pinned",
  });
  assert.deepEqual(
    released.map((item) => item.sessionId),
    ["old", "mid"],
  );
  assert.deepEqual(unsubscribed, ["old", "mid"]);
  assert.equal(manager.sessions.has("h:pinned"), true);
  assert.equal(manager.sessions.has("h:new"), true);
  assert.equal(manager.sessions.size, 2);
});

test("reserved sessions and threads with activeFlags stay alive even when pool limit is zero", async () => {
  const { manager } = fixture();
  assert.deepEqual(
    await releaseIdleSessions(manager, {
      timeoutMs: 1000,
      residentLimit: 0,
      isReserved: (_host, id) => id === "one",
    }),
    [],
  );

  // Active flags returned by thread/read prevent closing background-waiting threads
  const activeFlagFixture = fixture();
  const unsubscribed = [];
  activeFlagFixture.manager.prepareHost = async () => ({
    request: async (method) => {
      if (method === "thread/read") {
        return { thread: { status: { type: "idle", activeFlags: ["waiting"] } } };
      }
      unsubscribed.push(method);
      return {};
    },
  });
  assert.deepEqual(
    await releaseIdleSessions(activeFlagFixture.manager, { timeoutMs: 1000, residentLimit: 0 }),
    [],
  );
  assert.deepEqual(unsubscribed, []);
});
