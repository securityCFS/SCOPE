"use client";
import {
  ArrowLeft,
  BarChart3,
  Search,
  CircleDot,
  KeyRound,
  Moon,
  PanelLeft,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  SquareTerminal,
  Sun,
  Wifi,
  X,
} from "lucide-react";
import type { WorkspaceController } from "./use-workspace-controller";
import type { Section } from "@/features/command-center/types";
import { ScopeLogo } from "@/components/scope-logo";
import { useLocale, type SettingsTab } from "@/lib/i18n";

export function WorkspaceTopbar({
  setMobileHostsOpen,
  setOperatorNameDraft,
  operatorName,
  setOperatorEditorOpen,
  operatorEditorOpen,
  saveOperatorName,
  operatorNameDraft,
  busyAction,
  uiTheme,
  bridgeState,
  toggleUiTheme,
  pendingHumanRequests,
  snapshot,
  focusHumanRequest,
  openNewTask,
  selectedProject,
  submissionTracker,
  refreshSubmissions,
  setSubmissionTrackerOpen,
  openWebTerminal,
  openAccountProfiles,
  refresh,
  setResearchAssistantOpen,
  section,
  onNavigate,
  onOpenSettings,
}: Pick<
  WorkspaceController,
  | "setMobileHostsOpen"
  | "setOperatorNameDraft"
  | "operatorName"
  | "setOperatorEditorOpen"
  | "operatorEditorOpen"
  | "saveOperatorName"
  | "operatorNameDraft"
  | "busyAction"
  | "uiTheme"
  | "bridgeState"
  | "toggleUiTheme"
  | "pendingHumanRequests"
  | "snapshot"
  | "focusHumanRequest"
  | "openNewTask"
  | "selectedProject"
  | "submissionTracker"
  | "refreshSubmissions"
  | "setSubmissionTrackerOpen"
  | "openWebTerminal"
  | "openAccountProfiles"
  | "refresh"
  | "setResearchAssistantOpen"
> & {
  section?: Section;
  onNavigate?: (next: Section) => void;
  onOpenSettings?: (tab?: SettingsTab) => void;
}) {
  const { locale, toggleLocale, tr } = useLocale();
  return (
    <header className="monitor-topbar">
      <div className="scope-wordmark">
        <button
          className="mobile-host-toggle"
          aria-label="打开主机列表"
          onClick={() => setMobileHostsOpen(true)}
        >
          <PanelLeft size={18} />
        </button>
        <span className="scope-mark">
          <ScopeLogo size={25} />
        </span>
        <strong>SCOPE</strong>
        <em>{tr("跨项目工作台", "Agent Workbench")}</em>
        <div className="operator-control">
          <button
            type="button"
            className="operator-name"
            title="修改显示名称"
            onClick={() => {
              setOperatorNameDraft(operatorName);
              setOperatorEditorOpen((current) => !current);
            }}
          >
            {operatorName}
            <Pencil size={11} />
          </button>
          {operatorEditorOpen && (
            <form className="operator-editor" onSubmit={saveOperatorName}>
              <label htmlFor="operator-name-input">显示名称</label>
              <div>
                <input
                  id="operator-name-input"
                  autoFocus
                  maxLength={40}
                  value={operatorNameDraft}
                  onChange={(event) => setOperatorNameDraft(event.target.value)}
                />
                <button
                  type="submit"
                  aria-label="保存显示名称"
                  disabled={
                    busyAction === "operator-name" || !operatorNameDraft.trim()
                  }
                >
                  <Save size={13} />
                </button>
                <button
                  type="button"
                  aria-label="取消修改显示名称"
                  onClick={() => setOperatorEditorOpen(false)}
                >
                  <X size={13} />
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
      <div className="topbar-right">
        {section && section !== "projects" && onNavigate && (
          <button
            type="button"
            className="topbar-nav-btn"
            onClick={() => onNavigate("projects")}
          >
            <ArrowLeft size={14} />
            <span>{tr("返回会话", "Sessions")}</span>
          </button>
        )}
        {onOpenSettings && (
          <button
            type="button"
            className={`topbar-nav-btn ${section === "settings" ? "active" : ""}`}
            aria-label={tr("打开设置", "Open settings")}
            onClick={() =>
              section === "settings" && onNavigate
                ? onNavigate("projects")
                : onOpenSettings("general")
            }
          >
            <Settings2 size={14} />
            <span>{tr("设置", "Settings")}</span>
          </button>
        )}
        <button
          type="button"
          className="theme-toggle"
          style={{ width: "auto", padding: "0 8px", fontSize: 11, fontWeight: 600 }}
          aria-label={locale === "zh-CN" ? "Switch to English" : "切换为中文"}
          title={locale === "zh-CN" ? "Switch to English" : "切换为中文"}
          onClick={toggleLocale}
        >
          {locale === "zh-CN" ? "EN" : "中"}
        </button>
        <button
          type="button"
          className="theme-toggle"
          aria-label={uiTheme === "dark" ? tr("切换到浅色主题", "Switch to light theme") : tr("切换到深色主题", "Switch to dark theme")}
          title={uiTheme === "dark" ? tr("切换到浅色主题", "Switch to light theme") : tr("切换到深色主题", "Switch to dark theme")}
          onClick={toggleUiTheme}
        >
          {uiTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <details className="system-status-menu">
          <summary className="connection-badge system-status-summary">
            <Wifi size={13} /> {tr("系统状态", "Status")}
          </summary>
          <div className="system-status-popover">
            <div>
              <span>SSH Bridge</span>
              <strong className={bridgeState === "connected" ? "is-healthy" : ""}>
                {bridgeState === "connected" ? tr("已连接", "Connected") : tr("重连中", "Reconnecting")}
              </strong>
            </div>
            <div>
              <span>{tr("交互通道", "Interactive")}</span>
              <strong>
                {bridgeState !== "connected" ? tr("等待服务恢复", "Waiting for bridge") : pendingHumanRequests.length
                  ? `${pendingHumanRequests.length} ${tr("条待处理", "pending")}`
                  : tr("监控与人工请求正常", "Healthy")}
              </strong>
            </div>
            <div>
              <span>{tr("邮件通知", "Email alerts")}</span>
              <strong>
                {snapshot.notifications?.email.configured
                  ? `${tr("已启用", "Active")} · ${snapshot.notifications.email.to.join(", ")}`
                  : snapshot.notifications?.email.lastError || tr("尚未配置", "Not configured")}
              </strong>
              {onOpenSettings && (
                <button
                  type="button"
                  className="secondary-action"
                  style={{ marginTop: 6, padding: "4px 8px", fontSize: 11 }}
                  onClick={() => onOpenSettings("email")}
                >
                  {tr("配置邮件", "Configure")}
                </button>
              )}
            </div>
            <div className="system-status-path">
              <span>SSH Config</span>
              <code title={snapshot.sshConfig}>{snapshot.sshConfig}</code>
            </div>
          </div>
        </details>
        {pendingHumanRequests.length > 0 && (
          <button
            type="button"
            className="connection-badge pending-input-badge"
            onClick={() => focusHumanRequest(pendingHumanRequests[0])}
          >
            <CircleDot size={13} />
            待处理 {pendingHumanRequests.length}
          </button>
        )}
        <button
          className="new-task-button"
          onClick={() => openNewTask(selectedProject)}
        >
          <Plus size={15} />
          {tr("新建会话", "New session")}
        </button>
        <details className="topbar-more">
          <summary aria-label={tr("更多工具", "More tools")}>
            {tr("更多", "More")}
            {submissionTracker.alerts.length > 0 && (
              <i aria-label={tr("提交追踪有告警", "Submission alerts")} />
            )}
          </summary>
          <div
            className="topbar-more-menu"
            onClick={(event) =>
              event.currentTarget.parentElement?.removeAttribute("open")
            }
          >
            <button
              type="button"
              onClick={() => setResearchAssistantOpen(true)}
            >
              <Search size={15} /> {tr("检索历史工作", "Search history")}
            </button>
            {submissionTracker.targetHostname && (
            <button
              type="button"
              onClick={() => {
                if (!submissionTracker.scannedAt && !submissionTracker.scanning)
                  void refreshSubmissions();
                else setSubmissionTrackerOpen(true);
              }}
            >
              <BarChart3 size={15} /> {tr("提交追踪", "Job tracker")}
              {submissionTracker.alerts.length > 0 && <small>{tr("有告警", "Alerts")}</small>}
            </button>
            )}
            <button type="button" onClick={openWebTerminal}>
              <SquareTerminal size={15} /> {tr("SSH 终端", "SSH Terminal")}
            </button>
            <button type="button" onClick={openAccountProfiles}>
              <KeyRound size={15} /> {tr("主机账号", "Accounts")}
            </button>
            <button type="button" onClick={refresh}>
              <RefreshCw
                size={15}
                className={snapshot.scanning ? "is-spinning" : ""}
              />
              {snapshot.scanning ? tr("扫描中", "Scanning") : tr("立即扫描", "Scan now")}
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}
