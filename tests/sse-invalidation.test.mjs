import { bridgeSource } from "./helpers/bridge-source.mjs";
import { workspaceSource } from "./helpers/workspace-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("SSE sends bounded invalidations instead of retaining full snapshots", async () => {
  const [bridge, page, cache] = await Promise.all([
    bridgeSource(),
    workspaceSource(),
    readFile(new URL("../lib/browser-snapshot-cache.js", import.meta.url), "utf8"),
  ]);
  const notifyStart = bridge.indexOf("function snapshotInvalidationPayload()");
  const notifyEnd = bridge.indexOf(
    "async function syncHumanRequestNotifications()",
    notifyStart,
  );
  const notifier = bridge.slice(notifyStart, notifyEnd);

  assert.notEqual(notifyStart, -1);
  assert.notEqual(notifyEnd, -1);
  assert.match(notifier, /type: "snapshot-invalidated"/);
  assert.match(notifier, /revision: sync\.revision/);
  assert.match(notifier, /snapshotNotifyTimer/);
  assert.doesNotMatch(notifier, /JSON\.stringify\(publicSnapshot\(\)\)/);
  assert.match(notifier, /client\.pending = payload/);
  assert.match(notifier, /response\.once\("drain", client\.onDrain\)/);
  assert.match(page, /notice\.type !== "snapshot-invalidated"/);
  assert.match(page, /void refreshSnapshot\(\)/);
  assert.match(page, /refreshPending = true/);
  assert.match(page, /bridgeUrl\(`\/api\/sync\?/);
  assert.doesNotMatch(page, /bridgeUrl\("\/api\/snapshot"\)/);
  assert.match(page, /loadBrowserSnapshotCache/);
  assert.match(page, /saveBrowserSnapshotCache/);
  assert.match(cache, /indexedDB\.open/);
});
