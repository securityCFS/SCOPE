import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyGpuUsageHistory,
  updateGpuUsageHistory,
} from "../bridge/gpu-usage-history.mjs";

function hostWithWorkload({
  reachable = true,
  memoryMiB = 4_096,
  workloads = true,
} = {}) {
  return {
    alias: "gpu-box",
    reachable,
    gpus: [
      {
        index: 2,
        uuid: "GPU-abc",
        name: "NVIDIA A100",
      },
    ],
    agents: [
      {
        cwd: "/work/qgf",
        rollout: { id: "session-qgf", lastUser: "run QGF" },
        suggestedSummary: { theme: "QGF reward goal-z" },
      },
    ],
    workloads: workloads
      ? [
          {
            pid: 4100,
            groupId: 4000,
            elapsedSeconds: 120,
            workerPids: [4100, 4101],
            kind: "evaluation",
            command: "python",
            cmdline: "python eval_qgf.py --goal-z reward-regressed",
            cwd: "/work/qgf",
            pane: {
              session: "qgf-eval",
              pane: "0.0",
            },
            ownerSessionId: "session-qgf",
            ownerConfidence: "strong",
            ownerEvidence: ["启动命令匹配 eval_qgf.py"],
            gpus: [
              {
                index: 2,
                memoryMiB,
                pid: 4101,
              },
            ],
          },
        ]
      : [],
  };
}

test("merges GPU samples into intervals and retains Session ownership", () => {
  const started = Date.parse("2026-07-24T08:00:00.000Z");
  let history = updateGpuUsageHistory(
    emptyGpuUsageHistory(),
    [hostWithWorkload()],
    started,
  );

  assert.equal(history.episodes.length, 1);
  assert.equal(history.episodes[0].active, true);
  assert.equal(history.episodes[0].gpuIndex, 2);
  assert.equal(history.episodes[0].ownerSessionId, "session-qgf");
  assert.equal(history.episodes[0].sessionTheme, "QGF reward goal-z");
  assert.equal(history.episodes[0].paneSession, "qgf-eval");
  assert.equal(history.episodes[0].samples, 1);

  history = updateGpuUsageHistory(
    history,
    [hostWithWorkload({ memoryMiB: 6_144 })],
    started + 15_000,
  );
  assert.equal(history.episodes.length, 1);
  assert.equal(history.episodes[0].samples, 2);
  assert.equal(history.episodes[0].lastMemoryMiB, 6_144);
  assert.equal(history.episodes[0].maxMemoryMiB, 6_144);

  history = updateGpuUsageHistory(
    history,
    [hostWithWorkload({ workloads: false })],
    started + 30_000,
  );
  assert.equal(history.episodes[0].active, false);
  assert.equal(
    history.episodes[0].endedAt,
    "2026-07-24T08:00:30.000Z",
  );
});

test("does not close an active GPU interval when its SSH host is unreachable", () => {
  const started = Date.parse("2026-07-24T08:00:00.000Z");
  const current = updateGpuUsageHistory(
    emptyGpuUsageHistory(),
    [hostWithWorkload()],
    started,
  );
  const afterOutage = updateGpuUsageHistory(
    current,
    [hostWithWorkload({ reachable: false, workloads: false })],
    started + 15_000,
  );

  assert.equal(afterOutage.episodes[0].active, true);
  assert.equal(afterOutage.episodes[0].endedAt, null);
  assert.equal(
    afterOutage.episodes[0].lastSeenAt,
    "2026-07-24T08:00:00.000Z",
  );
});

test("prunes GPU intervals outside the retention window", () => {
  const now = Date.parse("2026-07-24T08:00:00.000Z");
  const stale = {
    version: 1,
    updatedAt: "2026-07-16T07:00:00.000Z",
    retentionHours: 168,
    episodes: [
      {
        id: "stale",
        host: "gpu-box",
        gpuIndex: 0,
        pid: 1,
        groupId: 1,
        firstSeenAt: "2026-07-16T07:00:00.000Z",
        lastSeenAt: "2026-07-16T07:00:00.000Z",
        active: false,
      },
    ],
  };

  const history = updateGpuUsageHistory(stale, [], now);
  assert.deepEqual(history.episodes, []);
});
