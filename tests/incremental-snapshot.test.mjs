import assert from "node:assert/strict";
import test from "node:test";

import {
  applySnapshotSync,
  createIncrementalSnapshotStore,
  splitSnapshotResources,
} from "../lib/incremental-snapshot.js";

function fixture() {
  const rollout = {
    id: "session-1",
    cwd: "/workspace/project",
    startedAt: "2026-08-18T00:00:00.000Z",
    mtimeMs: 1,
    lastEventAt: "2026-08-18T00:00:01.000Z",
    lastUser: "run",
    lastAssistant: "done",
    lastAction: "tool",
    userMessages: ["u".repeat(120_000)],
    assistantMessages: ["a".repeat(120_000)],
  };
  return {
    generatedAt: "2026-08-18T00:00:01.000Z",
    scanning: false,
    sshConfig: "config",
    hosts: [
      {
        alias: "host",
        processes: [{ command: "large", output: "x".repeat(80_000) }],
        sessions: [rollout],
        agents: [
          {
            id: "agent-1",
            rollout,
            subagents: [],
            remoteJobs: [{ jobId: "job-1", evidence: "e".repeat(80_000) }],
          },
        ],
        panes: [],
        gpus: [],
      },
    ],
    summary: { hosts: 1, online: 1, codex: 1, tmux: 0, attention: 0 },
    management: { sessions: {}, resourcePolicy: {} },
    appServer: { sessions: [] },
    gpuUsage: {
      updatedAt: "2026-08-18T00:00:01.000Z",
      retentionHours: 168,
      episodes: [
        { id: "gpu-1", samples: 1, lastSeenAt: "2026-08-18T00:00:01.000Z" },
        { id: "gpu-old", samples: 8, lastSeenAt: "2026-08-17T00:00:00.000Z" },
      ],
    },
    submissionTracker: {
      scannedAt: "2026-08-18T00:00:00.000Z",
      scanning: false,
      items: [{ jobId: "job-1", evidence: "e".repeat(80_000) }],
      calls: [],
      launches: [],
      alerts: [],
      hosts: [],
      error: null,
    },
  };
}

test("compacts repeated rollout and evidence data out of the overview", () => {
  const snapshot = fixture();
  const resources = splitSnapshotResources(snapshot);
  const fullBytes = JSON.stringify(snapshot).length;
  const overviewBytes = JSON.stringify(resources.overview).length;

  assert.ok(overviewBytes < fullBytes / 5);
  assert.deepEqual(resources.overview.hosts[0].sessions[0].userMessages, []);
  assert.deepEqual(
    resources.overview.hosts[0].agents[0].rollout.assistantMessages,
    [],
  );
  assert.equal(
    resources.overview.hosts[0].agents[0].remoteJobs[0].evidence,
    "",
  );
  assert.equal("gpuUsage" in resources.overview, false);
  assert.equal("submissionTracker" in resources.overview, false);
});

test("syncs only changed GPU entities and reconstructs the cached snapshot", () => {
  const store = createIncrementalSnapshotStore({ epoch: "bridge-a" });
  const first = fixture();
  store.publish(first);
  const reset = store.read({ clientEpoch: "", since: 0 });
  const cached = applySnapshotSync(null, reset);

  const second = structuredClone(first);
  second.generatedAt = "2026-08-18T00:00:16.000Z";
  second.gpuUsage.updatedAt = second.generatedAt;
  second.gpuUsage.episodes[0].samples = 2;
  second.gpuUsage.episodes[0].lastSeenAt = second.generatedAt;
  store.publish(second);

  const delta = store.read({ clientEpoch: "bridge-a", since: 1 });
  assert.equal(delta.reset, false);
  assert.equal(delta.submissionTracker, undefined);
  assert.deepEqual(delta.gpuUsage.upserts.map((episode) => episode.id), ["gpu-1"]);
  assert.deepEqual(delta.gpuUsage.removes, []);

  const merged = applySnapshotSync(cached, delta);
  const resources = splitSnapshotResources(second);
  assert.deepEqual(merged, {
    ...resources.overview,
    gpuUsage: resources.gpuUsage,
    submissionTracker: resources.submissionTracker,
  });
});

test("falls back to a reset after the bounded revision window expires", () => {
  const store = createIncrementalSnapshotStore({
    epoch: "bridge-b",
    maxHistory: 2,
  });
  const snapshot = fixture();
  store.publish(snapshot);
  for (let index = 0; index < 4; index += 1) {
    snapshot.generatedAt = `2026-08-18T00:00:0${index + 2}.000Z`;
    store.publish(snapshot);
  }

  const response = store.read({ clientEpoch: "bridge-b", since: 1 });
  assert.equal(response.reset, true);
  assert.equal(response.revision, 5);
  assert.equal(store.info().retainedRevisions, 2);
});

test("field deltas omit unchanged history and retain compatibility with old clients", () => {
  const store = createIncrementalSnapshotStore({ epoch: "fields" });
  const first = fixture();
  first.hosts[0].sessions[0].lastAssistant = "large history ".repeat(10000);
  store.publish(first);
  const reset = store.read();
  const second = structuredClone(first);
  second.generatedAt = "later";
  second.hosts[0].gpus = [{ index: 0, utilization: 20 }];
  store.publish(second);
  const delta = store.read({ clientEpoch: "fields", since: 1, fieldDeltas: true });
  assert.ok(JSON.stringify(delta).length < 1000);
  assert.equal(delta.overview, undefined);
  assert.deepEqual(applySnapshotSync(applySnapshotSync(null, reset), delta), applySnapshotSync(null, store.read()));
  assert.deepEqual(store.read({ clientEpoch: "fields", since: 1 }).overview, splitSnapshotResources(second).overview);
});

test("field deltas preserve order and removals across multiple missed revisions", () => {
  const store = createIncrementalSnapshotStore({ epoch: "order" });
  const first = fixture();
  first.hosts.push({ alias: "temporary", hostname: "old", sessions: [], agents: [] });
  store.publish(first);
  const reset = store.read();
  const second = structuredClone(first);
  second.hosts.pop(); delete second.scanning;
  store.publish(second);
  const third = structuredClone(second);
  third.hosts.unshift({ alias: "temporary", sessions: [], agents: [] });
  store.publish(third);
  const merged = applySnapshotSync(applySnapshotSync(null, reset), store.read({ clientEpoch: "order", since: 1, fieldDeltas: true }));
  assert.deepEqual(merged, applySnapshotSync(null, store.read()));
  assert.equal(merged.hosts[0].hostname, undefined);
  assert.equal(Object.hasOwn(merged, "scanning"), false);
});

