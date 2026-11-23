"use client";

import { Maximize2, Plus, SquareTerminal, X } from "lucide-react";
import { useState } from "react";
import { SshTerminalSession } from "./ssh-terminal-session";

export type SshTerminalTarget = { host: string; cwd: string; tmuxSession: string };
type TerminalTab = { id: number; target: SshTerminalTarget; mode: "shell" | "tmux" };

export function SshTerminalPanel({ target, uiTheme, onClose }: {
  target: SshTerminalTarget;
  uiTheme: "dark" | "light";
  onClose: () => void;
}) {
  const [state, setState] = useState(() => ({
    request: target,
    tabs: [{ id: 1, target, mode: "shell" } as TerminalTab],
    activeId: 1,
    nextId: 2,
  }));
  const [maximized, setMaximized] = useState(false);

  // Opening another project must not disconnect existing shells.
  if (state.request !== target) {
    setState({ ...state, request: target, activeId: state.nextId, nextId: state.nextId + 1,
      tabs: [...state.tabs, { id: state.nextId, target, mode: "shell" }] });
  }
  const activeTab = state.tabs.find((tab) => tab.id === state.activeId)!;
  function addTab(mode: "shell" | "tmux" = "shell") {
    setState((current) => ({ ...current, activeId: current.nextId, nextId: current.nextId + 1,
      tabs: [...current.tabs, { id: current.nextId, target: activeTab.target, mode }] }));
  }
  function closeTab(id: number) {
    if (state.tabs.length === 1) { onClose(); return; }
    setState((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id);
      const tabs = current.tabs.filter((tab) => tab.id !== id);
      return { ...current, tabs, activeId: current.activeId === id
        ? tabs[Math.min(index, tabs.length - 1)].id : current.activeId };
    });
  }

  return (
    <section className={`ssh-terminal-panel ${maximized ? "is-maximized" : ""}`} aria-label="SSH 终端">
      <header>
        <div className="terminal-tab-strip" role="tablist" aria-label="终端标签">
          {state.tabs.map((tab, index) => (
            <div className={`terminal-tab ${tab.id === state.activeId ? "is-active" : ""}`} key={tab.id}>
              <button type="button" role="tab" id={`terminal-tab-${tab.id}`}
                aria-controls={`terminal-pane-${tab.id}`} aria-selected={tab.id === state.activeId}
                tabIndex={tab.id === state.activeId ? 0 : -1}
                title={`${tab.target.host} · ${tab.target.cwd || "~"}`}
                onClick={() => setState((current) => ({ ...current, activeId: tab.id }))}
                onKeyDown={(event) => {
                  if (event.key === "Delete") { event.preventDefault(); closeTab(tab.id); return; }
                  const next = event.key === "ArrowRight" ? (index + 1) % state.tabs.length
                    : event.key === "ArrowLeft" ? (index + state.tabs.length - 1) % state.tabs.length
                    : event.key === "Home" ? 0 : event.key === "End" ? state.tabs.length - 1 : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  setState((current) => ({ ...current, activeId: state.tabs[next].id }));
                }}>
                <SquareTerminal size={13} />
                <span>{tab.mode === "tmux" ? "tmux" : "终端"} {tab.id}</span>
              </button>
              <button type="button" className="terminal-tab-close" aria-label={`关闭终端 ${tab.id}`}
                onClick={() => closeTab(tab.id)}><X size={12} /></button>
            </div>
          ))}
        </div>
        <div className="ssh-terminal-actions">
          <button type="button" aria-label="新建终端" title="新建终端（当前主机与目录）" onClick={() => addTab()}><Plus size={16} /></button>
          {activeTab.target.tmuxSession && <button type="button" className="terminal-attach"
            title={`在新标签附着 ${activeTab.target.tmuxSession}`} onClick={() => addTab("tmux")}>tmux</button>}
          <button type="button" aria-label={maximized ? "恢复终端高度" : "最大化终端"}
            onClick={() => setMaximized((value) => !value)}><Maximize2 size={14} /></button>
          <button type="button" aria-label="关闭全部终端" title="关闭全部终端" onClick={onClose}><X size={15} /></button>
        </div>
      </header>
      {state.tabs.map((tab) => (
        <div className="terminal-tab-pane" id={`terminal-pane-${tab.id}`} key={tab.id}
          role="tabpanel" aria-labelledby={`terminal-tab-${tab.id}`} hidden={tab.id !== state.activeId}>
          <SshTerminalSession target={tab.target} uiTheme={uiTheme} active={tab.id === state.activeId} mode={tab.mode} />
        </div>
      ))}
    </section>
  );
}
