"use client";
import { hostLabel } from "@/lib/execution-host";
import { useState } from "react";
import { Info, LoaderCircle, MessageSquare, Pin, Plus, Square } from "lucide-react";
import { HumanRequests } from "@/features/workspace/HumanRequests";
import { SessionComposer } from "@/features/workspace/SessionComposer";
import { ComposerControls } from "./ComposerControls";
import { bridgeUrl, managementKey } from "@/features/workspace/shared";
import type { WorkspaceController } from "@/features/workspace/use-workspace-controller";
import { useLocale } from "@/lib/i18n";
import { ConversationFeed } from "./ConversationFeed";

export function SessionConversation({
  workspace,
  onTools,
}: {
  workspace: WorkspaceController;
  onTools: () => void;
}) {
  const { tr } = useLocale();
  const [stopping, setStopping] = useState(false);
  const {
    selectedAgent: agent,
    selectedDialogue: dialogue,
    selectedAppServerSession: session,
    selectedProject: project,
  } = workspace;
  const working =
    agent?.status === "working" ||
    session?.status === "working" ||
    Boolean(
      agent && workspace.pendingInstruction?.key === managementKey(agent),
    );
  async function stop() {
    if (!agent?.rollout || stopping) return;
    setStopping(true);
    try {
      const response = await fetch(bridgeUrl("/api/session/interrupt"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host: agent.host, sessionId: agent.rollout.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "停止失败");
      workspace.setPendingInstruction(null);
      workspace.setActionNotice({
        kind: "success",
        text: "已停止生成，可以继续发送消息。",
      });
      workspace.setDialogueRefresh((value) => value + 1);
    } catch (error) {
      workspace.setActionNotice({
        kind: "error",
        text: (error as Error).message,
      });
    } finally {
      setStopping(false);
    }
  }
  if (!agent)
    return (
      <section className="session-conversation conversation-empty">
        <header className="conversation-header">
          <strong>{project?.name || tr("项目会话", "Project Sessions")}</strong>
        </header>
        <div className="conversation-start">
          <MessageSquare size={30} strokeWidth={1.4} />
          <h1>
            {project
              ? tr(`在 ${project.name} 开始工作`, `Work in ${project.name}`)
              : tr("继续你的工作。", "Continue your work.")}
          </h1>
          <p>{tr("从左侧选择一段对话，或新建一个会话。", "Select a conversation on the left, or start a new session.")}</p>
          <button
            className="center-primary"
            onClick={() => workspace.openNewTask(project || undefined)}
          >
            <Plus size={16} />
            {tr("新建会话", "New session")}
          </button>
        </div>
      </section>
    );
  return (
    <section className="session-conversation" aria-label={tr("项目对话", "Project conversation")}>
      <header className="conversation-header">
        <div>
          <h1>{workspace.selectedSummary?.theme || agent.title || tr("新会话", "New session")}</h1>
          <small title={agent.cwd}>
            {project?.name || agent.cwd.split("/").pop()} · {hostLabel(agent.host)}
            {workspace.selectedAgentIsExternalTerminal ? tr(" · 外部终端 · 持续监控", " · External terminal · Read-only") : ""}
          </small>
        </div>
        <div className="conversation-header-actions">
          {agent.rollout && !agent.historical && (() => {
            const key = managementKey(agent);
            const reserved = Boolean(workspace.snapshot.management.sessions[key]?.reserved);
            const reserveBusy = workspace.busyAction === `reserve:${key}`;
            return (
              <button
                type="button"
                className={`session-reserve-trigger ${reserved ? "active" : ""}`}
                disabled={reserveBusy}
                aria-pressed={reserved}
                onClick={() => void workspace.toggleSessionReserved(agent)}
                title={tr(
                  "设为保留后不会因超出设备常驻池而被自动释放（适合带 Timer 或长期等待的会话）",
                  "Reserved sessions stay pinned when the host resident pool overflows",
                )}
              >
                {reserveBusy ? (
                  <LoaderCircle size={13} className="is-spinning" />
                ) : (
                  <Pin size={13} />
                )}
                <span>{reserved ? tr("常驻保留", "Reserved") : tr("设为保留", "Pin")}</span>
              </button>
            );
          })()}
          <button
            type="button"
            className="session-info-trigger"
            onClick={onTools}
            aria-label={tr("会话信息", "Session info")}
          >
            <Info size={14} />
            <span>{tr("会话信息", "Session info")}</span>
          </button>
        </div>
      </header>
      <ConversationFeed
        sentAt={
          workspace.pendingInstruction?.key === managementKey(agent)
            ? workspace.pendingInstruction.sentAt
            : undefined
        }
        key={managementKey(agent)}
        events={dialogue?.events || []}
        host={agent.host}
        cwd={agent.cwd}
        loading={workspace.selectedDialoguePending}
        error={workspace.selectedDialogueError}
        working={working && !workspace.selectedHumanRequests.length}
        hasMore={Boolean(dialogue?.hasMore)}
        loadingMore={workspace.dialogueLoadingMore}
        onOlder={workspace.loadOlderDialogue}
        onRetry={() => workspace.setDialogueRefresh((value) => value + 1)}
      >
        <HumanRequests {...workspace} />
      </ConversationFeed>
      <div className="conversation-bottom">
        {working && session && (
          <button
            className="conversation-stop"
            disabled={stopping}
            onClick={() => void stop()}
          >
            <Square size={12} />
            {stopping ? "正在停止…" : "停止生成"}
          </button>
        )}
        <SessionComposer
          {...workspace}
          conversation
          onCommand={name => { if (name === "stop") void stop(); else if (name === "compact") void workspace.compactSession(agent); }}
          controls={<ComposerControls workspace={workspace} />}
        />
        <p className="conversation-caption">
          {session
            ? "Enter 发送 · Shift + Enter 换行"
            : agent.pane
              ? "消息发送到当前终端 · Enter 发送"
              : workspace.selectedAgentIsExternalTerminal
                ? "正在监控原终端会话 · 请在原终端输入"
                : "恢复会话后即可继续对话"}
        </p>
      </div>
    </section>
  );
}
