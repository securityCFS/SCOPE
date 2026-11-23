"use client";
import { SshTerminalPanel } from "@/app/components/ssh-terminal";
import { BridgeConnectionGate, BridgeReconnectNotice } from "@/features/workspace/BridgeConnectionGate";
import { useWorkbench } from "@/features/command-center/use-workbench";
import { useSessionArchives } from "@/features/archive/use-session-archives";
import { WorkbenchSurface } from "@/features/command-center/WorkbenchSurface";
import type { Section } from "@/features/command-center/types";
import { AccountsDialog } from "@/features/workspace/AccountsDialog";
import { HostNavigation } from "@/features/workspace/HostNavigation";
import { NewTaskDialog } from "@/features/workspace/NewTaskDialog";
import { ResearchAssistant } from "@/features/workspace/ResearchAssistant";
import { useSessionCatalog } from "@/features/conversation/use-session-catalog";
import { useConversationLocation } from "@/features/conversation/use-conversation-location";
import { NativeConversation } from "@/features/conversation/NativeConversation";
import { SessionConversation } from "@/features/conversation/SessionConversation";
import { WorkspaceTools } from "@/features/conversation/WorkspaceTools";
import { SubmissionDialog } from "@/features/workspace/SubmissionDialog";
import { WorkspaceTopbar } from "@/features/workspace/WorkspaceTopbar";
import { useWorkspaceController } from "@/features/workspace/use-workspace-controller";
import { LocaleProvider, type SettingsTab } from "@/lib/i18n";
import "katex/dist/katex.min.css";
import {
  AlertTriangle,
  Check,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

export default function Home() {
  return (
    <LocaleProvider>
      <HomeShell />
    </LocaleProvider>
  );
}

function HomeShell() {
  const workspace = useWorkspaceController();
  const workbench = useWorkbench();
  const catalog = useSessionCatalog(workspace);
  const archives = useSessionArchives((host, id) => {
    if (
      workspace.selectedAgent?.host === host &&
      workspace.selectedAgent.rollout?.id === id
    )
      workspace.setSelectedAgentId(null);
  });
  const [section, setSection] = useState<Section>("manager");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [projectHost, setProjectHost] = useState("all");
  const rememberedSessions = useRef<Record<string, string>>({});
  const location = useConversationLocation({ workspace, catalog, section, setSection, projectHost, setProjectHost });
  const navigationWorkspace = {
    ...workspace,
    projects: catalog.projects,
    selectedAgentId: catalog.selected?.key || workspace.selectedAgentId,
    chooseHost: (host: string) => {
      location.cancel();
      catalog.clear();
      setSection("projects");
      workspace.chooseHost(host);
      setProjectHost(host);
      if (host !== "all" && workspace.selectedAgent?.host !== host)
        workspace.setSelectedAgentId(null);
    },
    chooseProject: (...args: Parameters<typeof workspace.chooseProject>) => {
      location.cancel();
      setSection("projects");
      workspace.chooseProject(...args);
      const project = args[0];
      const remembered = rememberedSessions.current[project.key];
      const next =
        project.sessions.find((session) => session.id === remembered) ||
        project.sessions[0];
      if (next?.catalog) void catalog.select(next.id);
      else { catalog.clear(); workspace.setSelectedAgentId(next?.id || null); }
    },
    selectProjectSession: (
      ...args: Parameters<typeof workspace.selectProjectSession>
    ) => {
      location.cancel();
      setSection("projects");
      if (args[1].catalog) void catalog.select(args[1].id);
      else { catalog.clear(); workspace.selectProjectSession(...args); }
      rememberedSessions.current[args[0].key] = args[1].id;
    },
    openNewTask: (...args: Parameters<typeof workspace.openNewTask>) => {
      location.cancel();
      setSection("projects");
      workspace.setActionNotice(null);
      workspace.openNewTask(...args);
    },
    createTask: async (...args: Parameters<typeof workspace.createTask>) => {
      if (projectHost !== "all") setProjectHost(workspace.newTaskDraft.host);
      return await workspace.createTask(...args);
    },
    focusHumanRequest: (
      ...args: Parameters<typeof workspace.focusHumanRequest>
    ) => {
      location.cancel();
      setSection("projects");
      workspace.focusHumanRequest(...args);
    },
  };
  function navigate(next: Section) {
    location.cancel();
    setSection(next);
    workspace.setMobileHostsOpen(false);
  }
  const {
    bridgeState,
    copied,
    mobileHostsOpen,
    setMobileHostsOpen,
    hostSidebarCollapsed,
    uiTheme,
    sshTerminalTarget,
    setSshTerminalTarget,
    actionNotice,
    setActionNotice,
    monitorColumnsRef,
    isResizing,
    copy,
  } = workspace;
  if (bridgeState === "offline" && !workspace.snapshot.generatedAt) {
    return <BridgeConnectionGate theme={uiTheme} copied={copied === "scope"}
      onCopy={() => { void copy("npm run scope", "scope"); }} />;
  }

  return (
    <main
      className={`monitor-shell ${isResizing ? "is-resizing" : ""}`}
      data-ui-theme={uiTheme}
    >
      <WorkspaceTopbar
        {...navigationWorkspace}
        section={section}
        onNavigate={navigate}
        onOpenSettings={(tab = "general") => {
          setSettingsTab(tab);
          navigate("settings");
        }}
      />
      {bridgeState === "offline" && <BridgeReconnectNotice />}
      {location.message && <div className="connection-reconnect-notice" role="status">
        <span>{location.message}</span>
        <button type="button" onClick={location.retry}>重试</button>
        <button type="button" onClick={location.cancel}>关闭</button>
      </div>}

      <div
        className={`monitor-columns chat-workspace workbench-mode ${
          hostSidebarCollapsed ? "hosts-collapsed" : ""
        }`}
        ref={monitorColumnsRef}
      >
        <HostNavigation
          {...navigationWorkspace}
          workbench={workbench}
          archives={archives}
          sessionCatalog={catalog}
          projectHost={projectHost}
          section={section}
          onNavigate={navigate}
        />

        {mobileHostsOpen && (
          <button
            className="mobile-backdrop"
            aria-label="关闭主机列表"
            onClick={() => setMobileHostsOpen(false)}
          />
        )}

        {section !== "projects" ? (
          <WorkbenchSurface
            client={workbench}
            section={section}
            onNavigate={navigate}
            workspace={navigationWorkspace}
            settingsTab={settingsTab}
            onSettingsTabChange={setSettingsTab}
          />
        ) : catalog.selected ? (
          <NativeConversation
            key={catalog.selected.key}
            entry={catalog.selected}
            onChanged={() => {
              void catalog.refresh();
            }}
            onAccounts={() => {
              workspace.openAccountProfiles(catalog.selected?.host);
            }}
          />
        ) : (
          <SessionConversation
            key={workspace.selectedAgentId || "empty"}
            workspace={navigationWorkspace}
            onTools={() => setToolsOpen(true)}
          />
        )}
      </div>
      {toolsOpen && (
        <WorkspaceTools
          workspace={workspace}
          onClose={() => setToolsOpen(false)}
        />
      )}
      {sshTerminalTarget && (
        <SshTerminalPanel
          target={sshTerminalTarget}
          uiTheme={uiTheme}
          onClose={() => setSshTerminalTarget(null)}
        />
      )}
      <SubmissionDialog {...workspace} />
      <AccountsDialog
        {...workspace}
        defaultProvider={
          catalog.selected?.provider === "claude" ||
          catalog.selected?.provider === "antigravity"
            ? catalog.selected.provider
            : "codex"
        }
      />
      <NewTaskDialog {...navigationWorkspace} onNativeCreated={(entry) => { if (projectHost !== "all") setProjectHost(entry.host); catalog.created(entry); setSection("projects"); }} />
      <ResearchAssistant {...workspace} />
      {actionNotice && (
        <div
          className={`action-toast ${actionNotice.kind}`}
          role={actionNotice.kind === "error" ? "alert" : "status"}
        >
          {actionNotice.kind === "success" ? (
            <Check size={15} />
          ) : (
            <AlertTriangle size={15} />
          )}
          <span>{actionNotice.text}</span>
          <button
            type="button"
            aria-label="关闭通知"
            onClick={() => setActionNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </main>
  );
}
