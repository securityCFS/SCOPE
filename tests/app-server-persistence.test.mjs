import { bridgeSource } from "./helpers/bridge-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("managed app-server sessions persist and reconnect without taking external CLIs", async () => {
  const [bridge, client] = await Promise.all([
    bridgeSource(),
    readFile(new URL("../bridge/app-server-client.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(bridge, /app-server-sessions\.json/);
  assert.match(bridge, /loadPersistedAppServerSessions\(\)/);
  assert.match(bridge, /restorePersistedAppServerSessions\(\)/);
  assert.match(bridge, /scheduleAppServerReconnects\(\)/);
  assert.match(bridge, /appServerReconnectInFlight\.has\(host\)/);
  assert.match(bridge, /appServerReconnectInFlight\.add\(host\)/);
  assert.match(bridge, /appServerReconnectInFlight\.delete\(host\)/);
  assert.match(bridge, /2_000 \* 2 \*\* Math\.min\(attempt, 4\)/);
  assert.match(
    bridge,
    /agent\.rollout\?\.id === record\.sessionId &&\s*!agent\.appServerManaged/,
  );
  assert.match(bridge, /appServerManager\.on\("session-release"/);
  assert.match(client, /this\.emit\("session-release", \{ host, sessionId \}\)/);
  assert.match(client, /executable,\s*connectionKey: selectedConnectionKey,\s*status: this\.#statusName/);
  assert.match(bridge, /APP_SERVER_WRITER_PROBE/);
  assert.match(bridge, /app-server-session-writer-routed/);

  const startup = bridge.slice(bridge.indexOf("server.listen(PORT, HOST"));
  assert.ok(
    startup.indexOf("restorePersistedAppServerSessions()") <
      startup.indexOf(".then(() => scanAll())"),
    "persisted app-server sessions should reconnect from cache before the first global inventory",
  );
});

test("durable SCOPE app-server owners can be re-subscribed without weakening CLI protection", async () => {
  const bridge = await bridgeSource();
  const start = bridge.indexOf("const APP_SERVER_HANDOFF_PROBE = String.raw`");
  const end = bridge.indexOf("let snapshot =", start);
  const probe = bridge.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(probe, /def scope_app_server_owner\(target_pid\):/);
  assert.match(probe, /app-server-control/);
  assert.match(probe, /expected_prefix = "unix:\/\/" \+ control_dir \+ "\/scope-"/);
  assert.match(
    probe,
    /foreign_owners = \[owner for owner in owners if not scope_app_server_owner\(owner\)\]/,
  );
  assert.match(probe, /if foreign_owners:/);
  assert.match(probe, /"reconnectedOwnerPids": owners/);
  assert.match(probe, /if pid > 0:/);
  assert.match(probe, /安全策略禁止终止活动 CLI\/VS Code Session/);
});

test("failed persisted restores remain visible and retry after later inventory scans", async () => {
  const bridge = await bridgeSource();
  const start = bridge.indexOf("function restorePersistedAppServerSessions()");
  const end = bridge.indexOf("function scheduleAppServerReconnects()", start);
  const restore = bridge.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(bridge, /appServer\.restorePending/);
  assert.match(bridge, /restorePersistedAppServerSessions\(\)\.catch/);
  assert.match(restore, /appServerRestorePromise/);
  assert.match(restore, /appServerRestoreFailures\.set\(key/);
  assert.match(restore, /retryAt: Date\.now\(\) \+ retryDelay/);
  assert.doesNotMatch(restore, /persistedAppServerSessions\.delete/);
});
