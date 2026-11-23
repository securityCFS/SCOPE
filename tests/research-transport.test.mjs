import test from "node:test";
import assert from "node:assert/strict";
import { scanResearchHost } from "../bridge/research/scan-host.mjs";
import { LOCAL_HOST } from "../lib/execution-host.js";

test("research scans local files without SSH and retains other hosts after a thrown transport error", async () => {
  const args = { encoded: "encoded", script: "probe", timeoutMs: 1000,
    runLocal: async () => ({ code: 0, stdout: JSON.stringify({ results: [{ rollout: { id: "local-match" } }] }) }),
    runSsh: async (host) => { assert.notEqual(host, LOCAL_HOST); if (host === "broken") throw new Error("connection lost"); return { code: 0, stdout: '{"results":[]}' }; } };
  const results = await Promise.all([LOCAL_HOST, "broken", "good"].map((alias) => scanResearchHost({ ...args, host: { alias } })));
  assert.equal(results[0].results[0].rollout.id, "local-match");
  assert.equal(results[1].error, "connection lost");
  assert.equal(results[2].error, null);
});

test("research rejects truncated or malformed probe output without failing the batch", async () => {
  for (const stdout of ["partial{", "{}", "null"]) {
    const result = await scanResearchHost({ host: { alias: LOCAL_HOST }, runLocal: async () => ({ code: 0, stdout }) });
    assert.ok(result.error);
    assert.deepEqual(result.results, []);
  }
});
