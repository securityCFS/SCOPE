"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bot, ChevronRight, KeyRound, LoaderCircle, Lock, RefreshCw, Square } from "lucide-react";
import { visibleSpoolTurns } from "@/lib/native-history";
import { useNativeHistory, type NativeSubagent } from "./use-native-history";
import { InlineTaskSubagentGroup, NativeHistoryView } from "./NativeHistoryView";
import { useNativeScroll } from "./use-native-scroll";
import { NativeModelControl } from "./NativeModelControl";
import { NativeElicitation } from "./NativeElicitation";
import { useSlashCommands } from "./use-slash-commands";
import { useClaudeSubagentWorkflow } from "./use-claude-subagent-workflow";
import { SubagentWorkflowDrawer } from "@/components/subagent-workflow-drawer";
import { CollapsibleUserMessage } from "@/components/collapsible-user-message";
import { MessageCopyButton } from "@/components/message-copy-button";
import { PortForwardsPopover } from "@/components/port-forwards-popover";
import {
  ComposerAttachmentButton,
  ComposerAttachmentInput,
  ComposerAttachmentList,
  useComposerAttachments,
} from "./use-composer-attachments";
import { useLocale } from "@/lib/i18n";
import { useSubagentDisplayPrefs } from "@/lib/subagent-display-prefs";
import {
  NativePermissionControl,
  type NativePermission,
} from "./NativePermissionControl";
import { AgentLogo } from "@/components/agent-logo";
import { QuotaInlineBadge } from "@/components/quota-meter";
import { bridgeUrl, MarkdownBody } from "@/features/workspace/shared";
import type {
  AccountQuota,
  ProviderAuthStatusesResponse,
} from "@/features/workspace/types";
import { LOCAL_HOST, hostLabel } from "@/lib/execution-host";
import { conversationRequest, type CatalogEntry } from "./use-session-catalog";

import { NativeLiveEvents, NativePermissionRequest, type LiveEvent, type PermissionRequest } from "./NativeLiveEvents";

const ACTIVE = ["launching", "running", "unknown", "waiting_permission", "stopping", "finishing"];
type Turn = {
  events?: LiveEvent[];
  subagents?: NativeSubagent[];
  partial?: string;
  truncated?: boolean;
  createdAt?: number;
  id: string;
  prompt: string;
  text: string;
  error?: string;
  errorCode?: string;
  status: string;
};
type Conversation = CatalogEntry & {
  commands?: {name:string;description?:string}[];
  turns: Turn[];
  subagents?: NativeSubagent[];
  interactive?: boolean;
  permissions?: PermissionRequest[];
  controlResults?: { id: string; status: string; error?: string }[];
  status: string;
  permissionMode?: NativePermission;
  effort?: string;
};

function mergeNativeSubagents(
  historySubs: NativeSubagent[] = [],
  liveSubs: NativeSubagent[] = [],
  preferLive: boolean,
): NativeSubagent[] {
  const byKey = new Map<string, NativeSubagent>();
  const keyFor = (item: NativeSubagent) => item.toolUseId || item.id;
  const ordered = preferLive
    ? [...historySubs, ...liveSubs]
    : [...liveSubs, ...historySubs];
  for (const item of ordered) {
    if (!item?.id) continue;
    const key = keyFor(item);
    const prev = byKey.get(key) || byKey.get(item.id);
    if (!prev) {
      byKey.set(key, item);
      continue;
    }
    const prevAt = prev.updatedAt || 0;
    const nextAt = item.updatedAt || 0;
    const prevWorking = prev.status === "working";
    const nextWorking = item.status === "working";
    const newer = nextAt > prevAt || (nextAt === prevAt && prevWorking && !nextWorking);
    const merged: NativeSubagent = newer
      ? {
          ...prev,
          ...item,
          agentId: item.agentId || prev.agentId,
          toolUseId: item.toolUseId || prev.toolUseId,
          model: item.model || prev.model,
          spawnDepth: item.spawnDepth ?? prev.spawnDepth,
          steps: item.steps?.length ? item.steps : prev.steps,
          partial: item.partial || prev.partial,
          hasWorkflow: Boolean(item.hasWorkflow || prev.hasWorkflow),
        }
      : {
          ...item,
          ...prev,
          agentId: prev.agentId || item.agentId,
          toolUseId: prev.toolUseId || item.toolUseId,
          model: prev.model || item.model,
          spawnDepth: prev.spawnDepth ?? item.spawnDepth,
          steps: prev.steps?.length ? prev.steps : item.steps,
          partial: prev.partial || item.partial,
          hasWorkflow: Boolean(prev.hasWorkflow || item.hasWorkflow),
        };
    byKey.set(key, merged);
  }
  return Array.from(byKey.values());
}

