import test from "node:test";
import assert from "node:assert/strict";
import {
  NativeModels,
  parseNativeModels,
  parseClaudeModels,
  agyModelCapabilities,
} from "../bridge/providers/native-models.mjs";

test("AGY exposes only published effort variants and validates CLI modes", async () => {
  const output = "model-pro-low\tModel Pro Low\nmodel-pro-high\tModel Pro High\nfixed\tFixed\n  --effort    reasoning\n  --mode    (accept-edits, auto, plan)\n";
  const entries = agyModelCapabilities(output);
  assert.deepEqual(entries[0].efforts, ["low", "high"]);
  assert.deepEqual(entries[2].efforts, []);
  const service = new NativeModels({ hosts: () => [{ alias: "h", reachable: true }], settings: () => ({ executable: "agy" }), run: async () => ({ code: 0, stdout: output }) });
  assert.equal(await service.validateAgyOptions("h", "model-pro-low", "high", "auto"), "model-pro-high");
  await assert.rejects(service.validateAgyOptions("h", "model-pro-low", "max", "auto"), /强度/);
  await assert.rejects(service.validateAgyOptions("h", "fixed", "high", "plan"), /强度/);
  await assert.rejects(service.validateAgyOptions("h", "", "high", "auto"), /先选择/);
  assert.equal(agyModelCapabilities("legacy\tLegacy\n")[0].supportsAutoMode, false);
  assert.equal(agyModelCapabilities(output + "warning: --mode auto is not available for this account; continuing in the default mode.\n")[0].supportsAutoMode, false);
});

test("Claude discovery validates effort and auto against the remote model capabilities", async () => {
  const output = 'banner\n' + JSON.stringify({ models: [
    { id: "default", label: "Default", resolvedModel: "claude-example", efforts: ["low", "high", "bad"], supportsAutoMode: true },
    { id: "legacy", label: "Legacy", efforts: [], supportsAutoMode: false },
  ] });
  assert.deepEqual(parseClaudeModels(output)[0].efforts, ["low", "high"]);
  let calls = 0;
  const service = new NativeModels({ hosts: () => [{ alias: "h", reachable: true }], settings: () => ({ executable: "claude" }), run: async (_h, command) => {
    calls++; assert.doesNotMatch(command, /scope_proxy_status/); assert.match(command, /python3/);
    return { code: 0, stdout: output };
  } });
  await service.validateClaudeOptions("h", "", "high", "auto");
  await service.validateClaudeOptions("h", "claude-example", "low", "auto");
  await assert.rejects(service.validateClaudeOptions("h", "legacy", "high", "default"), /强度/);
  await assert.rejects(service.validateClaudeOptions("h", "legacy", "", "auto"), /auto/);
  await assert.rejects(service.validateClaudeOptions("h", "invented", "", "default"), /模型/);
  assert.equal(calls, 1);
});
test("native model discovery ignores banners and deduplicates valid IDs", () => {
  assert.deepEqual(
    parseNativeModels(
      "Fetching...\nx-medium\tX Medium\r\nx-medium\tX Medium\n$(bad)\tbad\n",
    ),
    [{ id: "x-medium", label: "X Medium" }],
  );
});
test("model discovery caches, coalesces concurrent requests and rejects unsupported models", async () => {
  let calls = 0;
  const models = new NativeModels({
    hosts: () => [{ alias: "alpha", reachable: true }],
    settings: () => ({ executable: "agy", preLaunchCommand: "source ~/.proxy.sh" }),
    run: async (_host, command) => {
      calls++;
      assert.match(command, /source ~\/\.proxy\.sh/);
      assert.match(command, /scope_proxy_status/);
      return { code: 0, stdout: "a\tModel A\n" };
    },
  });
  await Promise.all([
    models.list("alpha", "antigravity"),
    models.list("alpha", "antigravity"),
  ]);
  await models.validate("alpha", "antigravity", "a");
  assert.equal(calls, 1);
  await assert.rejects(
    models.validate("alpha", "antigravity", "invented"),
    /不支持/,
  );
  await models.list("alpha", "antigravity", true);
  assert.equal(calls, 2);
  await assert.rejects(models.list("offline", "antigravity"), /在线/);
});
