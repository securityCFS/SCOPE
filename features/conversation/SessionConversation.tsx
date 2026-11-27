"use client";
import { LOCAL_HOST, hostLabel } from "@/lib/execution-host";
import { useMemo, useState } from "react";
import { Bot, Info, LoaderCircle, MessageSquare, Pin, Plus, Square } from "lucide-react";
import { SubagentWorkflowDrawer } from "@/components/subagent-workflow-drawer";
import { PortForwardsPopover } from "@/components/port-forwards-popover";
import {
  CodexSubagentsCard,
  toCodexDrawerItems,
} from "@/features/workspace/CodexSubagentsPanel";
import { HumanRequests } from "@/features/workspace/HumanRequests";
import { SessionComposer } from "@/features/workspace/SessionComposer";
import { useCodexSubagentWorkflow } from "@/features/workspace/use-codex-subagent-workflow";
import { ComposerControls } from "./ComposerControls";
import { bridgeUrl, managementKey } from "@/features/workspace/shared";
import type { WorkspaceController } from "@/features/workspace/use-workspace-controller";
import { useLocale } from "@/lib/i18n";
import { useSubagentDisplayPrefs } from "@/lib/subagent-display-prefs";
import { ConversationFeed } from "./ConversationFeed";

export function SessionConversation({
  workspace,
  onTools,
  openSubagent,
  onOpenSubagent,
}: {
  workspace: WorkspaceController;
  onTools: () => void;
  openSubagent?: { open: boolean; id: string | null };
  onOpenSubagent?: (next: { open: boolean; id: string | null } | null) => void;
}) {
  const { tr } = useLocale();
  const { prefs: subagentPrefs } = useSubagentDisplayPrefs();
  const [stopping, setStopping] = useState(false);
  const [localSubagent, setLocalSubagent] = useState<{
    open: boolean;
    id: string | null;
  } | null>(null);
  const {
    selectedAgent: agent,
    selectedDialogue: dialogue,
    selectedAppServerSession: session,
    selectedProject: project,
  } = workspace;
  const subagents = useMemo(() => agent?.subagents || [], [agent?.subagents]);
  const drawerState =
    openSubagent !== undefined ? openSubagent : localSubagent;
  const isDrawerOpen = Boolean(drawerState?.open);
  const activeSubagentId = isDrawerOpen ? drawerState?.id ?? null : null;
  const setDrawerState = onOpenSubagent || setLocalSubagent;
  const codexWorkflow = useCodexSubagentWorkflow(
    agent?.host || "",
    agent?.rollout?.id || "",
    subagents,
    activeSubagentId,
  );
  const codexDrawerItems = useMemo(
    () => toCodexDrawerItems(subagents),
    [subagents],
  );
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
          {subagentPrefs.showHeaderBadge && subagents.length > 0 && (
            <button
              type="button"
              className="session-info-trigger"
              onClick={() =>
                setDrawerState({
                  open: true,
                  id: subagents.length === 1 ? subagents[0].id : null,
                })
              }
              title={tr("查看本会话所有 Codex 子代理与工作流", "View all Codex subagents and workflows")}
            >
              <Bot size={14} />
              <span>
                {tr(`子代理 · ${subagents.length}`, `Subagents · ${subagents.length}`)}
              </span>
            </button>
          )}
          <PortForwardsPopover
            host={agent.host}
            cwd={agent.cwd}
            allowLocal={Boolean(
              workspace.snapshot.hosts.find((item) => item.alias === LOCAL_HOST)
                ?.nativeCliSupported,
            )}
          />
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
        subagents={subagents}
        onInspectSubagent={(id) => setDrawerState({ open: true, id })}
      >
        {subagentPrefs.showInlineCards && (
          <CodexSubagentsCard
            subagents={subagents}
            onInspect={(sub) => setDrawerState({ open: true, id: sub.id })}
          />
        )}
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
            ? tr("Enter 发送 · Shift + Enter 换行", "Enter to send · Shift + Enter for newline")
            : agent.pane
              ? tr("消息发送到当前终端 · Enter 发送", "Send to active terminal · Enter to send")
              : workspace.selectedAgentIsExternalTerminal
                ? tr("正在监控原终端会话 · 请在原终端输入", "Watching external terminal · Reply in original terminal")
                : tr("恢复会话后即可继续对话", "Resume session to continue chatting")}
        </p>
      </div>
      <SubagentWorkflowDrawer
        open={isDrawerOpen}
        providerLabel="Codex"
        items={codexDrawerItems}
        totalSubagents={codexDrawerItems.length}
        selectedId={activeSubagentId}
        onSelect={(id) => setDrawerState({ open: true, id })}
        onClose={() => setDrawerState(null)}
        onRefresh={codexWorkflow.refresh}
        onLoadMore={codexWorkflow.loadMore}
        loading={codexWorkflow.loading}
        error={codexWorkflow.error}
        steps={codexWorkflow.steps}
        hasMore={codexWorkflow.hasMore}
        host={agent.host}
        cwd={agent.cwd}
        activeStatus={codexWorkflow.status}
        activeModel={codexWorkflow.model}
        activeTypeName={codexWorkflow.selected?.agentRole || ""}
        activeRole={
          codexWorkflow.selected?.agentNickname ||
          codexWorkflow.selected?.agentPath ||
          ""
        }
      />
    </section>
  );
}
