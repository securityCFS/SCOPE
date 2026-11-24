import test from "node:test";
import assert from "node:assert/strict";
import {
  CodexUpgrades,
  parseCodexUpgradeOutput,
  remoteCodexUpgradeScript,
  stableVersion,
  wrapCodexUpgradeCommand,
} from "../bridge/codex-upgrade.mjs";

function setup(overrides = {}) {
  const calls = [];
  const info = { installed: "0.156.0", latest: "0.158.0", supported: true };
  const jobs = new CodexUpgrades({
    inspect: async () => info,
    install: async (host, target) => { calls.push(["install", host, target]); return { ...info, installed: target }; },
    restart: async (host) => { calls.push(["restart", host]); return { status: "completed", results: [{ sessionId: "a", ok: true }] }; },
    running: () => [{ version: "0.158.0", status: "connected" }],
    ...overrides,
  });
  return { jobs, calls };
}
test("check never installs or restarts; jobs are host-scoped", async () => {
  const { jobs, calls } = setup();
  await jobs.start("gpu-box", "check").done;
  assert.equal(jobs.view("gpu-box").status, "completed");
  assert.equal(jobs.view("other"), null);
  assert.deepEqual(calls, []);
});
test("upgrade is deduplicated and verifies install before restart", async () => {
  const { jobs, calls } = setup();
  const job = jobs.start("gpu-box", "upgrade");
  assert.equal(jobs.start("gpu-box", "upgrade"), job);
  await job.done;
  assert.deepEqual(calls, [["install", "gpu-box", "0.158.0"], ["restart", "gpu-box"]]);
  assert.equal(jobs.view("gpu-box").status, "completed");
});
test("busy restart stays explicitly pending, not successful or auto-retried", async () => {
  const { jobs } = setup({ restart: async () => ({ status: "failed", error: "仍有后台命令", results: [] }) });
  await jobs.start("gpu-box", "upgrade").done;
  assert.equal(jobs.view("gpu-box").status, "pending-switch");
  assert.match(jobs.view("gpu-box").error, /后台命令/);
  assert.equal(jobs.view("gpu-box").info.installed, "0.158.0");
});
test("failed install, mismatch and unsupported installation never restart", async () => {
  for (const overrides of [
    { install: async () => { throw new Error("download failed"); } },
    { install: async () => ({ installed: "0.156.0" }) },
    { inspect: async () => ({ latest: "0.158.0", supported: false }) },
  ]) {
    const { jobs, calls } = setup(overrides);
    await jobs.start("gpu-box", "upgrade").done;
    assert.equal(jobs.view("gpu-box").status, "failed");
    assert.equal(calls.some(([action]) => action === "restart"), false);
  }
});
test("runtime version is verified and resume failures are exposed", async () => {
  const { jobs } = setup({ running: () => [{ version: "0.153.4", status: "connected" }] });
  await jobs.start("gpu-box", "upgrade").done;
  assert.equal(jobs.view("gpu-box").status, "pending-switch");
  const partial = setup({ restart: async () => ({ status: "partial", results: [{ sessionId: "a", ok: false, error: "locked" }] }) });
  await partial.jobs.start("gpu-box", "upgrade").done;
  assert.equal(partial.jobs.view("gpu-box").results[0].error, "locked");
});
test("remote script validates version, backs up, locks and pins official package", () => {
  for (const value of ["latest", "0.158.0;kill", "../a", "0.158.0-alpha.1", null]) assert.throws(() => stableVersion(value));
  const script = remoteCodexUpgradeScript("0.158.0");
  assert.match(script, /flock/);
  assert.match(script, /shutil.copytree/);
  assert.match(script, /registry=https:\/\/registry.npmjs.org/);
  assert.match(script, /拒绝降级/);
  assert.doesNotMatch(script, /pkill|killall|auth\.json|thread\/archive/);
  assert.throws(() => remoteCodexUpgradeScript("1;kill"));
  const localRegistry = remoteCodexUpgradeScript(null, "0.162.1");
  assert.match(localRegistry, /latest = "0.162.1"/);
  assert.doesNotMatch(localRegistry, /npm', 'view'/);
  assert.match(localRegistry, /\.nvm\/versions\/node/);
  assert.throws(() => remoteCodexUpgradeScript(null, "1;kill"));

  const direct = wrapCodexUpgradeCommand("print(1)", "");
  assert.equal(direct.command, "python3 -");
  assert.equal(direct.stdin, "print(1)");

  const proxied = wrapCodexUpgradeCommand("print(1)", "source ~/.pkg_proxy.sh");
  assert.match(proxied.command, /^bash -ic /);
  assert.match(proxied.command, /pkg_proxy\.sh/);
  assert.equal(proxied.stdin, "");

  assert.deepEqual(
    parseCodexUpgradeOutput('motd noise\nSCOPE_CODEX_UPGRADE_RESULT={"installed":"0.172.0","latest":"0.172.0"}\n'),
    { installed: "0.172.0", latest: "0.172.0" },
  );
});
