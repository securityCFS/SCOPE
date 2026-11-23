"use client";
import { ArchiveSidebar } from "@/features/archive/ArchiveSidebar";
import type { CatalogEntry } from "@/features/conversation/use-session-catalog";
import { useLocale } from "@/lib/i18n";
import type { ArchiveClient } from "@/features/archive/use-session-archives";
import type { WorkbenchClient } from "@/features/command-center/use-workbench";
import { ProjectSidebar } from "@/components/project-sidebar";
import type { Section } from "@/features/command-center/types";
import {
  Bot,
  Cpu,
  MessageSquare,
  PanelLeft,
  Settings2,
  X,
} from "lucide-react";
import type { WorkspaceController } from "./use-workspace-controller";

export function HostNavigation({
  archives,
  sessionCatalog,
  workbench,
  section,
  onNavigate,
  hostSidebarCollapsed,
  mobileHostsOpen,
  snapshot,
  toggleHostSidebar,
  setMobileHostsOpen,
  projects,
  selectedProjectKey,
  selectedAgentId,
  projectBusyKey,
  chooseProject,
  toggleProjectPin,
  selectProjectSession,
  openNewTask,
  loadHistoryCache,
  projectHost,
  chooseHost,
}: Pick<
  WorkspaceController,
  | "hostSidebarCollapsed"
  | "mobileHostsOpen"
  | "snapshot"
  | "toggleHostSidebar"
  | "setMobileHostsOpen"
  | "projects"
  | "selectedProjectKey"
  | "selectedAgentId"
  | "projectBusyKey"
  | "chooseProject"
  | "toggleProjectPin"
  | "selectProjectSession"
  | "openNewTask"
  | "loadHistoryCache"
  | "chooseHost"
> & {
  sessionCatalog?: { scanning: boolean; error: string; scans: { host: string; count?: number; errors: string[] }[]; scan: () => Promise<void>; archiveNative: (key: string, action: string) => Promise<void>; archiveBusy: boolean; nativeArchives: CatalogEntry[] };
  archives: ArchiveClient;
  workbench: WorkbenchClient;
  projectHost: string;
  section: Section;
  onNavigate: (section: Section) => void;
}) {
  const { tr } = useLocale();
  return (
    <aside
      className={`host-sidebar ${
        hostSidebarCollapsed ? "collapsed" : ""
      } ${mobileHostsOpen ? "mobile-open" : ""}`}
    >
      <div className="host-sidebar-head">
        <div>
          <span>工作区</span>
          <strong>
            {snapshot.summary.online} / {snapshot.summary.hosts}
          </strong>
        </div>
        <button
          type="button"
          className="host-sidebar-collapse"
          aria-label={
            hostSidebarCollapsed ? "展开 SSH 主机栏" : "折叠 SSH 主机栏"
          }
          title={hostSidebarCollapsed ? "展开 SSH 主机栏" : "折叠 SSH 主机栏"}
          onClick={toggleHostSidebar}
        >
          <PanelLeft size={17} />
        </button>
        <button
          className="close-hosts"
          aria-label="关闭主机列表"
          onClick={() => setMobileHostsOpen(false)}
        >
          <X size={17} />
        </button>
      </div>
      <nav className="workspace-primary-nav" aria-label={tr("工作台导航", "Workspace navigation")}>
        {(
          [
            { id: "projects", label: tr("项目会话", "Sessions"), icon: MessageSquare },
            { id: "manager", label: tr("总调度", "Coordinator"), icon: Bot },
            { id: "resources", label: tr("资源与任务", "Resources"), icon: Cpu },
            { id: "settings", label: tr("设置", "Settings"), icon: Settings2 },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            title={item.label}
            className={section === item.id ? "active" : ""}
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <item.icon size={17} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <ProjectSidebar
        projects={projects.filter(
          (project) => projectHost === "all" || project.host === projectHost,
        )}
        hostFilter={projectHost}
        hosts={snapshot.hosts}
        onHostChange={chooseHost}
        selectedKey={selectedProjectKey}
        selectedSessionId={selectedAgentId}
        busyKey={projectBusyKey}
        onSelect={(project) => chooseProject(project)}
        onTogglePin={(project) => void toggleProjectPin(project)}
        onSelectSession={selectProjectSession}
        archiveBusy={!!archives.busy || !!sessionCatalog?.archiveBusy}
        onArchive={(project, session) =>
          ["claude", "antigravity"].includes(session.provider || "") ? void sessionCatalog?.archiveNative(session.id, "archive") : void archives.change(project.host, session.sessionId, "archive")
        }
        onNewTask={(project) => {
          chooseProject(project);
          openNewTask(project);
        }}
        onHistory={(project) => {
          chooseProject(project, "history");
          void loadHistoryCache(undefined, project.host);
        }}
        scanning={Boolean(sessionCatalog?.scanning)}
        onRescan={
          sessionCatalog
            ? () => void sessionCatalog.scan().catch(() => {})
            : undefined
        }
      />
      <ArchiveSidebar
        client={workbench}
        archives={archives}
        host={projectHost}
        records={Object.values(snapshot.management.sessions).flatMap((value) =>
          value.archive ? [value.archive] : [],
        )}
        nativeArchives={sessionCatalog?.nativeArchives.filter((e) => projectHost === "all" || e.host === projectHost) || []}
        nativeBusy={Boolean(sessionCatalog?.archiveBusy)}
        onNativeChange={sessionCatalog?.archiveNative}
        onTasks={() => onNavigate("resources")}
      />
    </aside>
  );
}