function NativeSubagentsPanel({
  subagents,
  totalCount,
  canInspect,
  onInspect,
  onOpenDirectory,
}: {
  subagents: NativeSubagent[];
  totalCount?: number;
  canInspect: boolean;
  onInspect: (subagent: NativeSubagent) => void;
  onOpenDirectory?: () => void;
}) {
  const { tr } = useLocale();
  if (!subagents.length) return null;
  const total = Math.max(totalCount || 0, subagents.length);
  const statusLabels: Record<string, string> = {
    working: tr("工作中", "Working"),
    completed: tr("已完成", "Done"),
    failed: tr("失败", "Failed"),
    stopped: tr("已停止", "Stopped"),
  };
  const workingList = subagents.filter((item) => item.status === "working");
  const finishedCount = subagents.length - workingList.length;
  const body = (
    <div className="native-subagents-list">
      {subagents.map((item) => {
        const inner = (
          <>
            <div className="native-subagent-meta">
              <span className={`native-subagent-badge is-${item.status || "working"}`}>
                {item.status === "working" ? (
                  <LoaderCircle size={11} className="is-spinning" />
                ) : (
                  <Bot size={11} />
                )}
                {statusLabels[item.status] || item.status}
              </span>
              <strong title={item.role}>{item.role}</strong>
              {item.typeName && <small>{item.typeName}</small>}
              {item.model && <small>{item.model}</small>}
            </div>
            <span className="native-subagent-right">
              {item.lastAction && (
                <span className="native-subagent-action" title={item.lastAction}>
                  {item.lastAction}
                </span>
              )}
              {canInspect && <ChevronRight size={13} />}
            </span>
          </>
        );
        return canInspect ? (
          <button
            type="button"
            className="native-subagent-row"
            key={item.id}
            onClick={() => onInspect(item)}
            title={tr("点击查看子代理实际工作流", "Inspect subagent workflow")}
          >
            {inner}
          </button>
        ) : (
          <div className="native-subagent-row" key={item.id}>
            {inner}
          </div>
        );
      })}
    </div>
  );

  if (workingList.length > 0) {
    return (
      <section
        className="native-subagents-card is-working"
        aria-label={tr("后台子代理状态", "Background subagents")}
      >
        <div className="native-subagents-head">
          <LoaderCircle size={13} className="is-spinning" />
          <strong>
            {tr(
              `后台子代理工作中 · ${workingList.length} 个运行中`,
              `Background subagents working · ${workingList.length} active`,
            )}
          </strong>
          {finishedCount > 0 && (
            <span>
              {tr(` · ${finishedCount} 个已完成`, ` · ${finishedCount} done`)}
            </span>
          )}
        </div>
        {body}
      </section>
    );
  }
  return (
    <details className="native-subagents-card">
      <summary className="native-subagents-head">
        <Bot size={13} />
        <span>
          {total > subagents.length
            ? tr(
                `本会话共新建 ${total} 个子代理（展开最近 ${subagents.length} 个）`,
                `${total} subagents created in this session (showing latest ${subagents.length})`,
              )
            : tr(
                `本会话子代理 · ${subagents.length} 个已完成`,
                `Session subagents · ${subagents.length} completed`,
              )}
        </span>
      </summary>
      {body}
      {canInspect && onOpenDirectory && total > subagents.length && (
        <button
          type="button"
          className="native-task-subagents-more"
          onClick={onOpenDirectory}
        >
          {tr(`在右侧总览查看全部 ${total} 个子代理 →`, `Browse all ${total} subagents in drawer →`)}
        </button>
      )}
    </details>
  );
}

