import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeHostRuntimeConfig,
  normalizePreLaunchCommand,
  runtimePolicy,
} from "../lib/runtime-config.js";

test("normalizes host startup commands and preserves legacy defaults", () => {
  assert.deepEqual(
    normalizeHostRuntimeConfig({}, { preLaunchCommand: "source ~/.proxy.sh", yolo: true }),
    {
      preLaunchCommand: "source ~/.proxy.sh",
      yolo: true,
      residentSessionLimit: null,
      updatedAt: null,
    },
  );
  assert.equal(
    normalizeHostRuntimeConfig({ residentSessionLimit: 8 }).residentSessionLimit,
    8,
  );
  assert.equal(
    normalizeHostRuntimeConfig({ residentSessionLimit: "" }, { residentSessionLimit: 8 })
      .residentSessionLimit,
    null,
  );
  assert.equal(
    normalizeHostRuntimeConfig({}, { residentSessionLimit: 6 }).residentSessionLimit,
    6,
  );
  assert.equal(
    normalizePreLaunchCommand("  source ~/.bashrc\r\nexport http_proxy=http://127.0.0.1:7890\0  "),
    "source ~/.bashrc\nexport http_proxy=http://127.0.0.1:7890",
  );
});

test("maps YOLO and guarded choices to valid app-server policies", () => {
  assert.deepEqual(runtimePolicy(true), {
    yolo: true,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    sandboxPolicy: { type: "dangerFullAccess" },
  });
  assert.deepEqual(runtimePolicy(false), {
    yolo: false,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    sandboxPolicy: { type: "workspaceWrite" },
  });
});
