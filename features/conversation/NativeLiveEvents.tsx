"use client";
import { MarkdownBody } from "@/features/workspace/shared";
import "./native-live.css";
export { NativePermissionRequest } from "./NativePermissionRequest";
export type { PermissionRequest } from "./NativePermissionRequest";

export type LiveEvent = { kind: string; at: number; text?: string; name?: string; id?: string; input?: unknown };
export function NativeLiveEvents({ events, partial, host, cwd }: { events: LiveEvent[]; partial?: string; host?: string; cwd?: string }) {
  return <>{events.map((event, index) => {
    if (event.kind === "tool_result") return null;
    if (event.kind === "tool") return <details className="native-tool-event" key={index}>
      <summary>{event.name || "工具调用"}</summary>
      <pre>{JSON.stringify(event.input, null, 2)}</pre>
      {events.filter(item => item.kind === "tool_result" && item.id === event.id).map((item, i) => <pre key={i}>{item.text}</pre>)}
    </details>;
    if (event.kind === "permission") return <p className="native-note" key={index}>{event.text}</p>;
    return <div key={index} className={`native-message ${event.kind === "user" ? "user" : "assistant"}`}>
      {event.kind === "user" && <small>追加消息 · 已接收</small>}<MarkdownBody value={event.text || ""} remoteHost={host} remoteCwd={cwd} />
    </div>;
  })}{partial && <div className="native-message assistant"><MarkdownBody value={partial} remoteHost={host} remoteCwd={cwd} /></div>}</>;
}
