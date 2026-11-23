import test from "node:test";
import assert from "node:assert/strict";
import { SessionProfileAssignments, sessionProfileKey, profileFromConnection, boundConnectionKey } from "../bridge/session-profiles.mjs";
import { durableRemoteAppServerCommand } from "../bridge/remote-app-server-command.mjs";

function fixture(overrides = {}) {
  const store = new Map();
  const sessions = new Map([["h:a", { status: "idle", connectionKey: "active" }], ["h:b", { status: "working", connectionKey: "active" }]]);
  const migrations = [];
  const options = {
    read: (h, id) => store.get(`${h}:${id}`),
    write: async (h, id, state) => { store.set(`${h}:${id}`, structuredClone(state)); },
    session: (h, id) => sessions.get(`${h}:${id}`),
    blocked: (h, id) => sessions.get(`${h}:${id}`)?.status === "working",
    verify: async (_h, slug) => ({ email: `${slug}@example.test` }),
    migrate: async (h, id, key) => { migrations.push([h, id, key]); sessions.get(`${h}:${id}`).connectionKey = key; },
    ...overrides,
  };
  return { store, sessions, migrations, options, manager: new SessionProfileAssignments(options) };
}

test("different sessions keep independent profiles and preserve unrelated working sessions", async () => {
  const f = fixture();
  assert.equal((await f.manager.assign("h", "a", "pro-plus")).status, "applied");
  assert.equal(f.sessions.get("h:b").connectionKey, "active");
  assert.equal((await f.manager.assign("h", "b", "pro-lite")).status, "queued");
  assert.equal(f.migrations.length, 1);
  f.sessions.get("h:b").status = "idle";
  await f.manager.apply("h", "b");
  assert.equal(f.store.get("h:a").profile, "pro-plus");
  assert.equal(f.store.get("h:b").profile, "pro-lite");
});

test("queued intent survives coordinator reload; applied intent is not replayed", async () => {
  const f = fixture();
  await f.manager.assign("h", "b", "pro-plus");
  const reloaded = new SessionProfileAssignments(f.options);
  f.sessions.get("h:b").status = "idle";
  await reloaded.apply("h", "b");
  await reloaded.apply("h", "b");
  assert.equal(f.migrations.length, 1);
});

test("failed auth never migrates or silently falls back and requires explicit retry", async () => {
  const f = fixture({ verify: async () => { throw new Error("token revoked"); } });
  const result = await f.manager.assign("h", "a", "pro-plus");
  assert.equal(result.status, "failed");
  assert.match(result.error, /token revoked/);
  assert.equal(result.profile, undefined);
  await f.manager.apply("h", "a");
  assert.equal(f.migrations.length, 0);
});

test("migration failure retains previous binding", async () => {
  const f = fixture({ migrate: async () => { throw new Error("writer busy"); } });
  f.store.set("h:a", { profile: "old", status: "applied" });
  const result = await f.manager.assign("h", "a", "new");
  assert.equal(result.profile, "old");
  assert.equal(result.desiredProfile, "new");
  assert.equal(result.status, "failed");
});

test("turn starting during account verification defers migration", async () => {
  const f = fixture();
  f.manager.verify = async () => { f.sessions.get("h:a").status = "working"; return {}; };
  assert.equal((await f.manager.assign("h", "a", "pro-plus")).status, "queued");
  assert.equal(f.migrations.length, 0);
});

test("concurrent queue ticks do not transfer writer twice", async () => {
  let release;
  const f = fixture({ verify: () => new Promise((resolve) => { release = resolve; }) });
  const first = f.manager.assign("h", "a", "one");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(f.manager.assign("h", "a", "two"), /正在切换/);
  await f.manager.apply("h", "a");
  release({});
  await first;
  assert.equal(f.migrations.length, 1);
});

