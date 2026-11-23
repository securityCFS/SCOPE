import { bridgeSource } from "./helpers/bridge-source.mjs";
import { workspaceSource } from "./helpers/workspace-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";

test("host recovery reconnects managed sessions and only continues interrupted work", async () => {
  const [bridge, page] = await Promise.all([
    bridgeSource(),
    workspaceSource(),
  ]);

  const start = bridge.indexOf("function recoverHostAppServerSessions(hostAlias)");
  const end = bridge.indexOf("function publicAuthRestartJob", start);
  const recovery = bridge.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(recovery, /persistedAppServerSessions\.values\(\)/);
  assert.match(recovery, /record\.resumeOnRecovery/);
  assert.match(recovery, /session\.status === "working"/);
  assert.match(recovery, /startTurn\(hostAlias, record\.sessionId, "继续"/);
  assert.match(recovery, /!agent\.appServerManaged/);
  assert.match(bridge, /\/api\/app-server\/recover-host/);
  assert.match(page, /一键恢复主机/);
  assert.match(page, /confirmation: host/);
});

test("auth writer migration suppresses stale-profile reconnects until persistence is updated", async () => {
  const bridge = await bridgeSource();
  assert.match(bridge, /const appServerAuthRecoveryHosts = new Set\(\)/);
  assert.match(
    bridge,
    /appServerAuthRecoveryHosts\.has\(host\)[\s\S]*appServerReconnectTimers\.has\(host\)/,
  );
  assert.match(bridge, /appServerAuthRecoveryHosts\.add\(hostAlias\)/);
  assert.match(
    bridge,
    /appServerAuthRecoveryHosts\.delete\(hostAlias\);[\s\S]*scheduleAppServerReconnects\(\)/,
  );
});

test("explicit auth recovery migrates only selected interrupted sessions", async () => {
  const bridge = await bridgeSource();
  const start = bridge.indexOf("function recoverAuthenticationFailedSessions(");
  const end = bridge.indexOf("async function retireStaleProfileAppServer", start);
  const recovery = bridge.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(recovery, /if \(requestedIds\)/);
  assert.match(recovery, /migrateSessionConnection\(/);
  assert.match(recovery, /forkSessionConnection\(/);
  assert.match(recovery, /startTurn\(hostAlias, migrated\.sessionId, "继续"/);
  assert.match(recovery, /previous\.status === "working"|session\.status === "working"/);
  assert.ok(
    recovery.indexOf("migrateSessionConnection(") <
      recovery.indexOf("retireStaleProfileAppServer("),
  );
});
