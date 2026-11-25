"use client";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityDisclosure } from "./ActivityDisclosure";
import { CollapsibleUserMessage } from "@/components/collapsible-user-message";
import { MessageCopyButton } from "@/components/message-copy-button";
import { conversationEntries } from "@/lib/conversation";
import { MarkdownBody } from "@/features/workspace/shared";
import type { DialogueEvent, Rollout } from "@/features/workspace/types";
import { useLocale } from "@/lib/i18n";
import { useSubagentDisplayPrefs } from "@/lib/subagent-display-prefs";

const CODEX_SUBAGENT_TOOLS = new Set([
  "spawn_agent",
  "send_message",
  "send_input",
  "wait_agent",
  "close_agent",
]);

function isCodexSubagentInteraction(event: DialogueEvent): boolean {
  return (
    event.category === "subagent" ||
    (event.kind === "tool" && CODEX_SUBAGENT_TOOLS.has(event.toolName || ""))
  );
}

function matchCodexSubagent(
  subagents: Rollout[],
  hint: string,
): Rollout | null {
  if (!hint || !subagents.length) return null;
  const norm = hint.trim().toLowerCase();
  return (
    subagents.find((sub) => {
      const candidates = [
        sub.id,
        sub.agentNickname || "",
        sub.agentPath || "",
        (sub.agentPath || "").split("/").pop() || "",
      ];
      return candidates.some(
        (c) => c && (c.toLowerCase() === norm || c.toLowerCase().includes(norm)),
      );
    }) || null
  );
}

function CodexSubagentInteractionCard({
  event,
  subagents,
  host,
  cwd,
  defaultOpen = false,
  onInspectSubagent,
}: {
  event: DialogueEvent;
  subagents: Rollout[];
  host: string;
  cwd: string;
  defaultOpen?: boolean;
  onInspectSubagent?: (id: string) => void;
}) {
  const { tr } = useLocale();
  const tool = event.toolName || "";
  const isOutbound =
    tool === "spawn_agent" || tool === "send_message" || tool === "send_input";
  let targetHint = event.agentPath || "";
  let bodyText = event.text || event.output || "";
  let encryptedNote = false;

  if (tool && event.text) {
    try {
      const parsed = JSON.parse(event.text) as Record<string, unknown>;
      targetHint = String(
        parsed.target ||
          parsed.task_name ||
          parsed.agent_path ||
          parsed.nickname ||
          parsed.id ||
          targetHint,
      );
      const msg = parsed.message || parsed.input || parsed.prompt;
      if (typeof msg === "string" && msg.trim()) {
        if (msg.startsWith("gAAAAAB") && msg.length > 60) {
          encryptedNote = true;
          bodyText = event.output || "";
        } else {
          bodyText = msg;
        }
      }
    } catch {
      // keep raw text
    }
  }

  const matched = matchCodexSubagent(subagents, targetHint);
  const peerLabel =
    matched?.agentNickname ||
    targetHint ||
    event.title ||
    tr("子代理", "Subagent");
  const badgeLabel =
    tool === "spawn_agent"
      ? tr("主会话 → 新建子代理", "Main → Spawn")
      : isOutbound
        ? tr("主会话 → 子代理", "Main → Subagent")
        : tool === "wait_agent"
          ? tr("等待子代理返回", "Wait subagent")
          : tr("子代理回传 → 主会话", "Subagent → Main");
  const preview = encryptedNote
    ? tr(
        "已加密协作载荷 · 点击右侧“查看工作流”在子代理会话阅读完整明文",
        "Encrypted handoff payload · Click Workflow to read plaintext inside subagent",
      )
    : (bodyText || event.output || "")
        .split(/\r?\n/)
        .find((ln) => ln.trim()) || "";

  return (
    <details
      className={`agent-interaction-card ${isOutbound ? "is-outbound" : "is-inbound"}`}
      open={defaultOpen}
    >
      <summary>
        <span className="agent-interaction-left">
          <span className="agent-interaction-badge">
            {isOutbound ? (
              <ArrowUpRight size={11} />
            ) : (
              <ArrowDownLeft size={11} />
            )}
            {badgeLabel}
          </span>
          <span className="agent-interaction-peer" title={peerLabel}>
            {peerLabel}
          </span>
          {preview && (
            <span className="agent-interaction-preview" title={preview}>
              {preview}
            </span>
          )}
        </span>
        <span className="agent-interaction-right">
          {matched && onInspectSubagent && (
            <button
              type="button"
              className="agent-interaction-jump"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onInspectSubagent(matched.id);
              }}
            >
              {tr("查看工作流", "Workflow")}
              <ChevronRight size={11} />
            </button>
          )}
          <ChevronRight size={13} />
        </span>
      </summary>
      {(bodyText || event.output || encryptedNote) && (
        <div className="agent-interaction-body">
          {encryptedNote && (
            <p className="native-note" style={{ marginTop: 0 }}>
              {tr(
                "Codex 在父会话中加密存储了该条协作消息载荷；点击上方“查看工作流”可直接查看子代理侧的明文指令与执行过程。",
                "Codex encrypted this handoff payload in the parent rollout; click Workflow above to read the plaintext prompt and steps inside the subagent.",
              )}
            </p>
          )}
          {bodyText && (
            <MarkdownBody value={bodyText} remoteHost={host} remoteCwd={cwd} />
          )}
          {event.output && event.output !== bodyText && (
            <pre className="subagent-step-pre" style={{ marginTop: 8 }}>
              {event.output}
            </pre>
          )}
        </div>
      )}
    </details>
  );
}

