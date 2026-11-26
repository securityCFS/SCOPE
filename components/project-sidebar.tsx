"use client";
import { hostLabel } from "@/lib/execution-host";
import { AgentLogo } from "@/components/agent-logo";
import { useLocale } from "@/lib/i18n";
import { SessionStatus } from "./session-status";
import {
  Archive,
  ChevronDown,
  Folder,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useState } from "react";
import { activityLabel } from "@/lib/session-activity";
import { filterProjects } from "@/lib/project-view";
import { ProjectFilterBar, useProjectFilters } from "./project-filters";

export type ProjectSession = {
  id: string;
  sessionId: string;
  title: string;
  status: string;
  historical: boolean;
  provider?: string;
  catalog?: boolean;
  lastActivityAt?: number | null;
  externalTerminal?: boolean;
  reserved?: boolean;
  activeSubagents?: number;
  category?: string;
};
export type ProjectEntry = {
  key: string;
  host: string;
  cwd: string;
  name: string;
  pinned: boolean;
  sessions: ProjectSession[];
};

export function ProjectSidebar({
  projects,
  selectedKey,
  selectedSessionId,
  busyKey,
  onSelect,
  onTogglePin,
  onSelectSession,
  onNewTask,
  onHistory,
  hostFilter,
  hosts,
  onHostChange,
  onArchive,
  archiveBusy,
  onRescan,
  scanning = false,
}: {
  onArchive: (project: ProjectEntry, session: ProjectSession) => void;
  archiveBusy: boolean;
  projects: ProjectEntry[];
  selectedKey: string | null;
  selectedSessionId: string | null;
  busyKey: string;
  onSelect: (project: ProjectEntry) => void;
  onTogglePin: (project: ProjectEntry) => void;
  onSelectSession: (project: ProjectEntry, session: ProjectSession) => void;
  onNewTask: (project: ProjectEntry) => void;
  onHistory: (project: ProjectEntry) => void;
  hostFilter: string;
  hosts: { alias: string; reachable: boolean }[];
  onHostChange: (host: string) => void;
  onRescan?: () => void;
  scanning?: boolean;
}) {
  const { locale, tr } = useLocale();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useProjectFilters();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [showOfflineHosts, setShowOfflineHosts] = useState(false);
  const needle = query.trim().toLocaleLowerCase();
  const visible = filterProjects(projects, filters, query);
  const defaultExpandedKey =
    selectedKey ||
    visible.find((project) =>
      Boolean(
        selectedSessionId &&
        project.sessions.some((session) => session.id === selectedSessionId),
      ),
    )?.key ||
    visible.find((project) =>
      project.sessions.some(
        (session) => session.status === "working" && !session.historical,
      ),
    )?.key ||
    visible[0]?.key ||
    null;
  const onlineHosts = hosts.filter((h) => h.reachable);
  const offlineHosts = hosts.filter((h) => !h.reachable);
  const visibleOfflineHosts = showOfflineHosts
    ? offlineHosts
    : offlineHosts.filter((h) => h.alias === hostFilter);
  const hiddenOfflineCount = offlineHosts.length - visibleOfflineHosts.length;
  const visibleHosts = [...onlineHosts, ...visibleOfflineHosts];
  return (
    <section className="project-nav" aria-label={tr("项目导航", "Projects")}>
      <div className="sidebar-host-pills" role="group" aria-label={tr("按主机筛选", "Filter by host")}>
        <button
          type="button"
          className={`sidebar-host-pill ${hostFilter === "all" ? "active" : ""}`}
          onClick={() => onHostChange("all")}
        >
          <span>{tr("全部", "All")}</span>
          <small>{onlineHosts.length}/{hosts.length}</small>
        </button>
        {visibleHosts.map((host) => {
          const active = hostFilter === host.alias;
          return (
            <button
              key={host.alias}
              type="button"
              className={`sidebar-host-pill ${active ? "active" : ""}`}
              title={`${hostLabel(host.alias, locale)} · ${host.reachable ? tr("在线", "Online") : tr("离线", "Offline")}`}
              onClick={() => onHostChange(active ? "all" : host.alias)}
            >
              <span className={`dot ${host.reachable ? "online" : ""}`} />
              <span>{hostLabel(host.alias, locale)}</span>
            </button>
          );
        })}
        {offlineHosts.length > 0 && (showOfflineHosts || hiddenOfflineCount > 0) && (
          <button
            type="button"
            className="sidebar-host-pill offline-toggle"
            aria-expanded={showOfflineHosts}
            onClick={() => setShowOfflineHosts((value) => !value)}
            title={showOfflineHosts ? tr("收起离线主机", "Collapse offline hosts") : tr("展开离线主机", "Show offline hosts")}
          >
            {showOfflineHosts
              ? tr("收起离线", "Hide offline")
              : `+${hiddenOfflineCount} ${tr("离线", "offline")}`}
          </button>
        )}
      </div>
      <div className="project-search-row">
        <label className="project-search">
          <Search size={14} />
          <input
            aria-label={tr("搜索项目和会话", "Search projects & sessions")}
            placeholder={tr("搜索会话…", "Search sessions…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {onRescan && (
          <button
            type="button"
            className="project-rescan-btn"
            disabled={scanning}
            aria-label={tr("重新扫描会话目录", "Rescan session catalog")}
            title={tr("重新扫描 Codex / Claude / AGY 会话", "Rescan Codex / Claude / AGY sessions")}
            onClick={onRescan}
          >
            <RefreshCw size={13} className={scanning ? "is-spinning" : ""} />
          </button>
        )}
      </div>
      <ProjectFilterBar value={filters} onChange={setFilters} />
      <div className="project-nav-list">
        {!visible.length && (
          <p className="project-nav-empty">
            {needle ||
            filters.category !== "all" ||
            filters.provider !== "all" ||
            filters.status !== "all"
              ? "没有找到匹配的会话"
              : hostFilter === "all"
                ? "还没有项目"
                : "这台设备还没有项目"}
          </p>
        )}
        {visible.map((project) => {
          const selected = project.key === selectedKey;
          const hasSelectedSession = Boolean(
            selectedSessionId &&
            project.sessions.some(
              (session) => session.id === selectedSessionId,
            ),
          );
          const name =
            project.name || project.cwd.split("/").filter(Boolean).pop() || "/";
          const defaultOpen =
            selected ||
            hasSelectedSession ||
            project.key === defaultExpandedKey;
          const open =
            Boolean(needle) || (expanded[project.key] ?? defaultOpen);
          const sessions = project.sessions;
          return (
            <div className="project-nav-entry" key={project.key}>
              <div
                className={`project-nav-row ${selected || hasSelectedSession ? "selected" : ""}`}
              >
                <button
                  type="button"
                  className="project-disclosure"
                  aria-label={`${open ? "收起" : "展开"}项目 ${name}`}
                  aria-expanded={Boolean(open)}
                  onClick={() =>
                    setExpanded((value) => ({ ...value, [project.key]: !open }))
                  }
                >
                  <ChevronDown size={13} />
                </button>
                <button
                  type="button"
                  className="project-nav-select"
                  aria-expanded={Boolean(open)}
                  onClick={() => {
                    const nextOpen = !open;
                    setExpanded((value) => ({ ...value, [project.key]: nextOpen }));
                    if (nextOpen) onSelect(project);
                  }}
                  title={`${hostLabel(project.host)} · ${project.cwd}`}
                >
                  <Folder size={15} />
                  <span>
                    <strong>{name}</strong>
                  </span>
                  {sessions.length > 0 && (
                    <small className="project-nav-count">
                      {sessions.length}
                    </small>
                  )}
                </button>
                <button
                  type="button"
                  className="project-nav-icon"
                  onClick={() => onNewTask(project)}
                  aria-label={`在 ${name} 新建会话`}
                  title={`在 ${name} 新建会话`}
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  className="project-nav-icon project-pin"
                  disabled={busyKey === project.key}
                  onClick={() => onTogglePin(project)}
                  aria-label={`${project.pinned ? "取消固定" : "固定"}项目 ${name}`}
                  title={project.pinned ? "取消固定" : "固定项目"}
                >
                  {project.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                </button>
              </div>
              {open && (
                <div className="project-nav-details">
                  {sessions
                    .slice(0, limits[project.key] || 8)
                    .map((session) => (
                      <div className="project-session-row" key={session.id}>
                        <button
                          type="button"
                          key={session.id}
                          className={`project-nav-session ${session.id === selectedSessionId ? "selected" : ""}`}
                          onClick={() => onSelectSession(project, session)}
                          title={`${session.title}\n${session.externalTerminal ? "外部终端 · 持续监控\n" : ""}${session.lastActivityAt ? `最近活动：${new Date(session.lastActivityAt).toLocaleString("zh-CN")}` : "尚未取得活动时间"}`}
                          aria-current={
                            session.id === selectedSessionId
                              ? "page"
                              : undefined
                          }
                        >
                          <AgentLogo provider={session.provider} />
                          <SessionStatus
                            status={session.status}
                            historical={session.historical}
                          />
                          <span className="project-session-title">
                            {session.title}
                          </span>
                          {session.externalTerminal && (
                            <small
                              className="project-session-source"
                              title="外部终端 · 持续监控"
                            >
                              终端
                            </small>
                          )}
                          {session.reserved && (
                            <small
                              className="project-session-source is-reserved"
                              title={tr("常驻保留资源", "Reserved session")}
                            >
                              {tr("保留", "Pin")}
                            </small>
                          )}
                          {(session.activeSubagents || 0) > 0 && (
                            <small
                              className="project-session-source is-subagent"
                              title={tr("后台子代理正在工作", "Background subagents working")}
                            >
                              {session.activeSubagents} {tr("子代理", "sub")}
                            </small>
                          )}
                          <time
                            className="project-session-time"
                            dateTime={
                              session.lastActivityAt
                                ? new Date(session.lastActivityAt).toISOString()
                                : undefined
                            }
                          >
                            {activityLabel(session.lastActivityAt, undefined, locale)}
                          </time>
                        </button>
                        {(!session.provider ||
                          session.provider === "codex" || session.provider === "claude" || session.provider === "antigravity") && (
                          <button
                            type="button"
                            className="sidebar-archive-action"
                            aria-label={`归档会话 ${session.title}`}
                            title={["claude", "antigravity"].includes(session.provider || "") ? "归档到 SCOPE，保留原生历史" : "归档会话及其子会话，可在已归档中恢复"}
                            disabled={
                              archiveBusy ||
                              !session.sessionId ||
                              session.status === "working" ||
                              Boolean(session.externalTerminal)
                            }
                            onClick={() => onArchive(project, session)}
                          >
                            <Archive size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  {sessions.length > (limits[project.key] || 8) && (
                    <button
                      type="button"
                      className="project-history-link"
                      onClick={() =>
                        setLimits((value) => ({
                          ...value,
                          [project.key]: (value[project.key] || 8) + 20,
                        }))
                      }
                    >
                      {tr("显示更多会话", "Show more")} (+
                      {sessions.length - (limits[project.key] || 8)})
                    </button>
                  )}
                  {selected && (
                    <button
                      type="button"
                      className="project-history-link"
                      onClick={() => onHistory(project)}
                    >
                      {tr("加载历史会话", "Load history")}
                    </button>
                  )}
                  {!sessions.length && <p>{tr("还没有会话", "No sessions yet")}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
