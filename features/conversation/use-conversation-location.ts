"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Hydrate browser-only storage after SSR and reconcile it with asynchronous host inventory. */
import { useEffect, useRef, useState } from "react";
import type { Section } from "@/features/command-center/types";
import type { WorkspaceController } from "@/features/workspace/use-workspace-controller";
import type { useSessionCatalog } from "./use-session-catalog";
import { CONVERSATION_LOCATION_KEY, findConversationLocation, readConversationLocation } from "@/lib/conversation-location";

type Options = {
  workspace: WorkspaceController; catalog: ReturnType<typeof useSessionCatalog>;
  section: Section; setSection: (section: Section) => void;
  projectHost: string; setProjectHost: (host: string) => void;
};

export function useConversationLocation(options: Options) {
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<ReturnType<typeof readConversationLocation>>(null);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const restoring = useRef(false);
  const { workspace, catalog, section, projectHost } = options;

  useEffect(() => {
    let saved = null;
    try { saved = readConversationLocation(sessionStorage.getItem(CONVERSATION_LOCATION_KEY)); } catch { /* Storage may be disabled. */ }
    if (saved) {
      latest.current.setSection(saved.section as Section);
      latest.current.setProjectHost(saved.projectHost);
      if (saved.section === "projects") {
        if (saved.session || (saved.host !== "all" && saved.cwd !== "all")) setPending(saved);
        else {
          latest.current.workspace.setHostFilter(saved.host);
          latest.current.workspace.setCwdFilter(saved.cwd);
        }
      }
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!pending || restoring.current) return;
    if (workspace.bridgeState !== "connected" || !catalog.loaded) {
      setMessage("正在连接并恢复上次会话…"); return;
    }
    const found = findConversationLocation(catalog.projects, pending);
    if (!found) {
      setMessage(catalog.scanning ? "正在扫描上次会话…" : "上次会话暂时不可用，可能已归档、删除或主机尚未连接。可等待扫描，或选择其他会话。");
      return;
    }
    const token = generation.current;
    restoring.current = true;
    setMessage("正在恢复上次会话…");
    void (async () => {
      const { workspace: current, catalog: currentCatalog } = latest.current;
      let restored = true;
      if (found.session?.catalog) restored = await currentCatalog.select(found.session.id, () => generation.current === token);
      else if (found.session) current.selectProjectSession(found.project, found.session);
      else current.chooseProject(found.project);
      if (generation.current !== token) return;
      if (restored) { setPending(null); setMessage(""); }
      else setMessage("暂时无法读取上次会话，可重新尝试或选择其他会话。");
      // An explicit retry prevents an unavailable historical session from generating a request loop.
    })().catch(() => { if (generation.current === token) setMessage("恢复会话失败，请重新尝试。"); });
  }, [pending, workspace.bridgeState, catalog.loaded, catalog.projects, catalog.scanning]);

  useEffect(() => {
    if (!ready || pending) return;
    const native = catalog.selected;
    const agent = workspace.selectedAgent;
    // Keep the saved identity while a snapshot is temporarily missing the selected agent.
    if (section === "projects" && !native && workspace.selectedAgentId && !agent) return;
    const value = { version: 1, section, projectHost,
      host: native?.host || agent?.host || workspace.hostFilter,
      cwd: native?.cwd || agent?.cwd || workspace.cwdFilter,
      session: native ? { id: native.key, sessionId: native.sessionId || "", provider: native.provider }
        : agent ? { id: agent.id, sessionId: agent.rollout?.id || "", provider: "codex" } : null };
    try { sessionStorage.setItem(CONVERSATION_LOCATION_KEY, JSON.stringify(value)); } catch { /* Navigation still works without storage. */ }
  }, [ready, pending, section, projectHost, catalog.selected, workspace.selectedAgent, workspace.selectedAgentId, workspace.hostFilter, workspace.cwdFilter]);

  function cancel() { generation.current++; restoring.current = false; setPending(null); setMessage(""); }
  function retry() { generation.current++; restoring.current = false; setPending(value => value ? { ...value } : null); void catalog.refresh(); }
  return { cancel, retry, message };
}
