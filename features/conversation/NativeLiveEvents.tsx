"use client";
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react";
import { CollapsibleUserMessage } from "@/components/collapsible-user-message";
import { MessageCopyButton } from "@/components/message-copy-button";
import { MarkdownBody } from "@/features/workspace/shared";
import { useLocale } from "@/lib/i18n";
import { useSubagentDisplayPrefs } from "@/lib/subagent-display-prefs";
import type { NativeSubagent } from "./use-native-history";
import "./native-live.css";
export { NativePermissionRequest } from "./NativePermissionRequest";
export type { PermissionRequest } from "./NativePermissionRequest";

export type LiveEvent = {
  kind: string;
  at: number;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
};

function extractAgentIdFromResult(text?: string): string {
  if (!text) return "";
  const m = text.match(/agentId:\s*([a-zA-Z0-9_-]+)/);
  if (!m) return "";
  return m[1].startsWith("agent-") ? m[1] : `agent-${m[1]}`;
}

export function NativeLiveEvents({
  events,
  partial,
  host,
  cwd,
  subagents = [],
  canInspectSubagent = false,
  onInspectSubagent,
}: {
  events: LiveEvent[];
  partial?: string;
  host?: string;
  cwd?: string;
  subagents?: NativeSubagent[];
  canInspectSubagent?: boolean;
  onInspectSubagent?: (subagentId: string) => void;
}) {
  const { tr } = useLocale();
  const { prefs } = useSubagentDisplayPrefs();
  return (
    <>
      {events.map((event, index) => {
        if (event.kind === "tool_result") return null;
        if (event.kind === "tool") {
          const inp =
            event.input && typeof event.input === "object"
              ? (event.input as Record<string, unknown>)
              : null;
          const results = events.filter(
            (item) => item.kind === "tool_result" && item.id === event.id,
          );
          const resultText = results.map((r) => r.text || "").join("\n");

          if (event.name === "Agent" || event.name === "Task") {
            if (!prefs.showInteractions) return null;
            const desc = String(
              inp?.name || inp?.description || tr("子代理", "Subagent"),
            );
            const prompt = String(inp?.prompt || "");
            const matched = subagents.find(
              (s) =>
                (event.id && s.toolUseId === event.id) ||
                (event.id && s.id === event.id) ||
                s.role === desc,
            );
            const jumpId =
              matched?.agentId ||
              matched?.id ||
              extractAgentIdFromResult(resultText) ||
              event.id ||
              "";
            return (
              <details
                className="agent-interaction-card is-outbound"
                key={`${index}:${prefs.autoExpandInteractions ? "1" : "0"}`}
                open={prefs.autoExpandInteractions}
              >
                <summary>
                  <span className="agent-interaction-left">
                    <span className="agent-interaction-badge">
                      <ArrowUpRight size={11} />
                      {tr("主会话 → 新建子代理", "Main → Spawn")}
                    </span>
                    <span className="agent-interaction-peer" title={desc}>
                      {desc}
                    </span>
                    {prompt && (
                      <span className="agent-interaction-preview" title={prompt}>
                        {prompt.split(/\r?\n/)[0]}
                      </span>
                    )}
                  </span>
                  <span className="agent-interaction-right">
                    {canInspectSubagent && jumpId && onInspectSubagent && (
                      <button
                        type="button"
                        className="agent-interaction-jump"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onInspectSubagent(jumpId);
                        }}
                      >
                        {tr("查看工作流", "Workflow")}
                        <ChevronRight size={11} />
                      </button>
                    )}
                    <ChevronRight size={13} />
                  </span>
                </summary>
                {prompt && (
                  <div className="agent-interaction-body">
                    <MarkdownBody
                      value={prompt}
                      remoteHost={host}
                      remoteCwd={cwd}
                    />
                  </div>
                )}
              </details>
            );
          }

          if (event.name === "SendMessage") {
            if (!prefs.showInteractions) return null;
            const to = String(inp?.to || inp?.recipient || "");
            const summary = String(inp?.summary || "");
            const body = String(inp?.message || inp?.content || "");
            return (
              <details
                className="agent-interaction-card is-outbound"
                key={`${index}:${prefs.autoExpandInteractions ? "1" : "0"}`}
                open={prefs.autoExpandInteractions}
              >
                <summary>
                  <span className="agent-interaction-left">
                    <span className="agent-interaction-badge">
                      <ArrowUpRight size={11} />
                      {tr("主会话 → 协作消息", "Main → Agent")}
                    </span>
                    {to && (
                      <span className="agent-interaction-peer" title={to}>
                        {to}
                      </span>
                    )}
                    <span className="agent-interaction-preview">
                      {summary || body.split(/\r?\n/)[0]}
                    </span>
                  </span>
                  <span className="agent-interaction-right">
                    <ChevronRight size={13} />
                  </span>
                </summary>
                {body && (
                  <div className="agent-interaction-body">
                    <MarkdownBody
                      value={body}
                      remoteHost={host}
                      remoteCwd={cwd}
                    />
                  </div>
                )}
              </details>
            );
          }

          if (event.name === "SubagentHandback") {
            if (!prefs.showInteractions) return null;
            const report = String(
              inp?.message ||
                inp?.report ||
                inp?.result ||
                inp?.summary ||
                "",
            ).trim();
            const firstLine =
              report.split(/\r?\n/).find((ln) => ln.trim()) || "";
            return (
              <details
                className="agent-interaction-card is-inbound"
                key={`${index}:${prefs.autoExpandInteractions ? "1" : "0"}`}
                open={prefs.autoExpandInteractions}
              >
                <summary>
                  <span className="agent-interaction-left">
                    <span className="agent-interaction-badge">
                      <ArrowDownLeft size={11} />
                      {tr("子代理回传 → 主会话", "Subagent → Main")}
                    </span>
                    {firstLine && (
                      <span
                        className="agent-interaction-preview"
                        title={firstLine}
                      >
                        {firstLine}
                      </span>
                    )}
                  </span>
                  <span className="agent-interaction-right">
                    <ChevronRight size={13} />
                  </span>
                </summary>
                {report && (
                  <div className="agent-interaction-body">
                    <MarkdownBody
                      value={report}
                      remoteHost={host}
                      remoteCwd={cwd}
                    />
                  </div>
                )}
              </details>
            );
          }

          return (
            <details className="native-tool-event" key={index}>
              <summary>{event.name || "工具调用"}</summary>
              <pre>{JSON.stringify(event.input, null, 2)}</pre>
              {results.map((item, i) => (
                <pre key={i}>{item.text}</pre>
              ))}
            </details>
          );
        }
        if (event.kind === "permission")
          return (
            <p className="native-note" key={index}>
              {event.text}
            </p>
          );
        return (
          <div
            key={index}
            className={`native-message-block ${event.kind === "user" ? "is-user" : "is-assistant"}`}
          >
            <div
              className={`native-message ${event.kind === "user" ? "user" : "assistant"}`}
            >
              {event.kind === "user" && <small>追加消息 · 已接收</small>}
              {event.kind === "user" ? (
                <CollapsibleUserMessage
                  value={event.text || ""}
                  remoteHost={host}
                  remoteCwd={cwd}
                  surface="hover"
                />
              ) : (
                <MarkdownBody
                  value={event.text || ""}
                  remoteHost={host}
                  remoteCwd={cwd}
                />
              )}
            </div>
            {event.text && (
              <MessageCopyButton
                text={event.text}
                align={event.kind === "user" ? "end" : "start"}
              />
            )}
          </div>
        );
      })}
      {partial && (
        <div className="native-message assistant">
          <MarkdownBody value={partial} remoteHost={host} remoteCwd={cwd} />
        </div>
      )}
    </>
  );
}
