"use client";
import {
  managementKey,
  MarkdownBody,
  priorityLabel,
} from "@/features/workspace/shared";
import type { SessionManagement } from "@/features/workspace/types";
import {
  BarChart3,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";
import type { WorkspaceController } from "./use-workspace-controller";

export function SessionSummaryPanel({
  selectedSummary,
  selectedAgent,
  selectedSummaryExpanded,
  setInspectorSectionOpen,
  selectedManagement,
  busyAction,
  updatePriority,
  reloadModelsForHost,
  summarizeSession,
  themeEdit,
  setThemeEdit,
  saveTheme,
}: Pick<
  WorkspaceController,
  | "selectedSummary"
  | "selectedAgent"
  | "selectedSummaryExpanded"
  | "setInspectorSectionOpen"
  | "selectedManagement"
  | "busyAction"
  | "updatePriority"
  | "reloadModelsForHost"
  | "summarizeSession"
  | "themeEdit"
  | "setThemeEdit"
  | "saveTheme"
>) {
  if (!selectedAgent) return null;
  return (
    <>
      {selectedSummary && (
        <details
          className="detail-section summary-section inspector-collapsible"
          key={`summary:${managementKey(selectedAgent)}`}
          open={selectedSummaryExpanded}
          onToggle={(event) => {
            const sectionKey = `${managementKey(selectedAgent)}:summary`;
            const open = event.currentTarget.open;
            setInspectorSectionOpen((current) =>
              current[sectionKey] === open
                ? current
                : { ...current, [sectionKey]: open },
            );
          }}
        >
          <summary className="section-title-row collapsible-section-summary">
            <span className="detail-label">Session 名称、摘要与优先级</span>
            <span>
              {selectedManagement.displayName
                ? "手动命名"
                : selectedSummary.source === "codex"
                  ? "Codex 生成"
                  : selectedSummary.source === "manual"
                    ? "手动主题"
                    : "rollout 草稿"}
            </span>
            <ChevronRight size={15} className="section-chevron" />
          </summary>
          {selectedSummaryExpanded && (
            <>
              {!selectedAgent.historical && (
                <>
                  <div className="session-management-controls">
                    <label>
                      <span>资源优先级</span>
                      <select
                        value={selectedManagement.priority || "P2"}
                        disabled={
                          !selectedAgent.rollout ||
                          busyAction ===
                            `priority:${managementKey(selectedAgent)}`
                        }
                        onChange={(event) =>
                          updatePriority(
                            selectedAgent,
                            event.target.value as SessionManagement["priority"],
                          )
                        }
                      >
                        {Object.entries(priorityLabel).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="inline-action"
                        title="重新读取当前账号的可用模型"
                        onClick={() => reloadModelsForHost(selectedAgent.host)}
                      >
                        <RefreshCw size={14} /> 刷新模型
                      </button>
                    </label>
                    <button
                      className="secondary-action"
                      disabled={
                        !selectedAgent.rollout ||
                        busyAction === `summary:${managementKey(selectedAgent)}`
                      }
                      onClick={() => summarizeSession(selectedAgent)}
                    >
                      {busyAction ===
                      `summary:${managementKey(selectedAgent)}` ? (
                        <LoaderCircle size={15} className="is-spinning" />
                      ) : (
                        <Sparkles size={15} />
                      )}
                      AI 更新摘要
                    </button>
                  </div>
                  <div className="theme-editor">
                    <input
                      aria-label="Session 名称"
                      value={
                        themeEdit?.key === managementKey(selectedAgent)
                          ? themeEdit.value
                          : selectedSummary.theme
                      }
                      onChange={(event) =>
                        setThemeEdit({
                          key: managementKey(selectedAgent),
                          value: event.target.value,
                        })
                      }
                    />
                    <button
                      className="secondary-action"
                      disabled={
                        !selectedAgent.rollout ||
                        busyAction === `theme:${managementKey(selectedAgent)}`
                      }
                      onClick={() => saveTheme(selectedAgent)}
                    >
                      {busyAction ===
                      `theme:${managementKey(selectedAgent)}` ? (
                        <LoaderCircle size={15} className="is-spinning" />
                      ) : (
                        <Save size={15} />
                      )}
                      保存名称
                    </button>
                  </div>
                </>
              )}
              <MarkdownBody
                className="summary-markdown summary-objective"
                value={selectedSummary.objective}
                remoteHost={selectedAgent.host}
                remoteCwd={selectedAgent.cwd}
              />
              <div className="summary-progress">
                <BarChart3 size={15} />
                <MarkdownBody
                  className="summary-markdown"
                  value={selectedSummary.progress || "暂无进度汇报"}
                  remoteHost={selectedAgent.host}
                  remoteCwd={selectedAgent.cwd}
                />
              </div>
              {selectedSummary.nextStep && (
                <MarkdownBody
                  className="summary-markdown summary-next"
                  value={`**下一步：** ${selectedSummary.nextStep}`}
                  remoteHost={selectedAgent.host}
                  remoteCwd={selectedAgent.cwd}
                />
              )}
              <p className="summary-cost-note">
                {selectedAgent.historical
                  ? "这是扫描得到的历史摘要；完整内容请在下方 Dialogue 中查看。"
                  : "“AI 更新摘要”会在对应 SSH 主机额外运行一次 ephemeral Codex 并消耗少量额度；你手动设置的 Session 名称不会被覆盖。"}
              </p>
            </>
          )}
        </details>
      )}
    </>
  );
}