export function ConversationFeed({
  events,
  host,
  cwd,
  loading,
  error,
  working,
  hasMore,
  loadingMore,
  onOlder,
  onRetry,
  subagents = [],
  onInspectSubagent,
  children,
  sentAt,
}: {
  events: DialogueEvent[];
  host: string;
  cwd: string;
  loading: boolean;
  error: string;
  working: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onOlder: () => Promise<void>;
  onRetry: () => void;
  subagents?: Rollout[];
  onInspectSubagent?: (id: string) => void;
  children?: React.ReactNode;
  sentAt?: number;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const { prefs: subagentPrefs } = useSubagentDisplayPrefs();
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  function toBottom() {
    const element = scroll.current;
    if (element) element.scrollTop = element.scrollHeight;
    follow.current = true;
    setNewBelow(false);
  }
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    if (anchor.current) {
      element.scrollTop =
        anchor.current.top + element.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (follow.current) element.scrollTop = element.scrollHeight;
    else setNewBelow(true);
  }, [events, working]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (follow.current && scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    });
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!sentAt || !scroll.current) return;
    follow.current = true;
    scroll.current.scrollTop = scroll.current.scrollHeight;
    setNewBelow(false);
  }, [sentAt]);
  async function older() {
    const element = scroll.current;
    if (element)
      anchor.current = { height: element.scrollHeight, top: element.scrollTop };
    follow.current = false;
    await onOlder();
    requestAnimationFrame(() => {
      anchor.current = null;
    });
  }
  const entries = conversationEntries(events);
  const activeGroup = working && entries.at(-1)?.type === "activity";
  return (
    <div className="conversation-feed-wrap">
      <div
        className="conversation-feed"
        ref={scroll}
        aria-label="会话消息"
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            80;
          if (follow.current) setNewBelow(false);
        }}
      >
        <div className="conversation-messages" ref={content}>
          {hasMore && (
            <button
              className="conversation-history"
              disabled={loadingMore}
              onClick={() => void older()}
            >
              {loadingMore ? (
                <LoaderCircle size={14} className="is-spinning" />
              ) : (
                <ChevronDown size={14} />
              )}
              加载更早消息
            </button>
          )}
          {loading && !events.length && (
            <p className="conversation-state">
              <LoaderCircle size={16} className="is-spinning" />
              正在读取对话…
            </p>
          )}
          {!loading && !error && !events.length && (
            <div className="conversation-intro">
              <h2>从这里继续。</h2>
              <p>发送一条消息，开始这个项目的工作。</p>
            </div>
          )}
          {entries.map((entry, index) => {
            if (entry.type === "message") {
              return (
                <Message
                  key={entry.id}
                  event={entry.event as DialogueEvent}
                  host={host}
                  cwd={cwd}
                />
              );
            }
            const segments: Array<
              | { kind: "interaction"; event: DialogueEvent }
              | { kind: "activity"; events: DialogueEvent[] }
            > = [];
            for (const ev of entry.events as DialogueEvent[]) {
              if (isCodexSubagentInteraction(ev)) {
                segments.push({ kind: "interaction", event: ev });
              } else {
                const prev = segments.at(-1);
                if (prev?.kind === "activity") prev.events.push(ev);
                else segments.push({ kind: "activity", events: [ev] });
              }
            }
            return segments.map((seg, segIdx) =>
              seg.kind === "interaction" ? (
                subagentPrefs.showInteractions ? (
                  <CodexSubagentInteractionCard
                    key={`${seg.event.id}:${subagentPrefs.autoExpandInteractions ? "1" : "0"}`}
                    event={seg.event}
                    subagents={subagents}
                    host={host}
                    cwd={cwd}
                    defaultOpen={subagentPrefs.autoExpandInteractions}
                    onInspectSubagent={onInspectSubagent}
                  />
                ) : null
              ) : (
                <ActivityDisclosure
                  key={`${entry.id}:${segIdx}`}
                  events={seg.events}
                  active={
                    working &&
                    index === entries.length - 1 &&
                    segIdx === segments.length - 1
                  }
                  host={host}
                  cwd={cwd}
                />
              ),
            );
          })}
          {error && (
            <div className="conversation-error" role="alert">
              <span>{error}</span>
              <button onClick={onRetry}>重新读取</button>
            </div>
          )}
          {working && !activeGroup && (
            <div className="conversation-working" role="status">
              <LoaderCircle size={15} className="is-spinning" />
              正在思考
            </div>
          )}
          {children}
        </div>
      </div>
      {newBelow && (
        <button className="conversation-jump" onClick={toBottom}>
          <ArrowDown size={14} />
          回到最新消息
        </button>
      )}
    </div>
  );
}

function Message({
  event,
  host,
  cwd,
}: {
  event: DialogueEvent;
  host: string;
  cwd: string;
}) {
  const progress = event.kind === "assistant" && event.phase === "commentary";
  return (
    <article className={`conversation-message message-${event.kind}${progress ? " message-progress" : ""}`}>
      {event.kind !== "user" && !progress && (
        <span className="conversation-author">
          {event.kind === "error" ? "执行遇到问题" : "Codex"}
        </span>
      )}
      <div className="conversation-message-body">
        {event.kind === "user" ? (
          <CollapsibleUserMessage
            value={event.text}
            remoteHost={host}
            remoteCwd={cwd}
            surface="panel-2"
          />
        ) : (
          <MarkdownBody value={event.text} remoteHost={host} remoteCwd={cwd} />
        )}
      </div>
      {!progress && (
        <MessageCopyButton
          text={event.text}
          title={event.timestamp || undefined}
          align={event.kind === "user" ? "end" : "start"}
        />
      )}
    </article>
  );
}
