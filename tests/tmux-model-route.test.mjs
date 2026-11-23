import test from "node:test";
import assert from "node:assert/strict";
import { modelRoutes } from "../bridge/routes/models.mjs";

test("model switching targets unlinked terminal agents by host and ID, with busy and catalog guards", async () => {
  const agent = { id: "terminal-1", host: "host-a", pane: { target: "1:0.0" }, status: "idle", rollout: null };
  let body, reply, selected = 0;
  const route = modelRoutes(() => ({ snapshot: { hosts: [{ alias: "host-a", agents: [agent] }] }, findAgent: () => null,
    readJsonBody: async () => body, jsonResponse: (_response, status, value) => { reply = { status, ...value }; },
    appServerManager: { isConnected: () => false, sessionRecords: () => [] },
    sessionYolo: () => true, hostRuntimeConfig: () => ({ yolo: true }),
    readInstalledModels: async () => ({ models: [{ id: "test-model", supportedReasoningEfforts: ["high"] }] }),
    selectTmuxModel: async (target) => { assert.equal(target, agent); selected++; return { model: "test-model" }; },
  }));
  async function request(extra = {}) {
    body = { host: "host-a", agentId: "terminal-1", model: "test-model", effort: "high", ...extra };
    await route({ method: "POST" }, {}, new URL("http://test/api/session/model"));
    return reply.status;
  }
  assert.equal(await request(), 200);
  assert.equal(selected, 1);
  assert.equal(await request({ host: "host-b" }), 404);
  assert.equal(await request({ sessionId: "wrong-session" }), 404);
  assert.equal(await request({ model: "unknown" }), 400);
  assert.equal(await request({ effort: "unsupported" }), 400);
  agent.status = "working";
  assert.equal(await request(), 409);
  assert.equal(selected, 1);
});
