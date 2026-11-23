import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentEmailRelayServer,
  normalizeAgentEmailEvent,
} from "../bridge/agent-email-relay.mjs";

test("agent completion events are constrained and do not accept recipients", () => {
  const event = normalizeAgentEmailEvent({
    status: "completed",
    title: "Experiment finished",
    summary: "All evaluation shards passed.",
    host: "gpu-host",
    agent: "codex",
    session: "session-123",
    cwd: "/workspace/experiment",
    to: "attacker@example.com",
  });
  assert.match(event.key, /^agent-completion:[a-f0-9]{64}$/);
  assert.equal(event.severity, "completed");
  assert.equal(event.title, "[gpu-host] Experiment finished");
  assert.match(event.details.join("\n"), /session-123/);
  assert.doesNotMatch(JSON.stringify(event), /attacker@example.com/);
  assert.throws(
    () => normalizeAgentEmailEvent({ status: "progress", title: "x", summary: "y" }),
    /status must be/,
  );
});

test("agent email relay requires bearer auth and deduplicates through notifier", async (t) => {
  const events = [];
  const notifier = {
    publicState: () => ({ configured: true }),
    async notify(event) {
      events.push(event);
      return { sent: true, messageId: "mail-1" };
    },
  };
  const server = createAgentEmailRelayServer({ token: "x".repeat(32), notifier });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const endpoint = `http://127.0.0.1:${port}/v1/notify`;
  const payload = {
    status: "completed",
    title: "Done",
    summary: "The task completed successfully.",
    host: "test-host",
  };

  const unauthorized = await fetch(endpoint, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(events.length, 0);

  const accepted = await fetch(endpoint, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${"x".repeat(32)}`,
      "Content-Type": "application/json",
    },
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), {
    accepted: true,
    sent: true,
    duplicate: false,
  });
  assert.equal(events.length, 1);
});
