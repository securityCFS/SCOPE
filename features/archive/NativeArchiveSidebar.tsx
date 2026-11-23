"use client";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { AgentLogo } from "@/components/agent-logo";
import type { CatalogEntry } from "@/features/conversation/use-session-catalog";

export function NativeArchiveSidebar({ entries, busy, onChange }: {
  entries: CatalogEntry[]; busy: boolean; onChange: (key: string, action: string) => Promise<void>;
}) {
  if (!entries.length) return null;
  return <section className="archive-sidebar"><details><summary>Agent 归档与回收站 <span>{entries.length}</span></summary>
    <p className="archive-empty">仅整理 SCOPE 列表，保留远端 Agent 原生历史。</p>
    {entries.map(entry => <div className="sidebar-history-row" key={entry.key}>
      <AgentLogo provider={entry.provider} /><div className="sidebar-history-title"><span title={entry.title}>{entry.title}</span><small>{entry.phase === "deleted" ? "回收站" : "已归档"} · {entry.host}</small></div>
      <button type="button" className="sidebar-archive-action" disabled={busy} aria-label={`恢复 ${entry.title}`} onClick={() => void onChange(entry.key, "restore")}><ArchiveRestore size={14} /></button>
      {entry.phase !== "deleted" && <button type="button" className="sidebar-archive-action" disabled={busy} aria-label={`删除到回收站 ${entry.title}`} onClick={() => void onChange(entry.key, "delete")}><Trash2 size={14} /></button>}
    </div>)}
  </details></section>;
}
