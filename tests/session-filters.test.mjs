import assert from "node:assert/strict";
import test from "node:test";
import {
  collectCwdOptions,
  excludeActiveSessions,
} from "../lib/session-filters.js";

test("historical workdirs remain available when there are no active sessions", () => {
  const activeSessions = [];
  const historicalSessions = [
    { host: "gpu-box", cwd: "/workspace/research-b" },
    { host: "gpu-box", cwd: "/workspace/research-a" },
    { host: "gpu-box", cwd: "/workspace/research-a" },
    { host: "other", cwd: "/workspace/other" },
  ];

  assert.deepEqual(
    collectCwdOptions(
      [...activeSessions, ...historicalSessions],
      "gpu-box",
    ),
    ["/workspace/research-a", "/workspace/research-b"],
  );
});

test("app-server managed Sessions are excluded from inactive history", () => {
  const historicalSessions = [
    {
      host: "gpu-box",
      rollout: { id: "managed-session" },
      historical: true,
    },
    {
      host: "gpu-box",
      rollout: { id: "inactive-session" },
      historical: true,
    },
  ];
  const appServerSessions = [
    {
      host: "gpu-box",
      sessionId: "managed-session",
      status: "working",
    },
  ];

  assert.deepEqual(
    excludeActiveSessions(historicalSessions, appServerSessions).map(
      (session) => session.rollout.id,
    ),
    ["inactive-session"],
  );
});
