"use client";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  LoaderCircle,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { SubagentDisplayToggles } from "@/components/subagent-display-toggles";
import { MarkdownBody } from "@/features/workspace/shared";
import "./subagent-workflow-drawer.css";

export type SubagentWorkflowStep = {
  id: string;
  kind:
    | "prompt"
    | "thinking"
    | "tool"
    | "command"
    | "assistant"
    | "error"
    | "note";
  title?: string;
  toolName?: string;
  summary?: string;
  text?: string;
  command?: string;
  inputPreview?: string;
  inputTruncated?: boolean;
  output?: string;
  outputTruncated?: boolean;
  isError?: boolean;
  status?: string;
  durationMs?: number | null;
  truncated?: boolean;
  timestamp?: string | number | null;
};

export type SubagentDrawerItem = {
  id: string;
  label: string;
  role?: string;
  typeName?: string;
  model?: string;
  spawnDepth?: number | null;
  status: string;
  lastAction?: string;
  taskTitle?: string;
  updatedAt?: number | null;
};

type StepFilter = "all" | "dialogue" | "tools" | "thinking" | "errors";

function formatTime(ts?: string | number | null): string {
  if (ts == null || ts === "") return "";
  const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateTime(ts?: string | number | null): string {
  if (ts == null || ts === "") return "";
  const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms?: number | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function extractHandbackMarkdown(step: SubagentWorkflowStep): string | null {
  if (step.toolName !== "SubagentHandback" || !step.inputPreview) return null;
  try {
    const parsed = JSON.parse(step.inputPreview) as Record<string, unknown>;
    for (const key of ["result", "report", "summary", "message", "output"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return null;
  }
  return null;
}

export function SubagentWorkflowDrawer({
  open,
  providerLabel,
  items,
  totalSubagents,
  selectedId,
  onSelect,
  onClose,
  onRefresh,
  onLoadMore,
  loading,
  error,
  steps,
  partial,
  totalSteps,
  truncated,
  hasMore,
  host,
  cwd,
  activeStatus,
  activeModel,
  activeTypeName,
  activeSpawnDepth,
  activeRole,
}: {
  open: boolean;
  providerLabel: string;
  items: SubagentDrawerItem[];
  totalSubagents?: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  onRefresh: () => void;
  onLoadMore?: () => void;
  loading: boolean;
  error: string;
  steps: SubagentWorkflowStep[];
  partial?: string;
  totalSteps?: number;
  truncated?: boolean;
  hasMore?: boolean;
  host?: string;
  cwd?: string;
  activeStatus?: string;
  activeModel?: string;
  activeTypeName?: string;
  activeSpawnDepth?: number | null;
  activeRole?: string;
}) {
  const { tr } = useLocale();
  const [stepFilter, setStepFilter] = useState<StepFilter>("all");
  const [expandAll, setExpandAll] = useState(false);
  const [dirQuery, setDirQuery] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const counts = useMemo(() => {
    let dialogue = 0;
    let tools = 0;
    let thinking = 0;
    let errors = 0;
    for (const step of steps) {
      if (step.kind === "prompt" || step.kind === "assistant" || extractHandbackMarkdown(step)) {
        dialogue += 1;
      }
      if (step.kind === "tool" || step.kind === "command") tools += 1;
      if (step.kind === "thinking") thinking += 1;
      if (step.kind === "error" || step.isError) errors += 1;
    }
    return { dialogue, tools, thinking, errors };
  }, [steps]);

  const filteredSteps = useMemo(() => {
    if (stepFilter === "all") return steps;
    if (stepFilter === "dialogue") {
      return steps.filter(
        (s) =>
          s.kind === "prompt" ||
          s.kind === "assistant" ||
          Boolean(extractHandbackMarkdown(s)),
      );
    }
    if (stepFilter === "tools") {
      return steps.filter((s) => s.kind === "tool" || s.kind === "command");
    }
    if (stepFilter === "thinking") {
      return steps.filter((s) => s.kind === "thinking");
    }
    return steps.filter((s) => s.kind === "error" || s.isError);
  }, [steps, stepFilter]);

  const groupedDirectory = useMemo(() => {
    const q = dirQuery.trim().toLowerCase();
    const list = q
      ? items.filter(
          (item) =>
            (item.role || item.label).toLowerCase().includes(q) ||
            (item.typeName || "").toLowerCase().includes(q) ||
            (item.model || "").toLowerCase().includes(q) ||
            (item.taskTitle || "").toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q),
        )
      : items;
    const groups: { key: string; title: string; items: SubagentDrawerItem[] }[] = [];
    const byKey = new Map<string, { key: string; title: string; items: SubagentDrawerItem[] }>();
    for (const item of list) {
      const taskKey = item.taskTitle ? `task:${item.taskTitle}` : "other";
      let group = byKey.get(taskKey);
      if (!group) {
        group = {
          key: taskKey,
          title: item.taskTitle || "",
          items: [],
        };
        byKey.set(taskKey, group);
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  }, [items, dirQuery]);

  if (!open) return null;

  const statusText: Record<string, string> = {
    working: tr("工作中", "Working"),
    running: tr("运行中", "Running"),
    completed: tr("已完成", "Completed"),
    idle: tr("已结束", "Idle"),
    failed: tr("失败", "Failed"),
    stopped: tr("已停止", "Stopped"),
  };

  const totalCount = Math.max(totalSubagents || 0, items.length);
  const workingCount = items.filter(
    (item) => item.status === "working" || item.status === "running",
  ).length;
  const selectedIndex = selectedId
    ? items.findIndex((item) => item.id === selectedId)
    : -1;
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : null;
  const status = activeStatus || selectedItem?.status || "completed";
  const isWorking = status === "working" || status === "running";
  const model = activeModel || selectedItem?.model || "";
  const typeName = activeTypeName || selectedItem?.typeName || "";
  const spawnDepth = activeSpawnDepth ?? selectedItem?.spawnDepth ?? null;
  const title =
    activeRole || selectedItem?.role || selectedItem?.label || selectedId || "";

  const selectSubagent = (nextId: string | null) => {
    setStepFilter("all");
    setExpandAll(false);
    onSelect(nextId);
  };

  const prefsToggleButton = (
    <button
      type="button"
      className={`subagent-drawer-icon-btn${prefsOpen ? " is-active" : ""}`}
      onClick={() => setPrefsOpen((value) => !value)}
      aria-expanded={prefsOpen}
      title={tr("子代理显示开关", "Subagent display toggles")}
    >
      <SlidersHorizontal size={13} />
      {tr("显示开关", "Display")}
    </button>
  );

  const prefsPanel = prefsOpen ? <SubagentDisplayToggles variant="drawer" /> : null;

  return (
    <div
      className="subagent-drawer-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="subagent-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={tr("子代理工作流详情", "Subagent workflow inspector")}
      >
        {!selectedId ? (
          <>
            <header className="subagent-drawer-header">
              <div className="subagent-drawer-title">
                <div className="subagent-drawer-title-row">
                  <span className="subagent-drawer-pill">{providerLabel}</span>
                  {workingCount > 0 && (
                    <span className="subagent-drawer-pill is-working">
                      <LoaderCircle size={11} className="is-spinning" />
                      {tr(`${workingCount} 个工作中`, `${workingCount} working`)}
                    </span>
                  )}
                  <span className="subagent-drawer-pill is-completed">
                    <Bot size={11} />
                    {tr(`共 ${totalCount} 个子代理`, `${totalCount} subagents`)}
                  </span>
                </div>
                <h3>{tr("会话子代理总览", "Session Subagents")}</h3>
                <div className="subagent-drawer-meta">
                  <span>
                    {tr(
                      "点击任意子代理查看其完整思考、工具调用与输出工作流",
                      "Select any subagent to inspect its full step-by-step workflow",
                    )}
                  </span>
                </div>
              </div>
              <div className="subagent-drawer-actions">
                {prefsToggleButton}
                <button
                  type="button"
                  className="subagent-drawer-icon-btn"
                  onClick={onClose}
                  aria-label={tr("关闭子代理面板", "Close subagents panel")}
                >
                  <X size={14} />
                </button>
              </div>
            </header>
            {prefsPanel}

            <div className="subagent-drawer-body">
              {items.length >= 6 && (
                <label className="subagent-dir-search">
                  <Search size={14} />
                  <input
                    value={dirQuery}
                    onChange={(event) => setDirQuery(event.target.value)}
                    placeholder={tr(
                      "按名称、任务、类型或模型筛选子代理…",
                      "Filter subagents by name, task, type, or model…",
                    )}
                  />
                </label>
              )}
              {totalCount > items.length && (
                <div className="subagent-drawer-banner" style={{ marginBottom: 12 }}>
                  <span>
                    {tr(
                      `该会话共创建过 ${totalCount} 个子代理，当前展示最近 ${items.length} 个。`,
                      `Showing latest ${items.length} of ${totalCount} subagents in this session.`,
                    )}
                  </span>
                </div>
              )}
              {groupedDirectory.length === 0 ? (
                <div className="subagent-drawer-empty">
                  <Bot size={20} />
                  <span>
                    {tr("未匹配到符合条件的子代理", "No matching subagents")}
                  </span>
                </div>
              ) : (
                groupedDirectory.map((group) => (
                  <div className="subagent-dir-group" key={group.key}>
                    {(group.title || groupedDirectory.length > 1) && (
                      <div className="subagent-dir-group-head">
                        <span
                          className="subagent-dir-group-title"
                          title={group.title || tr("更早创建的子代理", "Earlier subagents")}
                        >
                          {group.title
                            ? tr(`任务：${group.title}`, `Task: ${group.title}`)
                            : tr("更早创建的子代理", "Earlier subagents")}
                        </span>
                        <span>
                          {tr(`${group.items.length} 个`, `${group.items.length}`)}
                        </span>
                      </div>
                    )}
                    {group.items.map((item) => {
                      const itemWorking =
                        item.status === "working" || item.status === "running";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`subagent-dir-card${itemWorking ? " is-working" : ""}`}
                          onClick={() => selectSubagent(item.id)}
                        >
                          <div className="subagent-dir-card-main">
                            <div className="subagent-dir-card-top">
                              <span
                                className={`subagent-drawer-pill is-${item.status}`}
                              >
                                {itemWorking ? (
                                  <LoaderCircle size={10} className="is-spinning" />
                                ) : (
                                  <Bot size={10} />
                                )}
                                {statusText[item.status] || item.status}
                              </span>
                              {item.typeName && (
                                <span className="subagent-drawer-pill">
                                  {item.typeName}
                                </span>
                              )}
                              {item.model && (
                                <span className="subagent-drawer-pill">
                                  {item.model}
                                </span>
                              )}
                              {item.updatedAt && (
                                <span className="subagent-drawer-meta">
                                  {formatDateTime(item.updatedAt)}
                                </span>
                              )}
                            </div>
                            <span className="subagent-dir-card-name">
                              {item.role || item.label}
                            </span>
                            {item.lastAction && (
                              <span
                                className="subagent-dir-card-sub"
                                title={item.lastAction}
                              >
                                {item.lastAction}
                              </span>
                            )}
                          </div>
                          <ChevronRight size={15} />
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <header className="subagent-drawer-header">
              <div className="subagent-drawer-title">
                <div className="subagent-drawer-title-row">
                  <span className={`subagent-drawer-pill is-${status}`}>
                    {isWorking ? (
                      <LoaderCircle size={11} className="is-spinning" />
                    ) : status === "failed" ? (
                      <AlertCircle size={11} />
                    ) : (
                      <Bot size={11} />
                    )}
                    {statusText[status] || status}
                  </span>
                  <span className="subagent-drawer-pill">{providerLabel}</span>
                  {typeName && (
                    <span className="subagent-drawer-pill">{typeName}</span>
                  )}
                  {model && <span className="subagent-drawer-pill">{model}</span>}
                  {typeof spawnDepth === "number" && spawnDepth > 0 && (
                    <span className="subagent-drawer-pill">
                      {tr(`层级 ${spawnDepth}`, `Depth ${spawnDepth}`)}
                    </span>
                  )}
                </div>
                <h3 title={title}>{title}</h3>
                <div className="subagent-drawer-meta">
                  <span>ID: {selectedId}</span>
                  <span>
                    ·{" "}
                    {tr(
                      `共 ${totalSteps ?? steps.length} 步`,
                      `${totalSteps ?? steps.length} steps`,
                    )}
                  </span>
                  {isWorking && (
                    <span>· {tr("实时自动同步", "Auto-syncing live")}</span>
                  )}
                </div>
              </div>
              <div className="subagent-drawer-actions">
                {prefsToggleButton}
                <button
                  type="button"
                  className="subagent-drawer-icon-btn"
                  onClick={onRefresh}
                  disabled={loading}
                  title={tr("刷新工作流", "Refresh workflow")}
                >
                  <RefreshCw size={13} className={loading ? "is-spinning" : ""} />
                  {tr("刷新", "Refresh")}
                </button>
                <button
                  type="button"
                  className="subagent-drawer-icon-btn"
                  onClick={onClose}
                  aria-label={tr("关闭子代理工作流", "Close subagent workflow")}
                >
                  <X size={14} />
                </button>
              </div>
            </header>
            {prefsPanel}

            {items.length > 1 && (
              <div className="subagent-drawer-nav">
                <button
                  type="button"
                  className="subagent-drawer-icon-btn"
                  onClick={() => selectSubagent(null)}
                  title={tr("返回全部子代理列表", "Back to all subagents")}
                >
                  <ArrowLeft size={13} />
                  {tr(`子代理列表 (${totalCount})`, `All subagents (${totalCount})`)}
                </button>
                <select
                  className="subagent-switcher-select"
                  aria-label={tr("切换子代理", "Switch subagent")}
                  value={selectedId}
                  onChange={(event) => selectSubagent(event.target.value)}
                >
                  {items.map((item, idx) => (
                    <option key={item.id} value={item.id}>
                      {`${item.status === "working" ? "● " : "✓ "}${idx + 1}/${items.length} · ${item.role || item.label}${item.typeName ? ` (${item.typeName})` : ""}`}
                    </option>
                  ))}
                </select>
                <div className="subagent-drawer-nav-arrows">
                  <button
                    type="button"
                    className="subagent-drawer-icon-btn"
                    disabled={selectedIndex <= 0}
                    onClick={() =>
                      selectedIndex > 0 &&
                      selectSubagent(items[selectedIndex - 1].id)
                    }
                    aria-label={tr("上一个子代理", "Previous subagent")}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="subagent-drawer-icon-btn"
                    disabled={
                      selectedIndex < 0 || selectedIndex >= items.length - 1
                    }
                    onClick={() =>
                      selectedIndex >= 0 &&
                      selectedIndex < items.length - 1 &&
                      selectSubagent(items[selectedIndex + 1].id)
                    }
                    aria-label={tr("下一个子代理", "Next subagent")}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {steps.length > 0 && (
              <div className="subagent-drawer-filters">
                <div className="subagent-filter-pills" role="tablist">
                  <button
                    type="button"
                    className={`subagent-filter-pill${stepFilter === "all" ? " is-active" : ""}`}
                    onClick={() => setStepFilter("all")}
                  >
                    {tr(`全部 (${steps.length})`, `All (${steps.length})`)}
                  </button>
                  {counts.dialogue > 0 && (
                    <button
                      type="button"
                      className={`subagent-filter-pill${stepFilter === "dialogue" ? " is-active" : ""}`}
                      onClick={() => setStepFilter("dialogue")}
                    >
                      {tr(
                        `对话 & 结论 (${counts.dialogue})`,
                        `Messages (${counts.dialogue})`,
                      )}
                    </button>
                  )}
                  {counts.tools > 0 && (
                    <button
                      type="button"
                      className={`subagent-filter-pill${stepFilter === "tools" ? " is-active" : ""}`}
                      onClick={() => setStepFilter("tools")}
                    >
                      {tr(
                        `工具 & 命令 (${counts.tools})`,
                        `Tools (${counts.tools})`,
                      )}
                    </button>
                  )}
                  {counts.thinking > 0 && (
                    <button
                      type="button"
                      className={`subagent-filter-pill${stepFilter === "thinking" ? " is-active" : ""}`}
                      onClick={() => setStepFilter("thinking")}
                    >
                      {tr(`思考 (${counts.thinking})`, `Thinking (${counts.thinking})`)}
                    </button>
                  )}
                  {counts.errors > 0 && (
                    <button
                      type="button"
                      className={`subagent-filter-pill${stepFilter === "errors" ? " is-active" : ""}`}
                      onClick={() => setStepFilter("errors")}
                    >
                      {tr(`错误 (${counts.errors})`, `Errors (${counts.errors})`)}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="subagent-drawer-icon-btn"
                  onClick={() => setExpandAll((value) => !value)}
                  title={
                    expandAll
                      ? tr("折叠所有步骤", "Collapse all steps")
                      : tr("展开所有步骤", "Expand all steps")
                  }
                >
                  {expandAll ? (
                    <ChevronsDownUp size={13} />
                  ) : (
                    <ChevronsUpDown size={13} />
                  )}
                  {expandAll
                    ? tr("全部折叠", "Collapse all")
                    : tr("全部展开", "Expand all")}
                </button>
              </div>
            )}

            <div className="subagent-drawer-body">
              <div className="subagent-steps-list">
                {error && (
                  <div className="subagent-drawer-banner is-error" role="alert">
                    <span>{error}</span>
                  </div>
                )}
                {truncated && (
                  <div className="subagent-drawer-banner">
                    <span>
                      {tr(
                        `工作流步骤较多（共 ${totalSteps ?? steps.length} 步），当前保留初始任务与最新 ${steps.length} 步。`,
                        `Showing initial task + latest ${steps.length} of ${totalSteps ?? steps.length} workflow steps.`,
                      )}
                    </span>
                  </div>
                )}
                {hasMore && onLoadMore && (
                  <button
                    type="button"
                    className="subagent-drawer-load-more"
                    disabled={loading}
                    onClick={onLoadMore}
                  >
                    {loading
                      ? tr("加载中…", "Loading…")
                      : tr("加载更早的工作流步骤", "Load earlier workflow steps")}
                  </button>
                )}

                {loading && steps.length === 0 && !partial ? (
                  <div className="subagent-drawer-empty">
                    <LoaderCircle size={20} className="is-spinning" />
                    <span>
                      {tr("正在同步子代理工作流…", "Loading subagent workflow…")}
                    </span>
                  </div>
                ) : filteredSteps.length === 0 && !partial ? (
                  <div className="subagent-drawer-empty">
                    <Bot size={20} />
                    <span>
                      {steps.length > 0
                        ? tr("当前筛选条件下没有步骤", "No steps match this filter")
                        : isWorking
                          ? tr(
                              "子代理已启动，等待写入第一步工具调用或回复…",
                              "Subagent started; waiting for first tool call or reply…",
                            )
                          : tr(
                              "暂无可展示的子代理工作流记录。",
                              "No workflow steps recorded for this subagent.",
                            )}
                    </span>
                  </div>
                ) : (
                  filteredSteps.map((step) => {
                    const timeStr = formatTime(step.timestamp);
                    const expandKey = `${step.id}:${expandAll ? "1" : "0"}`;

                    if (step.kind === "prompt") {
                      return (
                        <details
                          key={expandKey}
                          className="subagent-step is-prompt"
                          open={expandAll || (step.text || "").length < 600}
                        >
                          <summary>
                            <span className="subagent-step-summary-left">
                              <Bot size={13} />
                              <strong>{tr("初始任务 Prompt", "Task prompt")}</strong>
                              <span className="subagent-step-summary-preview">
                                {(step.text || "").split(/\r?\n/)[0]}
                              </span>
                            </span>
                            <span className="subagent-step-summary-right">
                              {timeStr && <span>{timeStr}</span>}
                              <ChevronRight
                                size={13}
                                className="subagent-step-chevron"
                              />
                            </span>
                          </summary>
                          <div className="subagent-step-body">
                            <MarkdownBody
                              value={step.text || ""}
                              remoteHost={host}
                              remoteCwd={cwd}
                            />
                          </div>
                        </details>
                      );
                    }

                    if (step.kind === "thinking") {
                      const dur = formatDuration(step.durationMs);
                      return (
                        <details
                          key={expandKey}
                          className="subagent-step"
                          open={expandAll}
                        >
                          <summary>
                            <span className="subagent-step-summary-left">
                              <Brain size={13} />
                              <strong>{tr("思考过程", "Thinking")}</strong>
                              {dur && (
                                <span className="subagent-drawer-pill">{dur}</span>
                              )}
                              <span className="subagent-step-summary-preview">
                                {(step.text || "").split(/\r?\n/)[0]}
                              </span>
                            </span>
                            <span className="subagent-step-summary-right">
                              {timeStr && <span>{timeStr}</span>}
                              <ChevronRight
                                size={13}
                                className="subagent-step-chevron"
                              />
                            </span>
                          </summary>
                          <div className="subagent-step-body">
                            <pre className="subagent-step-pre">{step.text}</pre>
                          </div>
                        </details>
                      );
                    }

                    if (step.kind === "tool" || step.kind === "command") {
                      const isCommand = step.kind === "command";
                      const stepStatus = step.isError
                        ? "failed"
                        : step.status || "completed";
                      const handbackMd = extractHandbackMarkdown(step);
                      const previewLine =
                        step.summary ||
                        step.command?.split(/\r?\n/)[0] ||
                        step.title ||
                        "";
                      return (
                        <details
                          key={expandKey}
                          className="subagent-step"
                          open={expandAll || Boolean(handbackMd)}
                        >
                          <summary>
                            <span className="subagent-step-summary-left">
                              {stepStatus === "running" ? (
                                <LoaderCircle size={13} className="is-spinning" />
                              ) : stepStatus === "failed" ? (
                                <AlertCircle size={13} />
                              ) : isCommand ? (
                                <Terminal size={13} />
                              ) : (
                                <Wrench size={13} />
                              )}
                              <strong>
                                {step.toolName ||
                                  step.title ||
                                  (isCommand
                                    ? tr("命令", "Command")
                                    : tr("工具调用", "Tool"))}
                              </strong>
                              {previewLine && (
                                <span
                                  className="subagent-step-summary-preview"
                                  title={previewLine}
                                >
                                  {previewLine}
                                </span>
                              )}
                            </span>
                            <span className="subagent-step-summary-right">
                              {stepStatus === "completed" && (
                                <CheckCircle2 size={12} />
                              )}
                              {timeStr && <span>{timeStr}</span>}
                              <ChevronRight
                                size={13}
                                className="subagent-step-chevron"
                              />
                            </span>
                          </summary>
                          <div className="subagent-step-body">
                            {handbackMd && (
                              <div>
                                <div className="subagent-step-section-label">
                                  {tr("子代理回传结果", "Handback Summary")}
                                </div>
                                <MarkdownBody
                                  value={handbackMd}
                                  remoteHost={host}
                                  remoteCwd={cwd}
                                />
                              </div>
                            )}
                            {step.command && (
                              <div>
                                <div className="subagent-step-section-label">
                                  {tr("命令", "Command")}
                                </div>
                                <pre className="subagent-step-pre">
                                  {step.command}
                                </pre>
                              </div>
                            )}
                            {step.inputPreview && !handbackMd && (
                              <div>
                                <div className="subagent-step-section-label">
                                  {tr("参数 / 输入", "Input")}
                                </div>
                                <pre className="subagent-step-pre">
                                  {step.inputPreview}
                                </pre>
                              </div>
                            )}
                            {step.output && (
                              <div>
                                <div className="subagent-step-section-label">
                                  {step.isError
                                    ? tr("错误输出", "Error Output")
                                    : tr("执行输出", "Output")}
                                </div>
                                <pre
                                  className={`subagent-step-pre${step.isError ? " is-error" : ""}`}
                                >
                                  {step.output}
                                </pre>
                              </div>
                            )}
                          </div>
                        </details>
                      );
                    }

                    if (step.kind === "error") {
                      return (
                        <div key={step.id} className="subagent-step is-error">
                          <div className="subagent-step-head">
                            <strong>
                              <AlertCircle size={13} />
                              {step.title || tr("执行错误", "Error")}
                            </strong>
                            {timeStr && <span>{timeStr}</span>}
                          </div>
                          <pre className="subagent-step-pre is-error">
                            {step.text}
                          </pre>
                        </div>
                      );
                    }

                    if (step.kind === "note") {
                      return (
                        <div key={step.id} className="subagent-step is-note">
                          <span className="subagent-note-text">
                            {step.text || step.title}
                          </span>
                          {timeStr && (
                            <span className="subagent-note-time">{timeStr}</span>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div key={step.id} className="subagent-step is-assistant">
                        <div className="subagent-step-head">
                          <strong>
                            <Bot size={13} />
                            {step.title || tr("子代理输出", "Assistant")}
                          </strong>
                          {timeStr && <span>{timeStr}</span>}
                        </div>
                        <MarkdownBody
                          value={step.text || ""}
                          remoteHost={host}
                          remoteCwd={cwd}
                        />
                      </div>
                    );
                  })
                )}

                {partial && (
                  <div className="subagent-step is-assistant is-assistant-partial">
                    <div className="subagent-step-head">
                      <strong>
                        <LoaderCircle size={12} className="is-spinning" />
                        {tr("实时生成中…", "Streaming…")}
                      </strong>
                    </div>
                    <MarkdownBody
                      value={partial}
                      remoteHost={host}
                      remoteCwd={cwd}
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
