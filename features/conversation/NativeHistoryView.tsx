"use client";
import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Bot,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { CollapsibleUserMessage } from "@/components/collapsible-user-message";
import { MessageCopyButton } from "@/components/message-copy-button";
import { MarkdownBody } from "@/features/workspace/shared";
import { useLocale } from "@/lib/i18n";
import { useSubagentDisplayPrefs } from "@/lib/subagent-display-prefs";
import type {
  NativeHistoryMessage,
  NativeSubagent,
  useNativeHistory,
} from "./use-native-history";

export function InlineTaskSubagentGroup({
  subagents,
  canInspect,
  onInspect,
}: {
  subagents: NativeSubagent[];
  canInspect: boolean;
  onInspect?: (subagent: NativeSubagent) => void;
}) {
  const { tr } = useLocale();
  const [expanded, setExpanded] = useState(false);
  if (!subagents.length) return null;
  const workingCount = subagents.filter((s) => s.status === "working").length;
  const doneCount = subagents.length - workingCount;
  const visible = expanded ? subagents : subagents.slice(0, 5);
  const hiddenCount = subagents.length - visible.length;
  const statusLabels: Record<string, string> = {
    working: tr("工作中", "Working"),
    completed: tr("已完成", "Done"),
    failed: tr("失败", "Failed"),
    stopped: tr("已停止", "Stopped"),
  };

  return (
    <div
      className={`native-task-subagents${workingCount > 0 ? " is-working" : ""}`}
    >
      <div className="native-task-subagents-head">
        <span className="native-task-subagents-title">
          {workingCount > 0 ? (
            <LoaderCircle size={13} className="is-spinning" />
          ) : (
            <Bot size={13} />
          )}
          {tr(
            `当前任务新建了 ${subagents.length} 个子代理`,
            `Spawned ${subagents.length} subagent${subagents.length > 1 ? "s" : ""} for this task`,
          )}
        </span>
        <span className="native-task-subagents-count">
          {workingCount > 0
            ? tr(
                `${workingCount} 工作中 · ${doneCount} 已完成`,
                `${workingCount} active · ${doneCount} done`,
              )
            : tr(`${doneCount} 已完成`, `${doneCount} completed`)}
        </span>
      </div>
      <div className="native-task-subagents-list">
        {visible.map((item) => {
          const statusLabel = statusLabels[item.status] || item.status;
          const showLastAction = Boolean(
            item.lastAction && item.lastAction.trim() !== statusLabel,
          );
          const inner = (
            <>
              <div className="native-subagent-stack">
                <div className="native-subagent-meta">
                  <span
                    className={`native-subagent-badge is-${item.status || "completed"}`}
                  >
                    {item.status === "working" ? (
                      <LoaderCircle size={11} className="is-spinning" />
                    ) : (
                      <Bot size={11} />
                    )}
                    {statusLabel}
                  </span>
                  <strong title={item.role}>{item.role}</strong>
                  {item.typeName && <small>{item.typeName}</small>}
                  {item.model && <small>{item.model}</small>}
                </div>
                {item.promptPreview && (
                  <span
                    className="native-subagent-prompt"
                    title={item.promptPreview}
                  >
                    {tr("派发指令：", "Prompt: ")}
                    {item.promptPreview.split(/\r?\n/)[0]}
                  </span>
                )}
              </div>
              <span className="native-subagent-right">
                {showLastAction && (
                  <span className="native-subagent-action" title={item.lastAction}>
                    {item.lastAction}
                  </span>
                )}
                {canInspect && <ChevronRight size={13} />}
              </span>
            </>
          );
          return canInspect && onInspect ? (
            <button
              type="button"
              className="native-subagent-row"
              key={item.toolUseId || item.id}
              onClick={() => onInspect(item)}
              title={tr("点击查看该子代理完整工作流", "Inspect subagent workflow")}
            >
              {inner}
            </button>
          ) : (
            <div className="native-subagent-row" key={item.toolUseId || item.id}>
              {inner}
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          className="native-task-subagents-more"
          onClick={() => setExpanded(true)}
        >
          {tr(`展开其余 ${hiddenCount} 个子代理`, `Show ${hiddenCount} more subagents`)}
        </button>
      )}
    </div>
  );
}

function AgentInteractionCard({
  message,
  host,
  cwd,
  canInspect,
  defaultOpen = false,
  onInspectSubagent,
}: {
  message: NativeHistoryMessage;
  host?: string;
  cwd?: string;
  canInspect: boolean;
  defaultOpen?: boolean;
  onInspectSubagent?: (subagent: NativeSubagent) => void;
}) {
  const { tr } = useLocale();
  const isOutbound = message.direction === "outbound";
  const isNotif = message.interactionKind === "notification";
  const isHandback = message.interactionKind === "handback";
  const variant = isNotif
    ? "is-notification"
    : isOutbound
      ? "is-outbound"
      : "is-inbound";

  const badgeLabel = isNotif
    ? tr("后台任务通知", "Background task")
    : isOutbound
      ? tr("主会话 → 协作消息", "Main → Agent")
      : isHandback
        ? tr("子代理回传 → 主会话", "Subagent → Main")
        : tr("收到协作消息", "Agent → Main");

  const peerLabel = message.peerName || message.peerId || "";
  const preview =
    message.summary ||
    (message.text || "").split(/\r?\n/).find((ln) => ln.trim()) ||
    "";
  const canJump = Boolean(
    message.subagentId && canInspect && onInspectSubagent,
  );

  return (
    <details
      className={`agent-interaction-card ${variant}`}
      open={defaultOpen}
    >
      <summary>
        <span className="agent-interaction-badge">
          {isNotif ? (
            <Bell size={11} />
          ) : isOutbound ? (
            <ArrowUpRight size={11} />
          ) : (
            <ArrowDownLeft size={11} />
          )}
          {badgeLabel}
        </span>
        <span className="agent-interaction-copy">
          {peerLabel && (
            <span className="agent-interaction-peer" title={peerLabel}>
              {peerLabel}
            </span>
          )}
          {preview && (
            <span className="agent-interaction-preview" title={preview}>
              {preview}
            </span>
          )}
        </span>
        <span className="agent-interaction-right">
          {canJump && (
            <button
              type="button"
              className="agent-interaction-jump"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onInspectSubagent?.({
                  id: message.subagentId!,
                  agentId: message.subagentId!,
                  role: peerLabel || message.subagentId!,
                  status: message.status || "completed",
                });
              }}
            >
              {tr("查看工作流", "Workflow")}
              <ChevronRight size={11} />
            </button>
          )}
          <ChevronRight size={13} />
        </span>
      </summary>
      {message.text && (
        <div className="agent-interaction-body">
          <MarkdownBody
            value={message.text}
            remoteHost={host}
            remoteCwd={cwd}
          />
        </div>
      )}
    </details>
  );
}

