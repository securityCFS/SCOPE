import { LOCAL_HOST } from "../../lib/execution-host.js";
import { localDirectory } from "../local/directories.mjs";
import { localThreadDialogue } from "../local/dialogue.mjs";
/** Adapter reuses SCOPE's existing durable, single-writer app-server transport. */
export function codexWorkbenchAdapter({
  manager,
  archives,
  getHost,
  readModels,
  connectionKey,
}) {
  return {
    async archive(task) {
      await archives.change(
        task.host,
        task.remote.sessionId,
        "archive",
        task.remote,
      );
    },
    async restore(task) {
      await archives.change(
        task.host,
        task.remote.sessionId,
        "restore",
        task.remote,
      );
    },
    async launch(task, config, checkpoint) {
      const host = getHost(task.host);
      if (!host?.reachable)
        throw Object.assign(new Error("主机当前不可连接"), {
          beforeLaunch: true,
        });
      const model =
        task.kind === "manager"
          ? config.manager.model
          : config.providers.codex.model;
      const key =
        task.remote?.connectionKey || (await connectionKey(task.host));
      const effort =
        task.kind === "manager" ? config.manager.effort || null : null;
      if (model) {
        const catalog = await readModels(host, false, key);
        const selected = catalog.models.find(
          (m) => (m.model || m.id) === model,
        );
        if (!selected)
          throw Object.assign(
            new Error(`远端账号没有模型 ${model}，请在设置中选择可用模型`),
            { beforeLaunch: true },
          );
        if (effort && !selected.supportedReasoningEfforts?.includes(effort))
          throw Object.assign(
            new Error(`模型 ${model} 不支持推理强度 ${effort}，请重新选择`),
            { beforeLaunch: true },
          );
      }
      let remote = task.remote;
      if (!remote?.sessionId) {
        if (task.host === LOCAL_HOST) {
          try {
            await localDirectory(task.cwd);
          } catch (error) {
            throw Object.assign(error, { beforeLaunch: true });
          }
        }
        const created = await manager.createSession({
          host: task.host,
          cwd: task.cwd,
          model: model || null,
          effort,
          executable: config.providers.codex.executable,
          connectionKey: key,
          yolo: task.kind !== "manager",
          readOnly: task.kind === "manager",
        });
        remote = {
          ...created,
          model: created.model || model,
          kind: "app-server",
        };
        await checkpoint(remote); // Save identity before sending the first turn.
      } else if (!manager.isManaged(task.host, remote.sessionId)) {
        await manager.resumeSession({
          ...remote,
          host: task.host,
          readOnly: task.kind === "manager",
        });
      }
      if (
        model &&
        (remote.model !== model || (remote.effort || null) !== effort)
      ) {
        await manager.setSessionModel(
          task.host,
          remote.sessionId,
          model,
          effort,
        );
        remote = { ...remote, model, effort };
        await checkpoint(remote);
      }
      const turn = await manager.startTurn(
        task.host,
        remote.sessionId,
        task.prompt,
        {
          effort,
          ...(task.attachments?.length ? { attachments: task.attachments } : {}),
        },
      );
      return { ...remote, turnId: turn?.turn?.id || null };
    },
    async poll(task) {
      if (!task.remote?.turnId)
        return {
          status: "unknown",
          error:
            task.error || "Turn 回执缺失，请查看原会话后处理；不会自动重发",
        };
      const connection = await manager.prepareHost(
        task.host,
        task.remote.executable,
        task.remote.connectionKey,
      );
      const response = await connection.request("thread/read", {
        threadId: task.remote.sessionId,
        includeTurns: true,
      });
      const turn = response.thread?.turns?.find(
        (t) => t.id === task.remote.turnId,
      );
      if (!turn) return { status: "unknown", error: "远端尚未找到此 Turn" };
      const text = (turn.items || [])
        .filter((i) => i.type === "agentMessage" && i.phase !== "commentary")
        .map((i) => i.text || "")
        .join("\n\n");
      const activity = localThreadDialogue({ turns: [turn] }, { limit: 100 })
        .events.filter((e) => e.category !== "dialogue" && e.kind !== "error")
        .slice(-100);
      if (turn.status === "completed")
        return {
          status: "completed",
          text,
          activity,
          sessionId: task.remote.sessionId,
        };
      if (["failed", "interrupted"].includes(turn.status))
        return {
          status: "failed",
          text,
          activity,
          error: turn.error?.message || `Turn ${turn.status}`,
        };
      const pending = manager
        .publicState()
        .pendingRequests?.some(
          (r) => r.threadId === task.remote.sessionId && r.host === task.host,
        );
      return { status: pending ? "waiting" : "running", text, activity };
    },
  };
}
