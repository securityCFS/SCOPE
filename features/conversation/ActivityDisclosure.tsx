"use client";
import { useState } from "react";
import { ChevronDown, LoaderCircle, Terminal, Wrench, Brain, List } from "lucide-react";
import { MarkdownBody } from "@/features/workspace/shared";
import type { DialogueEvent } from "@/features/workspace/types";

export function ActivityDisclosure({
  events,
  active = false,
  host = "",
  cwd = "",
}: {
  events: DialogueEvent[];
  active?: boolean;
  host?: string;
  cwd?: string;
}) {
  const [open, setOpen] = useState(false);
  const last = events.at(-1);
  const commands = events.some(event => event.kind === "command");
  const tools = events.some(event => event.kind === "tool");
  const reasoning = events.some(event => event.kind === "reasoning" || event.category === "reasoning");
  const Icon = commands ? Terminal : tools ? Wrench : reasoning ? Brain : List;
  const label = active
    ? last?.kind === "command"
      ? "正在执行命令"
      : last?.kind === "tool"
        ? "正在使用工具"
        : "正在思考"
    : commands ? "运行了命令" : tools ? "使用了工具" : reasoning ? "思考过程" : "执行记录";
  return (
    <details
      className="conversation-activity"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {active ? <LoaderCircle size={14} className="is-spinning" /> : <Icon size={14} />}
        <span>{label}</span>
        <ChevronDown size={14} />
      </summary>
      {open && (
        <div className="conversation-activity-content">
          {events.map((event) => (
            <div key={event.id} className="conversation-tool">
              <strong>{event.title || event.toolName || "执行记录"}</strong>
              {event.command && (
                <pre>
                  <code>{event.command}</code>
                </pre>
              )}
              <MarkdownBody
                value={event.output || event.text || "暂无输出"}
                remoteHost={host}
                remoteCwd={cwd}
              />
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