export function NativeHistoryView({
  value,
  host,
  cwd,
  canInspectSubagent = false,
  onInspectSubagent,
}: {
  value: ReturnType<typeof useNativeHistory>;
  host?: string;
  cwd?: string;
  canInspectSubagent?: boolean;
  onInspectSubagent?: (subagent: NativeSubagent) => void;
}) {
  const { history, busy, error, earlier, refresh } = value;
  const { prefs } = useSubagentDisplayPrefs();
  return (
    <>
      <div className="native-history-actions">
        {history?.nextBefore != null && (
          <button type="button" disabled={busy} onClick={() => void earlier()}>
            加载较早记录
          </button>
        )}
        <button
          type="button"
          disabled={busy || !value.available}
          onClick={() => void refresh()}
        >
          {busy ? "同步历史…" : "刷新历史"}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          历史同步失败：{error}
        </p>
      )}
      {history?.reset && (
        <p className="native-note">远端记录已变化，已重新载入最新历史。</p>
      )}
      {history?.summaryOnly && (
        <div className="native-note native-summary-card">
          <strong>历史摘要</strong>
          <p>{history.summary}</p>
          <small>
            {history.reason || "此会话尚无可读取的文本历史"}
            。继续发送仍沿用原会话。
          </small>
        </div>
      )}
      {history?.limited && (
        <p className="native-note">
          部分记录过长、已被上游截断或尚未写完，当前显示可读取的内容。
        </p>
      )}
      {history?.messages.map((message, index) => (
        <div key={`${message.id || index}:${message.role}`}>
          {message.role === "subagent_group" && message.subagents?.length ? (
            prefs.showInlineCards ? (
              <InlineTaskSubagentGroup
                subagents={message.subagents}
                canInspect={canInspectSubagent}
                onInspect={onInspectSubagent}
              />
            ) : null
          ) : message.role === "agent_interaction" ? (
            prefs.showInteractions ? (
              <AgentInteractionCard
                key={`${message.id || index}:${prefs.autoExpandInteractions ? "1" : "0"}`}
                message={message}
                host={host}
                cwd={cwd}
                canInspect={canInspectSubagent}
                defaultOpen={prefs.autoExpandInteractions}
                onInspectSubagent={onInspectSubagent}
              />
            ) : null
          ) : message.role === "activity" ? (
            <details className="native-history-activity">
              <summary>{message.title || "工具记录"}</summary>
              <pre>{message.text}</pre>
            </details>
          ) : (
            message.text && (
              <div
                className={`native-message-block ${message.role === "user" ? "is-user" : "is-assistant"}`}
              >
                <div className={`native-message ${message.role}`}>
                  {message.role === "user" ? (
                    <CollapsibleUserMessage
                      value={message.text}
                      remoteHost={host}
                      remoteCwd={cwd}
                      surface="hover"
                    />
                  ) : (
                    <MarkdownBody
                      value={message.text}
                      remoteHost={host}
                      remoteCwd={cwd}
                    />
                  )}
                </div>
                <MessageCopyButton
                  text={message.text}
                  align={message.role === "user" ? "end" : "start"}
                />
              </div>
            )
          )}
          {message.activity && (
            <details className="native-history-activity">
              <summary>{message.title || "工具调用"}</summary>
              <pre>{message.activity}</pre>
            </details>
          )}
        </div>
      ))}
    </>
  );
}
