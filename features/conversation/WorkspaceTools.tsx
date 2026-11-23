"use client";
import { useEffect, useRef } from "react";
import {
  Check,
  CirclePause,
  Copy,
  Cpu,
  Gauge,
  LoaderCircle,
  MessageSquareText,
  Minimize2,
  Pin,
  SquareTerminal,
  Terminal,
  X,
} from "lucide-react";
import { QuotaMeterCard } from "@/components/quota-meter";
import { normalizeAccountQuota } from "@/lib/account-quota";
import {
  attachCommand,
  managementKey,
  resumeInTmuxCommand,
  statusLabel,
} from "@/features/workspace/shared";
import type { WorkspaceController } from "@/features/workspace/use-workspace-controller";
import { hostLabel, LOCAL_HOST } from "@/lib/execution-host";
import { useLocale } from "@/lib/i18n";

export function WorkspaceTools({
  workspace,
  onClose,
}: {
  workspace: WorkspaceController;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const agent = workspace.selectedAgent;
  const session = workspace.selectedAppServerSession;
  const key = agent ? managementKey(agent) : "";
  const busy = workspace.busyAction;
  const hostObj = agent
    ? workspace.snapshot.hosts.find((h) => h.alias === agent.host)
    : null;
  const gpus = hostObj?.gpus || [];
  const subagents = agent?.subagents || [];
  const gpuEpisodes = workspace.selectedAgentGpuUsage || [];

  const title = agent
    ? workspace.selectedSummary?.theme || agent.title || tr("会话信息", "Session Info")
    : tr("会话信息", "Session Info");
  const activeConnKey =
    session?.profileAssignment?.status === "applied" &&
    session.profileAssignment.profile
      ? `profile:${session.profileAssignment.profile}`
      : "active";
  const sessionQuota = agent
    ? session?.rateLimits ||
      workspace.snapshot.appServer.connections.find(
        (conn) =>
          conn.host === agent.host &&
          (conn.connectionKey || "active") === activeConnKey,
      )?.rateLimits ||
      normalizeAccountQuota(agent.rollout?.account)
    : null;

  return (
    <dialog
      ref={dialog}
      className="workspace-tools-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <div className="session-drawer-head">
          <strong title={title}>{title}</strong>
          {agent && (
            <span className={`session-drawer-status is-${agent.status}`}>
              {statusLabel[agent.status]}
            </span>
          )}
        </div>
        <button type="button" aria-label={tr("关闭会话信息", "Close")} onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className="session-drawer-body">
        {!agent ? (
          <p className="session-drawer-empty">
            {tr("请先从左侧选择一条会话。", "Select a conversation from the left sidebar first.")}
          </p>
        ) : (
          <>
            <section className="session-drawer-card">
              <h3>
                <Terminal size={14} />
                {tr("位置与终端", "Location & Terminal")}
              </h3>
              <div className="session-drawer-kv">
                <div>
                  <span>{tr("运行主机", "Host")}</span>
                  <strong>
                    {hostLabel(agent.host)}
                    {agent.hostname && agent.hostname !== agent.host ? ` · ${agent.hostname}` : ""}
                  </strong>
                </div>
                <div>
                  <span>{tr("工作目录", "Directory")}</span>
                  <code title={agent.cwd}>{agent.cwd}</code>
                </div>
                {agent.rollout?.id && (
                  <div>
                    <span>Session ID</span>
                    <code>{agent.rollout.id}</code>
                  </div>
                )}
              </div>
              <div className="session-drawer-actions">
                <button
                  type="button"
                  className="inline-action"
                  onClick={() => void workspace.copy(agent.cwd, "drawer-cwd")}
                >
                  {workspace.copied === "drawer-cwd" ? <Check size={13} /> : <Copy size={13} />}
                  {tr("复制路径", "Copy path")}
                </button>
                {agent.host !== LOCAL_HOST && (
                  <button
                    type="button"
                    className="inline-action"
                    onClick={() => {
                      onClose();
                      workspace.openWebTerminal();
                    }}
                  >
                    <SquareTerminal size={13} />
                    {tr("SSH 终端", "SSH Terminal")}
                  </button>
                )}
                {agent.rollout?.id && agent.host !== LOCAL_HOST && (
                  <button
                    type="button"
                    className="inline-action"
                    onClick={() =>
                      void workspace.copy(
                        agent.pane ? attachCommand(agent) : resumeInTmuxCommand(agent),
                        "drawer-cmd",
                      )
                    }
                  >
                    {workspace.copied === "drawer-cmd" ? <Check size={13} /> : <Copy size={13} />}
                    {agent.pane
                      ? tr("复制 Attach", "Copy attach")
                      : tr("复制 Resume", "Copy resume")}
                  </button>
                )}
              </div>
            </section>

            <section className="session-drawer-card">
              <h3>
                <MessageSquareText size={14} />
                {tr("连接与会话操作", "Channel & Controls")}
              </h3>
              <p className="session-drawer-note">
                {session
                  ? tr("当前通道：App Server 托管会话", "Channel: Managed App Server")
                  : agent.pane
                    ? tr(`当前通道：tmux (${agent.pane.session})`, `Channel: tmux (${agent.pane.session})`)
                    : workspace.selectedAgentIsExternalTerminal
                      ? tr(`当前通道：外部终端 (${agent.tty || "只读监控"})`, `Channel: External terminal (${agent.tty || "read-only"})`)
                      : tr("当前为历史会话（未接管）", "Historical session (detached)")}
              </p>
              <div className="session-drawer-actions">
                {agent.rollout && (session || agent.pane) && (
                  <button
                    type="button"
                    className="inline-action"
                    disabled={busy === `compact:${key}`}
                    onClick={() => void workspace.compactSession(agent)}
                  >
                    {busy === `compact:${key}` ? (
                      <LoaderCircle size={13} className="is-spinning" />
                    ) : (
                      <Minimize2 size={13} />
                    )}
                    {tr("压缩上下文", "Compact context")}
                  </button>
                )}
                {agent.rollout && !session && (agent.historical || agent.appServerManaged) && (
                  <button
                    type="button"
                    className="inline-action"
                    disabled={
                      (agent.historical && !workspace.selectedRecoveryCwd) ||
                      busy === `app-server:${key}`
                    }
                    onClick={() => void workspace.connectAppServer(agent)}
                  >
                    {busy === `app-server:${key}` ? (
                      <LoaderCircle size={13} className="is-spinning" />
                    ) : (
                      <MessageSquareText size={13} />
                    )}
                    {tr("接入 App Server", "Connect App Server")}
                  </button>
                )}
                {agent.rollout && !agent.pane && agent.host !== LOCAL_HOST && (agent.historical || agent.appServerManaged) && (
                  <button
                    type="button"
                    className="inline-action"
                    disabled={
                      session?.status === "working" ||
                      (agent.historical && !workspace.selectedRecoveryCwd) ||
                      busy === `takeover:${key}`
                    }
                    onClick={() => void workspace.takeoverSession(agent)}
                  >
                    {busy === `takeover:${key}` ? (
                      <LoaderCircle size={13} className="is-spinning" />
                    ) : (
                      <SquareTerminal size={13} />
                    )}
                    {tr("切到 tmux", "Move to tmux")}
                  </button>
                )}
                {agent.rollout && !agent.historical && (() => {
                  const reserved = Boolean(workspace.snapshot.management.sessions[key]?.reserved);
                  return (
                    <button
                      type="button"
                      className={`inline-action ${reserved ? "is-reserved" : ""}`}
                      disabled={busy === `reserve:${key}`}
                      aria-pressed={reserved}
                      onClick={() => void workspace.toggleSessionReserved(agent)}
                      title={tr(
                        "设为保留后不会因超出设备常驻池被自动断开",
                        "Prevent automatic eviction when the host resident pool overflows",
                      )}
                    >
                      {busy === `reserve:${key}` ? (
                        <LoaderCircle size={13} className="is-spinning" />
                      ) : (
                        <Pin size={13} />
                      )}
                      {reserved
                        ? tr("常驻保留中（点击取消）", "Reserved (click to unpin)")
                        : tr("设为常驻保留", "Keep resident")}
                    </button>
                  );
                })()}
                {agent.appServerManaged && (
                  <button
                    type="button"
                    className="inline-action"
                    disabled={
                      session?.status === "offline" ||
                      busy === `close:${key}`
                    }
                    onClick={() => {
                      onClose();
                      void workspace.closeSession(agent);
                    }}
                  >
                    {busy === `close:${key}` ? (
                      <LoaderCircle size={13} className="is-spinning" />
                    ) : (
                      <CirclePause size={13} />
                    )}
                    {tr("断开托管", "Detach session")}
                  </button>
                )}
              </div>
            </section>

            {sessionQuota && (
              <section className="session-drawer-card">
                <h3>
                  <Gauge size={14} />
                  {tr("订阅账号额度", "Subscription Quota")}
                </h3>
                <QuotaMeterCard quota={sessionQuota} compact />
              </section>
            )}

            {(gpus.length > 0 || gpuEpisodes.length > 0 || subagents.length > 0) && (
              <section className="session-drawer-card">
                <h3>
                  <Cpu size={14} />
                  {tr("实时负载与子代理", "Host GPUs & Subagents")}
                </h3>
                {gpus.length > 0 && (
                  <div className="session-drawer-gpus">
                    {gpus.map((gpu) => (
                      <div className="session-drawer-gpu" key={gpu.index}>
                        <span>GPU {gpu.index} · {gpu.name}</span>
                        <small>{gpu.utilization}% · {Math.round(gpu.memoryUsed / 1024)}/{Math.round(gpu.memoryTotal / 1024)} GiB</small>
                      </div>
                    ))}
                  </div>
                )}
                {gpuEpisodes.length > 0 && (
                  <div className="session-drawer-gpus">
                    {gpuEpisodes.slice(0, 4).map((ep) => (
                      <div className="session-drawer-gpu" key={ep.id}>
                        <span>GPU {ep.gpuIndex} · {ep.kind}</span>
                        <small title={ep.command}>{ep.command}</small>
                      </div>
                    ))}
                  </div>
                )}
                {subagents.length > 0 && (
                  <p className="session-drawer-note">
                    {tr(`当前挂载 ${subagents.length} 个子代理`, `${subagents.length} subagent(s) recorded`)}
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
