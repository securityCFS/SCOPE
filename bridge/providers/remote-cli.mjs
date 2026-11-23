import { readFile } from "node:fs/promises";
import { renderInstructionWithAttachments } from "../session-attachments.mjs";
import { cliCommand, parseCliResult } from "./cli-command.mjs";
import { nativeGuardCommand } from "./native-session-state.mjs";
import { claudeInteractiveCommand } from "./claude-interactive.mjs";
import { antigravityInteractiveCommand } from "./antigravity-interactive.mjs";

export function remoteCliAdapter(runSsh, { hostPreLaunch } = {}) {
  const script = readFile(new URL("./remote-job.py", import.meta.url), "utf8");
  async function call(host, payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const result = await runSsh(
      host,
      "python3 -",
      `import sys\nsys.argv.append(${JSON.stringify(encoded)})\n${await script}`,
      20000,
      7_000_000, // JSON escaping may expand the two bounded 512 KB output streams.
    );
    if (result.code !== 0)
      throw new Error(result.stderr || "远端 Agent 连接失败");
    return JSON.parse(result.stdout.trim());
  }
  return {
    async archive(task) {
      return call(task.host, { operation: "archive", id: task.id });
    },
    async restore(task) {
      return call(task.host, { operation: "restore", id: task.id });
    },
    async launch(task, config) {
      const baseProvider = config?.providers?.[task.provider] || {};
      const preLaunchCommand = String(
        baseProvider.preLaunchCommand || hostPreLaunch?.(task.host) || "",
      ).trim();
      const effectiveProvider = { ...baseProvider, preLaunchCommand };
      const effectiveTask =
        Array.isArray(task.attachments) && task.attachments.length
          ? {
              ...task,
              prompt: renderInstructionWithAttachments(task.prompt, task.attachments),
            }
          : task;
      let command = effectiveTask.interactive
        ? await (effectiveTask.provider === "antigravity"
            ? antigravityInteractiveCommand(effectiveTask, effectiveProvider)
            : claudeInteractiveCommand(effectiveTask, effectiveProvider))
        : cliCommand(effectiveTask, effectiveProvider);
      if (["claude", "antigravity"].includes(effectiveTask.provider) && effectiveTask.resumeSessionId) command = await nativeGuardCommand({ action: "run", provider: effectiveTask.provider, sessionId: effectiveTask.resumeSessionId, command });
      const result = await call(effectiveTask.host, {
        operation: "launch",
        id: effectiveTask.id,
        command,
        ...(effectiveTask.interactive ? { interactiveConfig: { ...effectiveTask, executable: effectiveProvider.executable || (effectiveTask.provider === "antigravity" ? "agy" : "claude"), model: effectiveProvider.model } } : {}),
        // Interactive shell startup may spawn zsh and consume stdin before the
        // agent starts. Pass the quoted prompt in the command, never shell stdin.
        input: "",
      });
      return { kind: "remote-cli", id: task.id, remotePath: result.remotePath };
    },
    async poll(task) {
      if (task.interactive) {
        const result = await call(task.host, { operation: "status", id: task.id });
        return result.interactive || { ...result, error: result.stderr || result.error };
      }
      return parseCliResult(
        task.provider,
        await call(task.host, { operation: "status", id: task.id }),
      );
    },
    async control(task, control) {
      if (!task.interactive) throw new Error("此旧任务没有交互通道；请等待结束后开始新一轮");
      return call(task.host, { operation: "control", id: task.id, control });
    },
  };
}
