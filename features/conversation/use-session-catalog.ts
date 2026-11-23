"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridgeUrl } from "@/features/workspace/shared";
import type { WorkspaceController } from "@/features/workspace/use-workspace-controller";
import type { ProjectEntry } from "@/components/project-sidebar";
import type { Agent } from "@/features/workspace/types";
import { projectIdentity } from "@/lib/projects";
import { activityTime, recentProjects } from "@/lib/session-activity";

export type CatalogEntry = { phase?: string; historyVersion?: string; key: string; host: string; provider: "codex" | "claude" | "antigravity"; sessionId: string | null; cwd: string; title: string; model: string; status?: string; updatedAt: string | number; managed?: boolean; activeSubagents?: number };
type Scan = { host: string; count?: number; errors: string[]; stale?: boolean };
export async function conversationRequest<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(bridgeUrl(url), body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "请求失败");
  return value;
}

export function useSessionCatalog(workspace: WorkspaceController) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [managed, setManaged] = useState<CatalogEntry[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const etag = useRef("");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [response, jobs] = await Promise.all([
        fetch(bridgeUrl("/api/session-catalog"), { signal, headers: etag.current ? { "If-None-Match": etag.current } : {} }),
        fetch(bridgeUrl("/api/cli-conversations"), { signal }),
      ]);
      if (response.status !== 304) {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || "无法扫描会话");
        etag.current = response.headers.get("etag") || "";
        setEntries(value.entries); setScans(value.scans); setScanning(value.scanning);
      }
      if (!jobs.ok) throw new Error("无法读取网页会话");
      setManaged((await jobs.json()).entries); setError(""); setLoaded(true);
    } catch (cause) { if (!signal?.aborted) setError((cause as Error).message); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => { if (!document.hidden) void refresh(controller.signal); }, scanning ? 2500 : 10_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh, scanning]);
  const combined = useMemo(() => {
    const ids = new Set(managed.filter((entry) => entry.sessionId).map((entry) => JSON.stringify([entry.host, entry.provider, entry.sessionId])));
    const enriched = managed.map(item => { const native = entries.find(entry => entry.host === item.host && entry.provider === item.provider && entry.sessionId === item.sessionId); const activeSubagents = Math.max(item.activeSubagents || 0, native?.activeSubagents || 0); return { ...item, historyVersion: native?.historyVersion, phase: native?.phase || item.phase, activeSubagents }; });
    return [...enriched, ...entries.filter((entry) => !ids.has(entry.key) && !managed.some((item) => item.key === entry.key))];
  }, [entries, managed]);
  const selectedHistory = workspace.selectedAgent?.historical ? workspace.selectedAgent : null;
  const historyUpdate = selectedHistory && entries.find(entry => entry.provider === "codex" && entry.host === selectedHistory.host && entry.sessionId === selectedHistory.rollout?.id);
  const historyActivity = historyUpdate ? activityTime(historyUpdate.updatedAt) : 0;
  const historyId = selectedHistory?.id;
  const setHistoryState = workspace.setHistoryState;
  useEffect(() => {
    if (!historyId || !historyActivity) return;
    setHistoryState(state => {
      const session = state.sessions.find(item => item.id === historyId);
      if (!session?.rollout || (session.rollout.mtimeMs || 0) >= historyActivity) return state;
      return { ...state, sessions: state.sessions.map(item => item.id === historyId ? {
        ...item, lastActivityAt: historyActivity,
        rollout: { ...item.rollout!, mtimeMs: historyActivity, lastEventAt: "" },
      } : item) };
    });
  }, [historyId, historyActivity, setHistoryState]);
  const projects = useMemo(() => {
    const result: ProjectEntry[] = workspace.projects.map((project) => ({ ...project, sessions: project.sessions.map(session => ({ ...session })) }));
    const codexSessions = new Map(result.flatMap(project => project.sessions.filter(session => session.sessionId).map(session => [JSON.stringify([project.host, session.sessionId]), session] as const)));
    for (const entry of combined) {
      if (["archived", "deleted"].includes(entry.phase || "")) continue;
      if (entry.provider === "codex" && workspace.snapshot.management.sessions[`${entry.host}:${entry.sessionId}`]?.archive) continue;
      const matched = entry.provider === "codex" ? codexSessions.get(JSON.stringify([entry.host, entry.sessionId])) : undefined;
      if (matched) { matched.lastActivityAt = Math.max(matched.lastActivityAt || 0, activityTime(entry.updatedAt)); continue; }
      const key = projectIdentity(entry.host, entry.cwd)?.key || JSON.stringify([entry.host, entry.cwd]);
      let project = result.find((item) => item.key === key);
      if (!project) { project = { key, host: entry.host, cwd: entry.cwd, name: entry.cwd ? entry.cwd.split(/[\\/]/).filter(Boolean).at(-1) || entry.cwd : "未记录目录", pinned: false, sessions: [] }; result.push(project); }
      const management = workspace.snapshot.management.sessions[`${entry.host}:${entry.sessionId}`];
      const activeSubagents = entry.activeSubagents || 0;
      const baseStatus = ["running", "launching", "stopping", "finishing"].includes(entry.status || "") ? "working" : ["failed", "unknown", "needs_permission", "waiting_permission"].includes(entry.status || "") ? "attention" : "idle";
      project.sessions.push({ id: entry.key, sessionId: entry.sessionId || "", title: entry.title, category: management?.summary?.category || "other", status: activeSubagents > 0 && baseStatus === "idle" ? "working" : baseStatus, historical: !entry.managed, provider: entry.provider, catalog: true, lastActivityAt: activityTime(entry.updatedAt), reserved: Boolean(management?.reserved), activeSubagents });
    }
    return recentProjects(result);
  }, [workspace.projects, workspace.snapshot.management.sessions, combined]);
  async function select(key: string, isCurrent = () => true) {
    const entry = combined.find((item) => item.key === key);
    if (!entry) { setSelected(null); return false; }
    if (entry.provider !== "codex") { workspace.setHostFilter(entry.host); workspace.setCwdFilter(entry.cwd || "all"); setSelected(entry); workspace.setSelectedAgentId(null); return true; }
    try {
      const { agent } = await conversationRequest<{ agent: Agent }>("/api/session-catalog/select", { key });
      if (!isCurrent()) return false;
      workspace.setHistoryState((value) => ({ ...value, sessions: [...value.sessions.filter((item) => item.id !== agent.id), agent] }));
      workspace.setHostFilter(entry.host); workspace.setCwdFilter(entry.cwd || "all"); workspace.setViewMode(agent.historical ? "history" : "agents");
      workspace.setQuery(""); workspace.setStatusFilter("all"); workspace.setCategoryFilter("all"); workspace.setSelectedAgentId(agent.id); setSelected(null);
    } catch (cause) { if (isCurrent()) workspace.setActionNotice({ kind: "error", text: (cause as Error).message }); return false; }
    return true;
  }
  async function scan() { await conversationRequest("/api/session-catalog/scan", {}); await refresh(); }
  function created(entry: CatalogEntry) { workspace.setHostFilter(entry.host); workspace.setCwdFilter(entry.cwd || "all"); setManaged((value) => [...value.filter((item) => item.key !== entry.key), { ...entry, managed: true }]); setSelected({ ...entry, managed: true }); workspace.setSelectedAgentId(null); void refresh(); }
  const currentSelection = selected ? combined.find(entry => entry.key === selected.key) || selected : null;
  async function archiveNative(key: string, action: string) {
    setArchiveBusy(true);
    try {
      await conversationRequest("/api/cli-conversations/state", { key, action });
      if (selected?.key === key) setSelected(null);
      etag.current = "";
      await refresh();
    } catch (cause) { workspace.setActionNotice({ kind: "error", text: (cause as Error).message }); }
    finally { setArchiveBusy(false); }
  }
  const nativeArchives = combined.filter(entry => ["claude", "antigravity"].includes(entry.provider) && ["archived", "deleted"].includes(entry.phase || ""));
  return { projects, loaded, selected: currentSelection, select, clear: () => setSelected(null), created, scans, scanning, error, scan, refresh, archiveNative, archiveBusy, nativeArchives };
}
