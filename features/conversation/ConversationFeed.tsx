"use client";
import {
  ArrowDown,
  Check,
  ChevronDown,
  Copy,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityDisclosure } from "./ActivityDisclosure";
import { conversationEntries } from "@/lib/conversation";
import { MarkdownBody } from "@/features/workspace/shared";
import type { DialogueEvent } from "@/features/workspace/types";

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
  children?: React.ReactNode;
  sentAt?: number;
}) {
  const scroll = useRef<HTMLDivElement>(null);
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
          {entries.map((entry, index) =>
            entry.type === "message" ? (
              <Message
                key={entry.id}
                event={entry.event as DialogueEvent}
                host={host}
                cwd={cwd}
              />
            ) : (
              <ActivityDisclosure
                key={entry.id}
                events={entry.events}
                active={working && index === entries.length - 1}
                host={host}
                cwd={cwd}
              />
            ),
          )}
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
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const progress = event.kind === "assistant" && event.phase === "commentary";
  return (
    <article className={`conversation-message message-${event.kind}${progress ? " message-progress" : ""}`}>
      {event.kind !== "user" && !progress && (
        <span className="conversation-author">
          {event.kind === "error" ? "执行遇到问题" : "Codex"}
        </span>
      )}
      <div className="conversation-message-body">
        <MarkdownBody value={event.text} remoteHost={host} remoteCwd={cwd} />
      </div>
      {!progress && <div className="conversation-message-actions">
        <button
          aria-label="复制消息"
          title={event.timestamp || "复制消息"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(event.text);
              setCopied(true);
              setCopyError(false);
            } catch {
              setCopyError(true);
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied && "已复制"}
        </button>
        {copyError && <small role="status">复制失败，请选中文本复制</small>}
      </div>}
    </article>
  );
}
