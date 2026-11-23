import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { installCommand } from "../bridge/maintenance/install-command.mjs";
import { AgentMaintenance } from "../bridge/maintenance/service.mjs";

test("installation uses fixed vendor packages and applies optional pre-launch setup", () => {
  const direct = installCommand("claude", "install", {
    executable: "claude",
    preLaunchCommand: "",
  });
  assert.ok(direct.startsWith("exec python3 -c"));
  assert.ok(direct.includes("https://claude.ai/install.sh"));
  assert.throws(() => installCommand("codex; bad", "install", {}));
  assert.throws(() => installCommand("codex", "delete", {}));
  assert.throws(() => installCommand("antigravity", "install", {}), /官方/);
  assert.ok(installCommand("antigravity", "check", {}).includes("antigravity"));
  const command = installCommand("claude", "install", {
    executable: "claude",
    preLaunchCommand: "source ~/.proxy.sh",
  });
  assert.ok(command.startsWith("source ~/.proxy.sh\nscope_setup_status=$?\nif"));
  assert.ok(command.includes("https://claude.ai/install.sh"));
  assert.ok(installCommand("dsh", "update", {}).includes("@deepseek-ai/dsh"));
  const checkCodex = installCommand("codex", "check", {});
  assert.ok(checkCodex.includes(".nvm/versions/node"));
  assert.ok(checkCodex.includes("except Exception:\n            latest = None"));
});
test("installer checkpoints before launch, deduplicates double clicks and reconciles after restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "scope-maintenance-"));
  const launches = [];
  const options = {
    directory,
    getHost: () => ({ reachable: true }),
    settings: () => ({ executable: "codex", preLaunchCommand: "" }),
    run: async (_host, command) => {
      const payload = JSON.parse(
        Buffer.from(command.match(/'([^']+)'$/)[1], "base64url"),
      );
      if (payload.operation === "launch") {
        launches.push(payload);
        return { code: 0, stdout: JSON.stringify({ status: "running" }) };
      }
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "completed",
          stdout:
            "SCOPE_INSTALL_RESULT=" +
            JSON.stringify({ installed: "codex-cli 1.2.3", supported: true }),
        }),
      };
    },
  };
  const service = await new AgentMaintenance(options).load();
  const [one, two] = await Promise.all([
    service.start("remote", "codex", "install"),
    service.start("remote", "codex", "install"),
  ]);
  assert.equal(one.id, two.id);
  while (!launches.length)
    await new Promise((resolve) => setImmediate(resolve));
  await service.tail;
  const restored = await new AgentMaintenance(options).load();
  const rows = await restored.view("remote");
  assert.equal(launches.length, 1);
  assert.equal(rows[0].job.status, "completed");
  assert.equal(rows[0].job.info.installed, "codex-cli 1.2.3");
  await assert.rejects(restored.start("@local", "codex", "install"), /远端/);
});
test("lost remote response remains unknown and cannot launch a duplicate installation", async () => {
  const service = await new AgentMaintenance({
    directory: await mkdtemp(path.join(os.tmpdir(), "scope-install-unknown-")),
    getHost: () => ({ reachable: true }),
    settings: () => ({}),
    run: async () => {
      throw new Error("connection lost");
    },
  }).load();
  const first = await service.start("remote", "codex", "install");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await service.view("remote");
  const again = await service.start("remote", "codex", "install");
  assert.equal(again.id, first.id);
  assert.equal(again.status, "unknown");
});