test("isolated daemon uses profile home and file credentials, without global auth writes or kills", () => {
  const slug = "x".repeat(48);
  const command = durableRemoteAppServerCommand({ key: sessionProfileKey(slug), isolatedProfile: slug });
  assert.ok(command.includes(`app_id='account-${slug}'`));
  assert.ok(command.includes(`scope-auth-profiles/${slug}`));
  assert.match(command, /profile_auth_home="\$profile_root\/home"/);
  assert.match(command, /cli_auth_credentials_store=file/);
  assert.match(command, /thread-writer-locks/);
  assert.match(command, /Profile writer lock directory mismatch/);
  assert.doesNotMatch(command, /kill-session|pkill|killall|cp .*auth/);
  assert.match(command, /auth\.json auth\.lock/);
  assert.equal(profileFromConnection("account-pro-plus"), "pro-plus");
  assert.equal(profileFromConnection("profile-pro-plus"), null);
  for (const slug of ["", "../oops", "x/y", "a;echo", "x".repeat(49)]) {
    assert.throws(() => sessionProfileKey(slug));
    assert.throws(() => durableRemoteAppServerCommand({ isolatedProfile: slug || "/" }));
  }
});

test("cancel failed first binding unblocks host actions; cancel rebind preserves old profile", async () => {
  const f = fixture({ verify: async () => { throw new Error("expired"); } });
  await f.manager.assign("h", "a", "bad");
  assert.equal(await f.manager.cancel("h", "a"), null);
  f.store.set("h:a", { profile: "old", desiredProfile: "old", status: "applied" });
  await f.manager.assign("h", "a", "bad");
  assert.deepEqual((await f.manager.cancel("h", "a")).desiredProfile, "old");
});

test("restore honors committed binding and persisted in-flight target", () => {
  assert.equal(boundConnectionKey({ profile: "one", status: "applied" }, "active"), "account-one");
  assert.equal(boundConnectionKey({ profile: "one", desiredProfile: "two", status: "switching" }, "account-two"), "account-two");
  assert.equal(boundConnectionKey({ profile: "one", desiredProfile: "two", status: "queued" }, "active"), "account-one");
  assert.equal(boundConnectionKey(null, "account-two"), "account-two");
});

test("30-minute writer grace is polled without source resume, including a bridge reload", async () => {
  let clock = 0, releases = 0, restores = 0, attempts = 0, verifications = 0;
  const f = fixture({ now: () => clock,
    release: async () => { releases++; }, restore: async () => { restores++; },
    verify: async () => { verifications++; return { email: "target@example.test" }; },
    migrate: async () => { attempts++; if (clock < 30 * 60_000) throw new Error("thread one already has an active writer"); },
  });
  assert.equal((await f.manager.assign("h", "a", "target")).status, "waiting-writer");
  assert.equal(f.store.get("h:a").handoff.released, true);
  assert.equal(f.store.get("h:a").profile, undefined);
  await assert.rejects(f.manager.assign("h", "a", "different"), /先取消/);
  const reloaded = new SessionProfileAssignments(f.options);
  // A frequent scheduler must respect the persisted 30s next-attempt timestamp.
  for (clock = 1500; clock < 30 * 60_000; clock += 1500) await reloaded.apply("h", "a");
  assert.equal(f.store.get("h:a").status, "waiting-writer");
  clock = 30 * 60_000;
  await reloaded.apply("h", "a");
  assert.equal(f.store.get("h:a").status, "applied");
  assert.equal(f.store.get("h:a").profile, "target");
  assert.equal(releases, 1);
  assert.equal(restores, 0);
  assert.equal(verifications, 1);
  assert.equal(attempts, 61);
});

test("cancelling a waiting migration restores only its original writer", async () => {
  const restores = [];
  const f = fixture({ migrate: async () => { throw new Error("already has an active writer"); },
    restore: async (host, id, source) => { restores.push({ host, id, source }); } });
  await f.manager.assign("h", "a", "target");
  assert.equal(await f.manager.cancel("h", "a"), null);
  assert.equal(restores.length, 1);
  assert.equal(restores[0].source.connectionKey, "active");
  assert.equal(restores[0].id, "a");
});

test("a transient disconnect during grace never loads the old writer", async () => {
  const f = fixture({ migrate: async () => { throw new Error("Connection reset"); } });
  const result = await f.manager.assign("h", "a", "target");
  assert.equal(result.status, "waiting-writer");
  assert.equal(result.handoff.released, true);
  assert.match(result.error, /后台将重试/);
});
