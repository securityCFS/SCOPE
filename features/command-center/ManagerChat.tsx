"use client";
import { CollapsibleUserMessage } from "@/components/collapsible-user-message";
import { MessageCopyButton } from "@/components/message-copy-button";
import { MarkdownBody } from "@/features/workspace/shared";
import { managerPlans } from "@/lib/manager-plan";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  Bot,
  LoaderCircle,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TaskDraft, WorkbenchState } from "./types";
import { ManagerModelPicker } from "./ManagerModelPicker";
import { ManagerSetup } from "./ManagerSetup";
import { ActivityDisclosure } from "@/features/conversation/ActivityDisclosure";
import {
  ComposerAttachmentButton,
  ComposerAttachmentInput,
  ComposerAttachmentList,
  useComposerAttachments,
} from "@/features/conversation/use-composer-attachments";
import { useLocale } from "@/lib/i18n";
import { taskStatus } from "./types";
import type { WorkbenchClient } from "./use-workbench";

export function ManagerChat({
  state,
  busy,
  mutate,
  onSettings,
  onDraft,
  hosts,
}: Pick<WorkbenchClient, "busy" | "mutate"> & {
  state: WorkbenchState;
  hosts: { alias: string; reachable: boolean; defaultCwd?: string }[];
  onSettings: () => void;
  onDraft?: (draft: TaskDraft) => void;
}) {
  const { tr } = useLocale();
  const [draft, setDraft] = useState("");
  const [attachError, setAttachError] = useState("");
  const [setup, setSetup] = useState(false);
  const [sendAfterSetup, setSendAfterSetup] = useState(false);
  const request = useRef({ text: "", id: "" });
  const bottom = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [newBelow, setNewBelow] = useState(false);
  const configured = Boolean(
    state.config.manager.host && state.config.manager.cwd,
  );
  const attach = useComposerAttachments({
    host: configured ? state.config.manager.host : "",
    scope: "manager",
    onError: setAttachError,
  });
  const pending = state.tasks.filter(
    (t) =>
      t.kind === "manager" &&
      ["queued", "starting", "running", "waiting", "unknown"].includes(
        t.status,
      ),
  );
  useEffect(() => {
    if (state.messages.length && follow.current)
      bottom.current?.scrollIntoView({ block: "nearest" });
    else if (state.messages.length) {
      const frame = requestAnimationFrame(() => setNewBelow(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [state.messages.length]);
  async function send(ready = false) {
    const text = draft.trim();
    const hasContent = Boolean(text || attach.readyTokens.length > 0);
    if (!hasContent || attach.hasUnready || (busy && !ready)) return;
    if (!configured && !ready) {
      setSendAfterSetup(true);
      setSetup(true);
      return;
    }
    const sig = JSON.stringify({ text, tokens: attach.readyTokens });
    if (request.current.text !== sig)
      request.current = { text: sig, id: crypto.randomUUID() };
    setAttachError("");
    try {
      await mutate("messages", {
        prompt: text,
        ...(attach.readyTokens.length ? { attachments: attach.readyTokens } : {}),
        requestId: request.current.id,
      });
      setDraft("");
      attach.clear();
      request.current = { text: "", id: "" };
    } catch {
      /* shown by the shared error region */
    }
  }
  return (
    <section className="manager-chat" aria-label="跨项目总调度">
      <header className="center-page-heading">
        <div>
          <span className="center-eyebrow">SCOPE / 总调度</span>
          <h1>总调度</h1>
        </div>
        <button
          className="center-icon-button"
          onClick={onSettings}
          aria-label="配置总调度"
        >
          <SlidersHorizontal size={18} />
        </button>
      </header>
      <div
        className="manager-conversation"
        role="log"
        aria-label="总调度对话"
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            80;
          if (follow.current) setNewBelow(false);
        }}
      >
        {!state.messages.length && (
          <div className="manager-welcome">
            <div className="manager-emblem">
              <Bot size={28} strokeWidth={1.5} />
            </div>
            <h2>多个项目，一个目标。</h2>
            <p>从这里了解进展、梳理下一步，把任务送到合适的主机与 Agent。</p>
            <div className="manager-suggestions">
              {[
                "帮我梳理所有项目的进展和阻塞",
                "看看现有资源，安排下一批任务",
                "我想开始一个新项目，先一起拆解目标",
              ].map((text) => (
                <button key={text} onClick={() => setDraft(text)}>
                  {text}
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          </div>
        )}
        {state.messages.map((message) => (
          <article
            className={`manager-message ${message.role}`}
            key={message.id}
          >
            <span className="message-author">
              {message.role === "user" ? "你" : "SCOPE"}
            </span>
            {message.role === "assistant" &&
              !!state.tasks.find((t) => t.id === message.taskId)?.result
                ?.activity?.length && (
                <ActivityDisclosure
                  events={
                    state.tasks.find((t) => t.id === message.taskId)!.result!
                      .activity!
                  }
                />
              )}
            {message.role === "user" ? (
              <CollapsibleUserMessage value={message.text} surface="panel-2" />
            ) : (
              <MarkdownBody value={message.text} />
            )}
            <MessageCopyButton text={message.text} align="start" />
            {message.role === "assistant" &&
              onDraft && managerPlans(message.text).map((plan, index) => (
                <button
                  className="manager-plan"
                  key={index}
                  onClick={() => onDraft(plan as TaskDraft)}
                >
                  <span>
                    <strong>
                      {plan.host} · {plan.cwd.split("/").pop()}
                    </strong>
                    <small>
                      {plan.provider} · {plan.prompt.slice(0, 90)}
                    </small>
                  </span>
                  <span>
                    查看任务 <ArrowUpRight size={14} />
                  </span>
                </button>
              ))}
          </article>
        ))}
        {pending.map((task) =>
          task.result?.activity?.length ? (
            <ActivityDisclosure
              key={task.id}
              events={task.result.activity}
              active={task.status === "running"}
            />
          ) : (
            <div className="manager-pending" key={task.id}>
              {["unknown", "waiting"].includes(task.status) ? (
                <Bot size={16} />
              ) : (
                <LoaderCircle className="is-spinning" size={16} />
              )}
              <span>
                {taskStatus[task.status]}
                {task.error
                  ? ` · ${task.error}`
                  : task.queueReason
                    ? ` · ${task.queueReason}`
                    : task.status === "running"
                      ? " · 正在思考"
                      : ""}
              </span>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>
      <div className="manager-compose-wrap">
        {newBelow && (
          <button
            className="conversation-stop"
            onClick={() => {
              follow.current = true;
              setNewBelow(false);
              bottom.current?.scrollIntoView({ block: "nearest" });
            }}
          >
            <ArrowDown size={14} />
            回到最新消息
          </button>
        )}
        {!configured && (
          <div className="setup-callout">
            <span>选择运行总调度的主机和目录，即可开始对话。</span>
            <button
              onClick={() => {
                setSendAfterSetup(false);
                setSetup(true);
              }}
            >
              完成设置 <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        {setup && (
          <ManagerSetup
            state={state}
            hosts={hosts}
            busy={busy}
            mutate={mutate}
            sending={sendAfterSetup && Boolean(draft.trim() || attach.readyTokens.length)}
            onCancel={() => setSetup(false)}
            onReady={async () => {
              setSetup(false);
              if (sendAfterSetup) await send(true);
            }}
          />
        )}
        {attachError && (
          <p className="form-error" role="alert">
            {attachError}
          </p>
        )}
        <form
          className="manager-composer"
          onDragOver={attach.onDragOver}
          onDrop={(event) => {
            if (!event.dataTransfer.files.length) return;
            event.preventDefault();
            if (!configured) {
              setSetup(true);
              return;
            }
            setAttachError("");
            attach.onDrop(event);
          }}
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
            onFiles={(files) => {
              setAttachError("");
              return attach.uploadFiles(files);
            }}
          />
          <textarea
            aria-label={tr("发送给总调度", "Message coordinator")}
            rows={3}
            maxLength={16000}
            placeholder={tr(
              "说说你想做什么，或者问问项目现在怎么样…（支持拖拽或粘贴附件）",
              "Ask about project status or plan next steps… (drop or paste files)",
            )}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              if (!event.clipboardData.files.length) return;
              if (!configured) {
                event.preventDefault();
                setSetup(true);
                return;
              }
              setAttachError("");
              attach.onPaste(event);
            }}
            onKeyDown={(event) => {
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
          <div>
            <span>{tr("全部项目", "All projects")}</span>
            <ComposerAttachmentButton
              compact
              uploading={attach.uploading}
              disabled={busy}
              onClick={() => {
                if (!configured) {
                  setSendAfterSetup(false);
                  setSetup(true);
                  return;
                }
                setAttachError("");
                attach.openPicker();
              }}
            />
            <ManagerModelPicker
              state={state}
              busy={busy}
              mutate={mutate}
              hosts={hosts}
              pending={pending.length > 0}
            />
            <button
              className="center-send"
              aria-label={tr("发送消息", "Send message")}
              title={configured ? tr("发送消息", "Send message") : tr("选择运行设备和目录后发送", "Choose host & directory first")}
              disabled={
                busy ||
                (!draft.trim() && attach.attachments.length === 0) ||
                attach.hasUnready
              }
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
        <p className="compose-caption">
          总调度负责分析与规划 · 执行任务进入调度队列 · Shift + Enter 换行
        </p>
      </div>
    </section>
  );
}