export function NativeConversation({
  entry,
  onChanged,
  onAccounts,
}: {
  entry: CatalogEntry;
  onChanged: () => void;
  onAccounts?: () => void;
}) {
  const [conversation, setConversation] = useState<Conversation | null>(null);

  const [pendingControl, setPendingControl] = useState<{ id: string; prompt?: string } | null>(null);
  const pendingControlRef = useRef<{ id: string; prompt?: string } | null>(null);
  const [readError, setReadError] = useState("");
  const [controlBusy, setControlBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(entry.model || "");
  const [effort, setEffort] = useState("");
  const [autoSupported, setAutoSupported] = useState<boolean | null>(null);
  const [permissionMode, setPermissionMode] =
    useState<NativePermission>(entry.provider === "claude" ? "auto" : "default");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(Boolean(entry.managed));
  const [openSubagent, setOpenSubagent] = useState<{
    entryKey: string;
    id: string | null;
  } | null>(null);
  const composer = useRef<HTMLFormElement>(null);
  const { tr } = useLocale();
  const { prefs: subagentPrefs } = useSubagentDisplayPrefs();
  const attach = useComposerAttachments({
    host: entry.host,
    scope: entry.key,
    onError: setError,
  });
  const slash = useSlashCommands({provider:entry.provider,host:entry.host,cwd:entry.cwd,sessionId:entry.sessionId,
    draft,setDraft,disabled:entry.host === LOCAL_HOST,liveCommands:conversation?.commands,
    onLocal: name => {
      if (name === "stop") { void control("stop"); return; }
      const button = composer.current?.querySelector<HTMLButtonElement>(name === "permissions" ? '.native-permission-control button' : '.native-model-trigger');
      if (button?.disabled) setError("本轮结束后可调整下一轮的模型、强度和权限。");
      else button?.click();
    }});
  const working =
    sending ||
    ACTIVE.includes(conversation?.status || "");
  function reconcileControl(value: Conversation) {
    const pendingControl = pendingControlRef.current;
    if (!pendingControl) return;
    const receipt = value.controlResults?.find(item => item.id === pendingControl.id);
    if (receipt) {
      if (receipt.status === "rejected") { setError(receipt.error || "操作未接收"); if (pendingControl.prompt) setDraft(pendingControl.prompt); }
      pendingControlRef.current = null; setPendingControl(null);
    } else if (!ACTIVE.includes(value.status)) {
      setError("本轮已结束，控制请求未确认，请核对后重试");
      if (pendingControl.prompt) setDraft(pendingControl.prompt);
      pendingControlRef.current = null; setPendingControl(null);
    }
  }
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const value = await conversationRequest<Conversation>(
          `/api/cli-conversations?key=${encodeURIComponent(entry.key)}`,
        );
        if (active) {
          setConversation(value);
          if (!conversation) {
            setPermissionMode(value.permissionMode || (entry.provider === "claude" ? "auto" : "default"));
            setModel(value.model || "");
            setEffort(value.effort || "");
          }
          setReadError("");
          reconcileControl(value);
          if (ACTIVE.includes(value.status))
            timer = setTimeout(read, 3000);
          else onChanged();
        }
      } catch (cause) {
        if (active && (entry.managed || conversation)) {
          setReadError((cause as Error).message);
          timer = setTimeout(read, 5000);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    if (entry.managed || conversation) void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // A new submitted turn starts polling. Parent refresh callbacks need not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.key, entry.managed, conversation?.turns.length]);
  const nativeHistory = useNativeHistory(
    entry,
    conversation?.sessionId,
    conversation?.status,
  );
  const subagents = useMemo(
    () =>
      mergeNativeSubagents(
        nativeHistory.history?.subagents || [],
        conversation?.subagents || conversation?.turns.at(-1)?.subagents || [],
        working,
      ),
    [
      nativeHistory.history?.subagents,
      conversation?.subagents,
      conversation?.turns,
      working,
    ],
  );
  const workingSubagentsCount = useMemo(
    () => subagents.filter((item) => item.status === "working").length,
    [subagents],
  );
  const totalSubagentsCount = Math.max(
    nativeHistory.history?.totalSubagents || 0,
    subagents.length,
  );
  const isLocalReadOnly = entry.host === LOCAL_HOST;
  const externalLock = nativeHistory.history
    ? nativeHistory.history.externalLock || null
    : entry.externalLock || null;
  const isExternalLocked =
    Boolean(externalLock?.locked) && !working && !isLocalReadOnly;
  const isComposerReadOnly = isLocalReadOnly || isExternalLocked;
  const resolvedSessionId = conversation?.sessionId || entry.sessionId;
  const resolvedCatalogKey =
    (entry.provider === "claude" || entry.provider === "antigravity") &&
    resolvedSessionId
      ? JSON.stringify([entry.host, entry.provider, resolvedSessionId])
      : entry.key;
  const isDrawerOpen =
    openSubagent?.entryKey === entry.key && entry.provider === "claude";
  const activeSubagentId = isDrawerOpen ? openSubagent.id : null;
  const claudeWorkflow = useClaudeSubagentWorkflow(
    resolvedCatalogKey,
    entry.provider,
    subagents,
    activeSubagentId,
  );
  const subagentDrawerItems = useMemo(
    () =>
      subagents.map((item) => ({
        id: item.id,
        label: item.role || item.id,
        role: item.role,
        typeName: item.typeName,
        model: item.model,
        spawnDepth: item.spawnDepth,
        status: item.status,
        lastAction: item.lastAction,
        taskTitle: item.taskTitle,
        updatedAt: item.updatedAt,
      })),
    [subagents],
  );
  const refreshNativeHistory = nativeHistory.refresh;
  useEffect(() => {
    if (
      working ||
      (workingSubagentsCount === 0 && !isExternalLocked) ||
      !nativeHistory.available
    ) {
      return;
    }
    const timer = setInterval(() => {
      if (!document.hidden) void refreshNativeHistory();
    }, 4000);
    return () => clearInterval(timer);
  }, [
    working,
    workingSubagentsCount,
    isExternalLocked,
    nativeHistory.available,
    refreshNativeHistory,
  ]);
  const { scroll, content, onScroll, toBottom, older, atBottom } = useNativeScroll({
    history: nativeHistory.history,
    turns: conversation?.turns,
    ready:
      !loading &&
      (!nativeHistory.available ||
        Boolean(nativeHistory.history || nativeHistory.error)),
    working,
  });
  async function control(action: string, values: Record<string, unknown> = {}) {
    if (controlBusy || pendingControl) return false;
    setControlBusy(true); setError("");
    const id = crypto.randomUUID();
    try {
      await conversationRequest("/api/cli-conversations/control", { key: entry.key, id, action, ...values });
      pendingControlRef.current = { id, prompt: action === "message" ? String(values.prompt) : undefined };
      setPendingControl(pendingControlRef.current);
      return true;
    } catch (cause) { setError((cause as Error).message); return false; }
    finally { setControlBusy(false); }
  }
  const canControl = conversation?.interactive && ["running", "waiting_permission"].includes(conversation.status);
  async function send() {
    if (slash.handleLocal()) return;
    const hasContent = Boolean(draft.trim() || attach.readyTokens.length > 0);
    if (!hasContent || attach.hasUnready || controlBusy || pendingControl || (working && !canControl) || isComposerReadOnly || !entry.cwd)
      return;
    if (working && canControl) {
      if (await control("message", { prompt: draft, attachments: attach.readyTokens })) {
        setDraft("");
        attach.clear();
      }
      return;
    }
    setSending(true);
    setError("");
    try {
      const result = await conversationRequest<Conversation>(
        "/api/cli-conversations/send",
        {
          key: entry.key,
          prompt: draft,
          attachments: attach.readyTokens,
          model,
          effort,
          permissionMode,
        },
      );
      setConversation(result);
      toBottom();
      setDraft("");
      attach.clear();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSending(false);
    }
  }
  const [providerQuotaState, setProviderQuotaState] = useState<{
    key: string;
    quota: AccountQuota | null;
  } | null>(null);
  const quotaScopeKey = !isLocalReadOnly ? `${entry.host}:${entry.provider}` : "";
  useEffect(() => {
    if (!quotaScopeKey) return;
    const controller = new AbortController();
    fetch(
      bridgeUrl(`/api/auth/providers?host=${encodeURIComponent(entry.host)}`),
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as ProviderAuthStatusesResponse;
        if (controller.signal.aborted) return;
        const nextQuota =
          entry.provider === "claude"
            ? data.claude?.quota || null
            : data.antigravity?.quota || null;
        setProviderQuotaState({ key: quotaScopeKey, quota: nextQuota });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [entry.host, entry.provider, quotaScopeKey]);
  const providerQuota =
    providerQuotaState?.key === quotaScopeKey ? providerQuotaState.quota : null;
  const providerName = entry.provider === "claude" ? "Claude" : "Antigravity";
  return (
    <section className="session-conversation native-conversation">
      <header className="conversation-header">
        <div>
          <strong title={entry.title}>
            <AgentLogo provider={entry.provider} />
            <span>{entry.title || `${providerName} 会话`}</span>
          </strong>
          <small
            title={`${hostLabel(entry.host)} · ${entry.cwd || "未记录工作目录"}`}
          >
            {hostLabel(entry.host)} · {entry.cwd || "未记录工作目录"}
            {isLocalReadOnly
              ? " · 本机只读"
              : isExternalLocked
                ? tr(
                    ` · 外部终端 (${externalLock?.tty || (externalLock?.pid ? `PID ${externalLock.pid}` : "只读")}) · 持续监控`,
                    ` · External terminal (${externalLock?.tty || (externalLock?.pid ? `PID ${externalLock.pid}` : "read-only")}) · Watching`,
                  )
                : ""}
          </small>
        </div>
        {(isExternalLocked ||
          !isLocalReadOnly ||
          (subagentPrefs.showHeaderBadge &&
            entry.provider === "claude" &&
            totalSubagentsCount > 0) ||
          (onAccounts && !isLocalReadOnly)) && (
          <div className="conversation-header-actions">
            {isExternalLocked && (
              <span
                className="native-lock-pill"
                title={
                  externalLock?.reason ||
                  tr("外部终端占用锁定，只读监控中", "Locked by external terminal (read-only)")
                }
              >
                <Lock size={12} />
                {tr(
                  externalLock?.tty
                    ? `终端锁定 · ${externalLock.tty}`
                    : "外部终端锁定",
                  externalLock?.tty
                    ? `Terminal lock · ${externalLock.tty}`
                    : "Terminal locked",
                )}
              </span>
            )}
            {!isLocalReadOnly && (
              <PortForwardsPopover host={entry.host} cwd={entry.cwd} />
            )}
            {subagentPrefs.showHeaderBadge &&
              entry.provider === "claude" &&
              totalSubagentsCount > 0 && (
              <button
                type="button"
                className="session-info-trigger"
                onClick={() =>
                  setOpenSubagent({
                    entryKey: entry.key,
                    id: subagents.length === 1 ? subagents[0].id : null,
                  })
                }
                title={tr(
                  "查看本会话所有子代理与实际工作流",
                  "View all subagents and inspect workflows",
                )}
              >
                <Bot size={14} />
                <span>
                  {tr(
                    `子代理 · ${totalSubagentsCount}`,
                    `Subagents · ${totalSubagentsCount}`,
                  )}
                </span>
              </button>
            )}
            {onAccounts && !isLocalReadOnly && (
              <button
                type="button"
                className="session-info-trigger"
                onClick={onAccounts}
              >
                <KeyRound size={14} />
                <span>{tr("账号管理", "Accounts")}</span>
                <QuotaInlineBadge quota={providerQuota} />
              </button>
            )}
          </div>
        )}
      </header>
      <div className="native-messages-wrap">
        <div
          className="native-messages"
          ref={scroll}
          onScroll={onScroll}
          aria-label="会话消息"
        >
        <div ref={content}>
          {loading && <p className="native-note">正在读取会话…</p>}
          <NativeHistoryView
            host={entry.host}
            cwd={entry.cwd}
            canInspectSubagent={entry.provider === "claude"}
            onInspectSubagent={(item) =>
              setOpenSubagent({
                entryKey: entry.key,
                id: item.agentId || item.id,
              })
            }
            value={{
              ...nativeHistory,
              earlier: () => older(nativeHistory.earlier),
            }}
          />
          {visibleSpoolTurns(
            nativeHistory.history?.messages || [],
            conversation?.turns || [],
          ).map((turn) => (
              <div className="native-turn" key={turn.id}>
                <div className="native-message-block is-user">
                  <div className="native-message user">
                    <CollapsibleUserMessage
                      value={turn.prompt}
                      remoteHost={entry.host}
                      remoteCwd={entry.cwd}
                      surface="hover"
                    />
                  </div>
                  <MessageCopyButton text={turn.prompt} align="end" />
                </div>
                {turn.truncated && <p className="native-note">过程记录较长，仅显示最近部分；完整记录保留在原生会话中。</p>}
                <NativeLiveEvents
                  events={turn.events || []}
                  partial={turn.partial}
                  host={entry.host}
                  cwd={entry.cwd}
                  subagents={subagents}
                  canInspectSubagent={entry.provider === "claude"}
                  onInspectSubagent={(subId) =>
                    setOpenSubagent({ entryKey: entry.key, id: subId })
                  }
                />
                {subagentPrefs.showInlineCards &&
                  turn.subagents &&
                  turn.subagents.length > 0 && (
                  <InlineTaskSubagentGroup
                    subagents={turn.subagents}
                    canInspect={entry.provider === "claude"}
                    onInspect={(item) =>
                      setOpenSubagent({
                        entryKey: entry.key,
                        id: item.agentId || item.id,
                      })
                    }
                  />
                )}
                {turn.status === "stopped" && <p className="native-note">已停止，保留已产生的消息和操作记录。</p>}
                {turn.text && !turn.events?.some(event => event.kind === "assistant") && (
                  <div className="native-message-block is-assistant">
                    <div className="native-message assistant">
                      <MarkdownBody value={turn.text} remoteHost={entry.host} remoteCwd={entry.cwd} />
                    </div>
                    <MessageCopyButton text={turn.text} align="start" />
                  </div>
                )}
                {turn.error && (
                  <div className="form-error native-error" role="alert">
                    {turn.error}
                    {(turn.errorCode === "permission_required" ||
                      turn.error.includes("操作需要权限")) && (
                      <div className="native-permission-help">
                        <p>
                          上轮已结束。可在下方调整下一轮权限，再发送继续请求；不会自动重跑上一轮。
                        </p>
                        <button
                          type="button"
                          disabled={working || isLocalReadOnly}
                          onClick={() =>
                            setDraft(
                              "请继续上一轮未完成的工作，先确认已完成的步骤，避免重复操作。",
                            )
                          }
                        >
                          填入继续请求
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          {conversation?.permissions?.map(request => request.kind === "acp-form"
            ? <NativeElicitation key={request.id} fields={request.fields || []} message={request.description} disabled={controlBusy || Boolean(pendingControl) || !canControl}
              respond={(decision, content) => void control("permission", { requestId: request.id, decision, content })} />
            : <NativePermissionRequest key={request.id} request={request} provider={providerName} disabled={controlBusy || Boolean(pendingControl) || !canControl}
              respond={(decision, answers, optionId) => void control("permission", { requestId: request.id, decision, answers, optionId })} />)}
          {subagentPrefs.showInlineCards &&
            (workingSubagentsCount > 0 ||
            (subagents.length > 0 &&
              !nativeHistory.history?.messages?.some(
                (m) => m.role === "subagent_group",
              ))) && (
            <NativeSubagentsPanel
              subagents={
                workingSubagentsCount > 0
                  ? subagents.filter((item) => item.status === "working")
                  : subagents.slice(0, 6)
              }
              totalCount={totalSubagentsCount}
              canInspect={entry.provider === "claude"}
              onInspect={(item) =>
                setOpenSubagent({
                  entryKey: entry.key,
                  id: item.agentId || item.id,
                })
              }
              onOpenDirectory={() =>
                setOpenSubagent({ entryKey: entry.key, id: null })
              }
            />
          )}
          {working && (
            <details className="native-thinking">
              <summary>
                <LoaderCircle size={14} className="is-spinning" />
                <span>
                  {conversation?.status === "unknown"
                    ? tr("正在确认远端状态…", "Checking remote status…")
                    : conversation?.status === "waiting_permission"
                      ? tr("等待你的审批或回答…", "Waiting for your approval or reply…")
                      : conversation?.status === "stopping"
                        ? tr("正在停止…", "Stopping…")
                        : tr("正在执行本轮任务…", "Running current turn…")}
                </span>
                <small>
                  {conversation?.interactive
                    ? tr("过程消息持续更新", "Live streaming updates")
                    : tr("完成后返回", "Returns on completion")}
                </small>
              </summary>
              <p>
                {conversation?.interactive ? "可追加消息，当前一轮结束后接着处理；权限请求会在这里等待你的决定。离开页面不会自动批准或停止任务。" : "此任务完成后返回完整回复；离开页面不会中断远端任务。"}
              </p>
            </details>
          )}
          {(error || readError) && (
            <p className="form-error native-error" role="alert">
              {error || readError}
            </p>
          )}
        </div>
      </div>
      {!atBottom && (
        <button type="button" className="conversation-jump" onClick={toBottom}>
          <ArrowDown size={14} />
          {tr("回到最新消息", "Jump to latest")}
        </button>
      )}
    </div>
    <div className="native-compose-wrap">
        {isExternalLocked && (
          <div className="native-lock-banner" role="status">
            <div className="native-lock-banner-main">
              <Lock size={14} />
              <span>
                {tr(
                  `该 ${providerName} 会话当前正由外部终端（${externalLock?.inTmux ? `tmux ${externalLock.tty || ""}` : externalLock?.tty || "非 tmux 终端"}${externalLock?.pid ? ` · PID ${externalLock.pid}` : ""}）占用，已只读锁定并每 4 秒自动同步。请先正常退出原终端后再由 SCOPE 接管发送。`,
                  `This ${providerName} session is locked by an external terminal (${externalLock?.inTmux ? `tmux ${externalLock.tty || ""}` : externalLock?.tty || "non-tmux"}${externalLock?.pid ? ` · PID ${externalLock.pid}` : ""}). Read-only live monitoring every 4s — exit the original terminal to take over here.`,
                )}
              </span>
            </div>
            <button
              type="button"
              className="native-lock-banner-btn"
              disabled={nativeHistory.busy}
              onClick={() => void nativeHistory.refresh()}
            >
              <RefreshCw
                size={12}
                className={nativeHistory.busy ? "is-spinning" : ""}
              />
              {tr("检查解锁", "Check status")}
            </button>
          </div>
        )}
        <form
          ref={composer}
          className="native-composer"
          onDragOver={attach.onDragOver}
          onDrop={attach.onDrop}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <ComposerAttachmentList
            attachments={attach.attachments}
            onRemove={attach.remove}
          />
          <ComposerAttachmentInput
            inputRef={attach.inputRef}
            onFiles={attach.uploadFiles}
          />
          {slash.panel}
          <textarea
            {...slash.inputProps}
            aria-label={tr("发送消息", "Send message")}
            placeholder={
              isLocalReadOnly
                ? tr("本机历史记录仅支持只读查看", "Local history is read-only")
                : isExternalLocked
                  ? tr(
                      "原外部终端占用中（只读锁定）· 请在原终端继续或退出后接管",
                      "Locked by external terminal (read-only) · Reply in original terminal or exit it to take over",
                    )
                  : !entry.cwd
                    ? tr("缺少工作目录，暂无法继续发送", "Working directory is required")
                    : tr("继续对话…（支持拖拽或粘贴附件）", "Continue conversation… (drop or paste files)")
            }
            rows={2}
            disabled={isComposerReadOnly || !entry.cwd}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={attach.onPaste}
            onKeyDown={(event) => {
              if (slash.onKeyDown(event)) return;
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <footer>
            <span className="native-provider-badge" title={providerName}>
              <AgentLogo provider={entry.provider} />
              <span>{providerName}</span>
            </span>
            <ComposerAttachmentButton
              compact
              uploading={attach.uploading}
              disabled={isComposerReadOnly || !entry.cwd || (working && !canControl)}
              onClick={attach.openPicker}
            />
            <NativePermissionControl autoSupported={autoSupported}
              provider={entry.provider}
              compact
              value={permissionMode}
              onChange={setPermissionMode}
              disabled={working || isComposerReadOnly}
            />
            <NativeModelControl onAutoSupportChange={setAutoSupported}
              effort={effort}
              onEffortChange={setEffort}
              compact
              host={entry.host}
              provider={entry.provider}
              value={model}
              onChange={setModel}
              disabled={working || isComposerReadOnly}
            />
            {canControl && <button className="native-stop" type="button" aria-label={`停止 ${providerName}`} title="停止当前 SCOPE 任务" disabled={controlBusy || Boolean(pendingControl)} onClick={() => void control("stop")}><Square size={14} /></button>}
            <button
              type="submit"
              aria-label={tr("发送消息", "Send message")}
              disabled={
                (working && !canControl) ||
                controlBusy ||
                Boolean(pendingControl) ||
                (!draft.trim() && attach.attachments.length === 0) ||
                attach.hasUnready ||
                isComposerReadOnly ||
                !entry.cwd
              }
            >
              <ArrowUp size={16} />
            </button>
          </footer>
        </form>
        <p className="native-note">
          {isLocalReadOnly
            ? tr(
                "本机历史只读 · 新建 Claude / Antigravity 会话请选择远程设备",
                "Local history is read-only · Choose a remote host for new Claude / Antigravity sessions",
              )
            : isExternalLocked
              ? tr(
                  "正在只读监控外部终端会话 · 原终端退出后自动解锁发送",
                  "Watching external terminal session (read-only) · Unlocks automatically after terminal exits",
                )
              : tr(
                  `${permissionMode === "full" ? "完全访问 · 跳过权限审批 · " : ""}Enter 发送 · Shift + Enter 换行${working && !conversation?.interactive ? " · 回复在本轮结束后显示" : ""}`,
                  `${permissionMode === "full" ? "Full access · Skipping approvals · " : ""}Enter to send · Shift + Enter for newline${working && !conversation?.interactive ? " · Reply displays after turn finishes" : ""}`,
                )}
        </p>
      </div>
      <SubagentWorkflowDrawer
        open={isDrawerOpen}
        providerLabel="Claude Code"
        items={subagentDrawerItems}
        totalSubagents={totalSubagentsCount}
        selectedId={activeSubagentId}
        onSelect={(id) => setOpenSubagent({ entryKey: entry.key, id })}
        onClose={() => setOpenSubagent(null)}
        onRefresh={claudeWorkflow.refresh}
        loading={claudeWorkflow.loading}
        error={claudeWorkflow.error}
        steps={claudeWorkflow.steps}
        partial={claudeWorkflow.partial}
        totalSteps={claudeWorkflow.totalSteps}
        truncated={claudeWorkflow.truncated}
        host={entry.host}
        cwd={entry.cwd}
        activeStatus={claudeWorkflow.status}
        activeModel={claudeWorkflow.model}
        activeTypeName={claudeWorkflow.typeName}
        activeSpawnDepth={claudeWorkflow.spawnDepth}
        activeRole={claudeWorkflow.role}
      />
    </section>
  );
}
