import { bridgeSource } from "./helpers/bridge-source.mjs";
import { REMOTE_PROBE } from "../bridge/probes/remote-probe.mjs";
import assert from "node:assert/strict";
import test from "node:test";

function remoteProbe() { return REMOTE_PROBE; }

test("remote inventory reuses unchanged rollout summaries and bounds changed reads", async () => {
  const source = await bridgeSource();
  const probe = remoteProbe(source);

  assert.match(probe, /all_paths\[:10\]/);
  assert.match(probe, /SCOPE_SESSION_FINGERPRINTS_B64/);
  assert.match(probe, /SESSION_REF\\t/);
  assert.match(probe, /"sizeBytes": size_bytes/);
  assert.match(probe, /def bounded_session_lines/);
  assert.match(probe, /handle\.read\(head_bytes\)/);
  assert.match(probe, /handle\.seek\(max\(0, size - tail_bytes\)\)/);
  assert.doesNotMatch(probe, /for raw in handle/);

  assert.match(source, /function sessionFingerprintPayload/);
  assert.match(source, /inventoryProbe\(previous\)/);
  assert.match(source, /previousSessions\.get\(decodeBase64Url\(fields\[1\]\)\)/);
});

test("inventory timeout is distinct from SSH connect timeout and keeps live app-server hosts", async () => {
  const source = await bridgeSource();

  assert.match(source, /SCOPE_INVENTORY_TIMEOUT_MS \|\| 20_000/);
  assert.match(source, /timedOut = true;\s*\n\s*child\.kill\(\)/);
  assert.match(source, /result\.timedOut\s*\n\s*\? "资源扫描超时"/);
  assert.match(source, /function hasConnectedAppServer/);
  assert.match(
    source,
    /appServerConnected \|\| \(previous\.reachable && withinStaleGrace\)/,
  );
  assert.match(source, /inventoryError: scanned\.error/);
  assert.match(source, /error: null,\s*\n\s*inventoryError/);
  assert.match(source, /!item\.startsWith\("META\\t"\)/);
});
