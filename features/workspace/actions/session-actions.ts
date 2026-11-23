import {
  bridgeUrl,
  managementKey,
  priorityLabel,
  recoveryCwdOptions,
  resolvedSummary,
  rolloutUsesYolo,
} from "@/features/workspace/shared";
import type {
  Agent,
  SessionManagement,
  Snapshot,
} from "@/features/workspace/types";
import type { Dispatch, SetStateAction } from "react";
export async function updatePriority(
  {
    setBusyAction,
    setActionNotice,
    postJson,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
  },
  agent: Agent,
  priority: SessionManagement["priority"],
) {
  if (!agent.rollout || !priority || agent.historical) return;
  const action = `priority:${managementKey(agent)}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    await postJson("/api/session", {
      host: agent.host,
      sessionId: agent.rollout.id,
      priority,
    });
    setActionNotice({
      kind: "success",
      text: `已保存 ${priorityLabel[priority]}，列表与调度 prompt 已更新。`,
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function toggleSessionReserved(
  {
    snapshot,
    setBusyAction,
    setActionNotice,
    postJson,
  }: {
    snapshot: Snapshot;
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
  },
  agent: Agent,
  nextReserved?: boolean,
) {
  if (!agent.rollout || agent.historical) return;
  const key = managementKey(agent);
  const action = `reserve:${key}`;
  const current = Boolean(snapshot.management?.sessions[key]?.reserved);
  const reserved = typeof nextReserved === "boolean" ? nextReserved : !current;
  setBusyAction(action);
  setActionNotice(null);
  try {
    await postJson("/api/session", {
      host: agent.host,
      sessionId: agent.rollout.id,
      reserved,
    });
    setActionNotice({
      kind: "success",
      text: reserved
        ? "已设为常驻保留资源，超出设备常驻池时也不会被自动断开。"
        : "已取消常驻保留，该会话将按设备常驻池顺序调度。",
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function saveTheme(
  {
    themeEdit,
    snapshot,
    setBusyAction,
    setActionNotice,
    postJson,
    setThemeEdit,
    setInlineRename,
  }: {
    themeEdit: { key: string; value: string } | null;
    snapshot: Snapshot;
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    setThemeEdit: Dispatch<
      SetStateAction<{ key: string; value: string } | null>
    >;
    setInlineRename: Dispatch<
      SetStateAction<{ key: string; value: string } | null>
    >;
  },
  agent: Agent,
  requestedValue?: string,
) {
  if (!agent.rollout || agent.historical) return;
  const key = managementKey(agent);
  const value =
    requestedValue ??
    (themeEdit?.key === key
      ? themeEdit.value
      : resolvedSummary(agent, snapshot.management).theme);
  if (!value.trim()) return;
  const action = `theme:${key}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    await postJson("/api/session", {
      host: agent.host,
      sessionId: agent.rollout.id,
      theme: value,
    });
    setThemeEdit(null);
    setInlineRename(null);
    setActionNotice({ kind: "success", text: "Session 名称已保存。" });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function saveResourcePolicy({
  setBusyAction,
  setActionNotice,
  postJson,
  policyDraft,
  snapshot,
  setPolicyDraft,
}: {
  setBusyAction: Dispatch<SetStateAction<string>>;
  setActionNotice: Dispatch<
    SetStateAction<{ kind: "success" | "error"; text: string } | null>
  >;
  postJson: <T>(
    path: string,
    body: unknown,
  ) => Promise<T & { error?: string | undefined }>;
  policyDraft: string | null;
  snapshot: Snapshot;
  setPolicyDraft: Dispatch<SetStateAction<string | null>>;
}) {
  setBusyAction("policy");
  setActionNotice(null);
  try {
    await postJson("/api/resource-policy", {
      prompt: policyDraft ?? snapshot.management?.resourcePolicy.prompt ?? "",
    });
    setPolicyDraft(null);
    setActionNotice({
      kind: "success",
      text: "资源策略已保存；尚未自动推送到任何会话。",
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function summarizeSession(
  {
    setBusyAction,
    setActionNotice,
    postJson,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
  },
  agent: Agent,
) {
  if (!agent.rollout || agent.historical) return;
  const action = `summary:${managementKey(agent)}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    await postJson("/api/summarize", {
      host: agent.host,
      sessionId: agent.rollout.id,
    });
    setActionNotice({
      kind: "success",
      text: "远端 Codex 已生成并保存新的结构化主题。",
    });
  } catch (error) {
    setActionNotice({
      kind: "error",
      text: `${(error as Error).message}；当前仍显示 rollout 草稿。`,
    });
  } finally {
    setBusyAction("");
  }
}

export async function discoverExperiments(
  {
    setBusyAction,
    setActionNotice,
    postJson,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
  },
  agent: Agent,
) {
  if (!agent.rollout || agent.historical) return;
  const action = `experiments:${managementKey(agent)}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{
      experiments: NonNullable<SessionManagement["experiments"]>;
    }>("/api/experiments/discover", {
      host: agent.host,
      sessionId: agent.rollout.id,
    });
    setActionNotice({
      kind: "success",
      text: result.experiments.runs.length
        ? `在会话目录下发现 ${result.experiments.runs.length} 个 W&B run。`
        : "会话目录下没有发现本地 W&B run。",
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function syncResourcePrompt(
  {
    setBusyAction,
    setActionNotice,
    postJson,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
  },
  agent: Agent,
) {
  if (!agent.rollout || agent.historical) return;
  const action = `sync:${managementKey(agent)}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{ target: string }>("/api/prompt/sync", {
      host: agent.host,
      sessionId: agent.rollout.id,
    });
    setActionNotice({
      kind: "success",
      text: `资源调度 prompt 已发送到 tmux ${result.target}。`,
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function compactSession(
  {
    setBusyAction,
    setActionNotice,
    postJson,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
  },
  agent: Agent,
) {
  if (!agent.rollout) return;
  const action = `compact:${managementKey(agent)}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{
      transport: "app-server" | "tmux";
      target?: string;
    }>("/api/session/compact", {
      host: agent.host,
      sessionId: agent.rollout.id,
    });
    setActionNotice({
      kind: "success",
      text:
        result.transport === "app-server"
          ? "已请求 app-server 压缩该 Session 的上下文。"
          : `已向 tmux ${result.target} 发送 /compact。`,
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function closeSession(
  {
    snapshot,
    setBusyAction,
    setActionNotice,
    postJson,
    setSelectedAgentId,
    setPendingInstruction,
  }: {
    snapshot: Snapshot;
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
    setPendingInstruction: Dispatch<
      SetStateAction<{
        key: string;
        sentAt: number;
        baselineAssistant: string;
        transport: "app-server" | "tmux";
        target: string;
      } | null>
    >;
  },
  agent: Agent,
) {
  if (!agent.rollout || !agent.appServerManaged) return;
  const key = managementKey(agent);
  const label =
    resolvedSummary(agent, snapshot.management)?.theme ||
    agent.rollout.lastUser ||
    agent.rollout.id.slice(0, 8);
  const confirmation = `停止 Session“${label}”？如果当前 Turn 正在执行，会先中止该 Turn，再解除网页托管。Session 日志与 Dialogue 会完整保留；共享 app-server、其他 Session、tmux、VS Code 和已启动的训练/评测进程均不受影响。`;
  if (!window.confirm(confirmation)) return;

  const action = `close:${key}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{
      stopped: boolean;
      interrupted: boolean;
      rolloutPreserved: boolean;
    }>("/api/session/close", {
      host: agent.host,
      sessionId: agent.rollout.id,
      confirmation: key,
    });
    setSelectedAgentId(null);
    setPendingInstruction((current) => (current?.key === key ? null : current));
    setActionNotice({
      kind: "success",
      text: result.interrupted
        ? "当前 Turn 已中止，Session 已停止托管；日志和 Dialogue 仍保留在历史记录中。"
        : "Session 已停止托管；日志和 Dialogue 仍保留在历史记录中。",
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function terminateTmuxSession(
  {
    setBusyAction,
    setActionNotice,
    postJson,
    setSelectedExperimentId,
    setSelectedAgentId,
    filteredAgents,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    setSelectedExperimentId: Dispatch<SetStateAction<string | null>>;
    setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
    filteredAgents: Agent[];
  },
  host: string,
  tmuxSession: string,
) {
  if (!host || !tmuxSession) return;
  const confirmation =
    `终止 ${host} 上的 tmux Session “${tmuxSession}”？\n\n` +
    "该 tmux 内的 Codex、训练或评测进程会被终止；Codex rollout、Dialogue 和历史日志会保留。其他 tmux Session 不受影响。";
  if (!window.confirm(confirmation)) return;

  const action = `terminate-tmux:${host}:${tmuxSession}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{
      tmuxSession: string;
      paneCount: number;
      sessionIds: string[];
      rolloutPreserved: boolean;
    }>("/api/tmux/session/terminate", {
      host,
      tmuxSession,
      confirmation: `${host}:${tmuxSession}`,
    });
    setSelectedExperimentId((current) =>
      current?.startsWith(`${host}:${tmuxSession}:`) ? null : current,
    );
    setSelectedAgentId((current) => {
      const selected = filteredAgents.find((agent) => agent.id === current);
      return selected?.host === host && selected.pane?.session === tmuxSession
        ? null
        : current;
    });
    setActionNotice({
      kind: "success",
      text: `tmux “${result.tmuxSession}” 已终止；其中 ${result.paneCount} 个 pane 已关闭，Codex Session 日志仍保留。`,
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function unarchiveSession(
  {
    setBusyAction,
    setActionNotice,
    postJson,
    setHistoryState,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    setHistoryState: Dispatch<
      SetStateAction<{
        sessions: Agent[];
        scannedAt: string | null;
        scope: string;
        hosts: {
          host: string;
          totalFiles: number;
          truncated: boolean;
          returned: number;
          error: string | null;
        }[];
        loading: boolean;
        error: string;
      }>
    >;
  },
  agent: Agent,
) {
  if (!agent.rollout?.archived) return;
  const key = managementKey(agent);
  const action = `unarchive:${key}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{ path: string | null }>(
      "/api/session/unarchive",
      {
        host: agent.host,
        sessionId: agent.rollout.id,
        confirmation: key,
      },
    );
    setHistoryState((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        managementKey(session) === key && session.rollout
          ? {
              ...session,
              rollout: {
                ...session.rollout,
                archived: false,
                path: result.path || session.rollout.path,
              },
            }
          : session,
      ),
    }));
    setActionNotice({
      kind: "success",
      text: "Session 日志已从归档区恢复；现在可以继续查看 Dialogue，或恢复到 App Server/tmux。",
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export function recoveryCwdFor(
  {
    recoveryCwdDrafts,
    snapshot,
  }: {
    recoveryCwdDrafts: Record<string, string>;
    snapshot: Snapshot;
  },
  agent: Agent,
) {
  return (
    recoveryCwdDrafts[managementKey(agent)] ??
    (agent.historical
      ? recoveryCwdOptions(agent, snapshot.hosts)[0] || ""
      : agent.cwd)
  );
}

export async function takeoverSession(
  {
    setBusyAction,
    setActionNotice,
    postJson,
    recoveryCwdFor,
    recoveryYoloDrafts,
    snapshot,
    refresh,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    recoveryCwdFor: (agent: Agent) => string;
    recoveryYoloDrafts: Record<string, boolean>;
    snapshot: Snapshot;
    refresh: () => Promise<void>;
  },
  agent: Agent,
) {
  if (
    !agent.rollout ||
    agent.pane ||
    (!agent.historical && !agent.appServerManaged)
  )
    return;
  const action = `takeover:${managementKey(agent)}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{
      target: string;
      killedPid: number | null;
      forced: boolean;
      mode: "active" | "history";
      panePid: number;
      readyInMs: number;
      paneCommand: string;
      transport: "tmux";
      switchedFrom: "app-server" | "cli";
    }>("/api/session/takeover", {
      host: agent.host,
      sessionId: agent.rollout.id,
      pid: agent.historical || agent.appServerManaged ? 0 : agent.pid,
      cwd: recoveryCwdFor(agent),
      yolo:
        recoveryYoloDrafts[managementKey(agent)] ??
        rolloutUsesYolo(agent, snapshot.management),
    });
    setActionNotice({
      kind: "success",
      text:
        result.switchedFrom === "app-server"
          ? `Session 已从 app-server 切换到 tmux ${result.target}；网页发送将改走 tmux 输入通道。`
          : result.mode === "active"
            ? `Codex PID ${result.killedPid} 已${
                result.forced ? "强制结束并" : "结束并"
              }恢复到 tmux ${result.target}；已验证 pane PID ${
                result.panePid || "—"
              } 正在运行 Codex（${result.readyInMs} ms）。训练/评测进程未被终止。`
            : `历史 Session 已恢复到 tmux ${result.target}；Codex 响应检查通过（${result.readyInMs} ms）。`,
    });
    window.setTimeout(() => refresh(), 900);
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function connectAppServer(
  {
    setBusyAction,
    setActionNotice,
    postJson,
    recoveryCwdFor,
    recoveryYoloDrafts,
    snapshot,
    refresh,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    recoveryCwdFor: (agent: Agent) => string;
    recoveryYoloDrafts: Record<string, boolean>;
    snapshot: Snapshot;
    refresh: () => Promise<void>;
  },
  agent: Agent,
) {
  if (!agent.rollout || (!agent.historical && !agent.appServerManaged)) return;
  const action = `app-server:${managementKey(agent)}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{
      alreadyConnected: boolean;
      killedPid: number | null;
      forced: boolean;
      session?: { model: string };
    }>("/api/app-server/connect", {
      host: agent.host,
      sessionId: agent.rollout.id,
      pid: agent.historical || agent.appServerManaged ? 0 : agent.pid,
      cwd: recoveryCwdFor(agent),
      yolo:
        recoveryYoloDrafts[managementKey(agent)] ??
        rolloutUsesYolo(agent, snapshot.management),
    });
    setActionNotice({
      kind: "success",
      text: result.alreadyConnected
        ? "该 Session 已连接 app-server，所有人工问题和审批都会实时显示在网页。"
        : result.killedPid
          ? `Codex PID ${result.killedPid} 已${
              result.forced ? "强制结束并" : "结束并"
            }由 app-server 恢复；后续人工问题和审批可在网页处理。`
          : "历史 Session 已由 app-server 恢复；后续人工问题和审批可在网页处理。",
    });
    window.setTimeout(() => refresh(), 900);
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function restartHostCodex(
  {
    setBusyAction,
    postJson,
    setActionNotice,
    refresh,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    refresh: () => Promise<void>;
  },
  host: string,
) {
  if (
    !window.confirm(
      `重启 ${host} 的全部 SCOPE 托管 Codex 进程以加载 config.toml？保留会话日志和账号，不自动发送“继续”。工作中、后台命令或归属不明时将安全阻止；不操作其他 tmux 或 VS Code。`,
    )
  )
    return;
  setBusyAction(`host-config-restart:${host}`);
  try {
    type RestartJob = {
      status: string;
      phase: string;
      error?: string;
      results: { sessionId: string; ok: boolean; error?: string }[];
    };
    let job = await postJson<RestartJob>("/api/app-server/restart-host", {
      host,
      confirmation: `restart:${host}`,
    });
    for (
      let attempt = 0;
      job.status === "running" && attempt < 240;
      attempt++
    ) {
      setActionNotice({
        kind: "success",
        text: `${host} ${job.phase === "preflight" ? "正在核验重启安全性" : "正在重启并恢复会话"}…已恢复 ${job.results.length}`,
      });
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const response = await fetch(
        bridgeUrl(
          `/api/app-server/restart-host?host=${encodeURIComponent(host)}`,
        ),
      );
      if (!response.ok)
        throw new Error("重启状态查询失败；请勿重复点击，先核查服务状态");
      job = await response.json();
    }
    const failures = job.results.filter((r) => !r.ok);
    setActionNotice({
      kind: job.status === "completed" ? "success" : "error",
      text:
        job.status === "running"
          ? `${host} 重启仍在后台运行，请稍后查看`
          : job.error ||
            `${host}：恢复 ${job.results.length - failures.length} 个会话${failures.length ? `；失败 ${failures.length}：${failures.map((r) => r.error).join("；")}` : "，未重发指令"}`,
    });
    refresh();
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function recoverHostAppServer(
  {
    setBusyAction,
    setActionNotice,
    postJson,
    refresh,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    refresh: () => Promise<void>;
  },
  host: string,
) {
  const action = `host-recovery:${host}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{
      total: number;
      reconnected: number;
      continued: number;
      alreadyWorking: number;
      alreadyRecovering: number;
      idle: number;
      failed: number;
    }>("/api/app-server/recover-host", {
      host,
      confirmation: host,
    });
    const details = [
      result.reconnected ? `重连 ${result.reconnected}` : "",
      result.continued ? `续跑 ${result.continued}` : "",
      result.alreadyWorking ? `原本运行中 ${result.alreadyWorking}` : "",
      result.alreadyRecovering
        ? `已有恢复任务 ${result.alreadyRecovering}`
        : "",
      result.idle ? `保持空闲 ${result.idle}` : "",
      result.failed ? `失败 ${result.failed}` : "",
    ].filter(Boolean);
    setActionNotice({
      kind: result.failed ? "error" : "success",
      text: `${host} 恢复完成：${details.join(" · ") || `共 ${result.total} 条 Session`}`,
    });
    window.setTimeout(() => refresh(), 600);
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}
