"use client";
import { useEffect } from "react";
import {
  AlertCircle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
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
};

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
  selectedId: string | null;
  onSelect: (id: string) => void;
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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !selectedId) return null;

  const selectedItem = items.find((item) => item.id === selectedId) || null;
  const status = activeStatus || selectedItem?.status || "completed";
  const isWorking = status === "working" || status === "running";
  const model = activeModel || selectedItem?.model || "";
  const typeName = activeTypeName || selectedItem?.typeName || "";
  const spawnDepth = activeSpawnDepth ?? selectedItem?.spawnDepth ?? null;
  const title =
    activeRole || selectedItem?.role || selectedItem?.label || selectedId;

  const statusText: Record<string, string> = {
    working: tr("工作中", "Working"),
    running: tr("运行中", "Running"),
    completed: tr("已完成", "Completed"),
    idle: tr("已结束", "Idle"),
    failed: tr("失败", "Failed"),
    stopped: tr("已停止", "Stopped"),
  };

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
                <span>
                  · {tr("实时自动同步", "Auto-syncing live")}
                </span>
              )}
            </div>
          </div>
          <div className="subagent-drawer-actions">
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

        {items.length > 1 && (
          <div
            className="subagent-drawer-siblings"
            role="tablist"
            aria-label={tr("切换子代理", "Switch subagent")}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === selectedId}
                className={`subagent-sibling-tab${item.id === selectedId ? " is-active" : ""}`}
                onClick={() => onSelect(item.id)}
                title={item.role || item.label}
              >
                <span className={`subagent-dot is-${item.status}`} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="subagent-drawer-body">
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
              <span>{tr("正在同步子代理工作流…", "Loading subagent workflow…")}</span>
            </div>
          ) : steps.length === 0 && !partial ? (
            <div className="subagent-drawer-empty">
              <Bot size={20} />
              <span>
                {isWorking
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
            steps.map((step) => {
              const timeStr = formatTime(step.timestamp);

              if (step.kind === "prompt") {
                return (
                  <details
                    key={step.id}
                    className="subagent-step is-prompt"
                    open={(step.text || "").length < 600}
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
                        <ChevronRight size={13} />
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
                  <details key={step.id} className="subagent-step">
                    <summary>
                      <span className="subagent-step-summary-left">
                        <Brain size={13} />
                        <strong>{tr("思考过程", "Thinking")}</strong>
                        {dur && <span className="subagent-drawer-pill">{dur}</span>}
                        <span className="subagent-step-summary-preview">
                          {(step.text || "").split(/\r?\n/)[0]}
                        </span>
                      </span>
                      <span className="subagent-step-summary-right">
                        {timeStr && <span>{timeStr}</span>}
                        <ChevronRight size={13} />
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
                    key={step.id}
                    className="subagent-step"
                    open={Boolean(handbackMd)}
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
                        <ChevronRight size={13} />
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
                          <pre className="subagent-step-pre">{step.command}</pre>
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
                    {timeStr && <span className="subagent-note-time">{timeStr}</span>}
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
      </aside>
    </div>
  );
}
