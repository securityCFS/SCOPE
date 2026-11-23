"use client";
import {
  dialogueCategoryLabel,
  dialoguePreview,
  dialogueTime,
  managementKey,
  MarkdownBody,
} from "@/features/workspace/shared";
import type { DialogueCategory } from "@/features/workspace/types";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  CircleDot,
  Copy,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { WorkspaceController } from "./use-workspace-controller";

export function DialogueTimeline({
  selectedAgent,
  selectedDialogueExpanded,
  setInspectorSectionOpen,
  selectedDialogue,
  selectedDialogueLoading,
  busyAction,
  copyRawContext,
  copied,
  setDialogueRefresh,
  selectedDialogueError,
  dialogueFilters,
  toggleDialogueFilter,
  dialogueCategoryCounts,
  setDialogueOrder,
  dialogueOrder,
  setVisibleDialogueExpanded,
  renderedDialogueEvents,
  visibleDialogueEvents,
  expandedDialogueEvents,
  setDialogueEventExpanded,
  operatorName,
  dialogueLoadingMore,
  loadOlderDialogue,
}: Pick<
  WorkspaceController,
  | "selectedAgent"
  | "selectedDialogueExpanded"
  | "setInspectorSectionOpen"
  | "selectedDialogue"
  | "selectedDialogueLoading"
  | "busyAction"
  | "copyRawContext"
  | "copied"
  | "setDialogueRefresh"
  | "selectedDialogueError"
  | "dialogueFilters"
  | "toggleDialogueFilter"
  | "dialogueCategoryCounts"
  | "setDialogueOrder"
  | "dialogueOrder"
  | "setVisibleDialogueExpanded"
  | "renderedDialogueEvents"
  | "visibleDialogueEvents"
  | "expandedDialogueEvents"
  | "setDialogueEventExpanded"
  | "operatorName"
  | "dialogueLoadingMore"
  | "loadOlderDialogue"
>) {
  if (!selectedAgent) return null;
  return (
    <details
      className="detail-section dialogue-section inspector-collapsible"
      key={`dialogue:${managementKey(selectedAgent)}`}
      open={selectedDialogueExpanded}
      onToggle={(event) => {
        const sectionKey = `${managementKey(selectedAgent)}:dialogue`;
        const open = event.currentTarget.open;
        setInspectorSectionOpen((current) =>
          current[sectionKey] === open
            ? current
            : { ...current, [sectionKey]: open },
        );
      }}
    >
      <summary className="section-title-row dialogue-title-row collapsible-section-summary">
        <span className="detail-label">完整 Dialogue / Timeline</span>
        <span>
          {selectedDialogue
            ? `${selectedDialogue.events.length} 条已加载`
            : selectedDialogueLoading
              ? "读取中"
              : "按需展开"}
        </span>
        <ChevronRight size={15} className="section-chevron" />
      </summary>
      {selectedDialogueExpanded && (
        <>
          <div className="dialogue-section-actions">
            <button
              type="button"
              className="dialogue-refresh-button"
              disabled={
                !selectedAgent.rollout ||
                busyAction === `raw-context:${managementKey(selectedAgent)}`
              }
              onClick={() => copyRawContext(selectedAgent)}
              title="复制当前 compact 边界后的 Codex rollout 原始上下文记录"
            >
              {busyAction === `raw-context:${managementKey(selectedAgent)}` ? (
                <LoaderCircle size={13} className="is-spinning" />
              ) : copied === `raw-context:${managementKey(selectedAgent)}` ? (
                <Check size={13} />
              ) : (
                <Copy size={13} />
              )}
              复制 Context JSON
            </button>
            <button
              type="button"
              className="dialogue-refresh-button"
              disabled={!selectedAgent.rollout || selectedDialogueLoading}
              onClick={() => setDialogueRefresh((value) => value + 1)}
            >
              <RefreshCw
                size={13}
                className={selectedDialogueLoading ? "is-spinning" : ""}
              />
              刷新
            </button>
          </div>
          <p className="dialogue-note">
            首次只从 JSONL 尾部读取最近 10
            条事件；点击“加载更早消息”才继续向前扫描。
            命令与工具输出默认折叠，未记录或加密的内部思维链不会被伪造。
          </p>

          {selectedDialogueLoading && (
            <div className="dialogue-loading">
              <LoaderCircle size={15} className="is-spinning" />
              正在通过 SSH 读取最近 10 条 rollout 事件…
            </div>
          )}

          {selectedDialogueError && !selectedDialogueLoading && (
            <div className="dialogue-error">
              <AlertTriangle size={15} />
              <span>{selectedDialogueError}</span>
            </div>
          )}

          {selectedDialogue && !selectedDialogueLoading && (
            <>
              <div className="dialogue-controls">
                <div
                  className="dialogue-filter-group"
                  aria-label="History 分类过滤"
                >
                  {(
                    Object.keys(dialogueCategoryLabel) as DialogueCategory[]
                  ).map((category) => (
                    <button
                      type="button"
                      className={dialogueFilters[category] ? "active" : ""}
                      aria-pressed={dialogueFilters[category]}
                      key={category}
                      onClick={() => toggleDialogueFilter(category)}
                    >
                      {dialogueCategoryLabel[category]}
                      <span>{dialogueCategoryCounts[category]}</span>
                    </button>
                  ))}
                </div>
                <div className="dialogue-view-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setDialogueOrder((current) =>
                        current === "desc" ? "asc" : "desc",
                      )
                    }
                  >
                    {dialogueOrder === "desc" ? "最新在前" : "最早在前"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleDialogueExpanded(true)}
                  >
                    展开可见
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleDialogueExpanded(false)}
                  >
                    折叠可见
                  </button>
                </div>
              </div>
              <div className="dialogue-stats">
                <span>
                  已挂载 {renderedDialogueEvents.length} /{" "}
                  {visibleDialogueEvents.length}
                </span>
                <span>
                  对话{" "}
                  {(selectedDialogue.counts.user || 0) +
                    (selectedDialogue.counts.assistant || 0)}
                </span>
                <span>
                  中间过程{" "}
                  {(selectedDialogue.counts.reasoning || 0) +
                    (selectedDialogue.counts.intermediate || 0)}
                </span>
                <span>工具 {selectedDialogue.toolEventCount}</span>
                <span>
                  本次扫描 {selectedDialogue.totalLines} 行 ·{" "}
                  {Math.max(
                    1,
                    Math.round(selectedDialogue.scannedBytes / 1024),
                  )}{" "}
                  KiB
                </span>
              </div>
              {(selectedDialogue.omittedToolEvents > 0 ||
                selectedDialogue.hiddenReasoningCount > 0) && (
                <p className="dialogue-coverage-note">
                  {selectedDialogue.omittedToolEvents > 0 &&
                    `为保证页面流畅，较早的 ${selectedDialogue.omittedToolEvents} 条工具事件未渲染；全部用户/助手消息仍保留。`}
                  {selectedDialogue.omittedToolEvents > 0 &&
                    selectedDialogue.hiddenReasoningCount > 0 &&
                    " "}
                  {selectedDialogue.hiddenReasoningCount > 0 &&
                    `${selectedDialogue.hiddenReasoningCount} 个 reasoning 事件只有加密内容、没有可读 summary，因此不展示。`}
                </p>
              )}
              <div className="dialogue-list">
                {!visibleDialogueEvents.length && (
                  <div className="dialogue-empty">
                    当前过滤条件下没有 History 事件。
                  </div>
                )}
                {renderedDialogueEvents.map((event) =>
                  event.kind === "command" || event.kind === "tool" ? (
                    <details
                      className={`dialogue-tool ${event.kind}`}
                      key={event.id}
                      open={expandedDialogueEvents.has(event.id)}
                      onToggle={(toggleEvent) =>
                        setDialogueEventExpanded(
                          event.id,
                          toggleEvent.currentTarget.open,
                        )
                      }
                    >
                      <summary>
                        <span className="dialogue-event-icon">
                          {event.kind === "command" ? (
                            <SquareTerminal size={14} />
                          ) : (
                            <Wrench size={14} />
                          )}
                        </span>
                        <span className="dialogue-event-heading">
                          <strong>{event.title}</strong>
                          <code>{dialoguePreview(event)}</code>
                        </span>
                        <time>{dialogueTime(event.timestamp)}</time>
                        <ChevronRight size={14} className="dialogue-chevron" />
                      </summary>
                      <div className="dialogue-tool-body">
                        {event.command && (
                          <>
                            <span>COMMAND</span>
                            <pre>{event.command}</pre>
                          </>
                        )}
                        {event.text && event.text !== event.command && (
                          <>
                            <span>INPUT</span>
                            <pre>{event.text}</pre>
                          </>
                        )}
                        {event.output && (
                          <>
                            <span>OUTPUT · {event.status || "done"}</span>
                            <pre>{event.output}</pre>
                          </>
                        )}
                      </div>
                    </details>
                  ) : (
                    <details
                      className={`dialogue-event ${event.kind}`}
                      key={event.id}
                      open={expandedDialogueEvents.has(event.id)}
                      onToggle={(toggleEvent) =>
                        setDialogueEventExpanded(
                          event.id,
                          toggleEvent.currentTarget.open,
                        )
                      }
                    >
                      <summary>
                        <span className="dialogue-event-icon">
                          {event.kind === "reasoning" ? (
                            <Brain size={14} />
                          ) : event.kind === "user" ||
                            event.kind === "assistant" ? (
                            <MessageSquareText size={14} />
                          ) : event.kind === "error" ? (
                            <AlertTriangle size={14} />
                          ) : event.kind === "intermediate" ? (
                            <Sparkles size={14} />
                          ) : (
                            <CircleDot size={14} />
                          )}
                        </span>
                        <span className="dialogue-event-heading">
                          <strong>
                            {event.kind === "user" ? operatorName : event.title}
                          </strong>
                          <code>{dialoguePreview(event)}</code>
                        </span>
                        {event.phase && <em>{event.phase}</em>}
                        <time>{dialogueTime(event.timestamp)}</time>
                        <ChevronRight size={14} className="dialogue-chevron" />
                      </summary>
                      <div className="dialogue-event-body">
                        {event.text ? (
                          <MarkdownBody
                            value={event.text}
                            remoteHost={selectedAgent.host}
                            remoteCwd={selectedAgent.cwd}
                          />
                        ) : (
                          <span>该事件没有额外正文。</span>
                        )}
                      </div>
                    </details>
                  ),
                )}
                {renderedDialogueEvents.length <
                  visibleDialogueEvents.length && (
                  <div className="dialogue-load-progress">
                    继续向下滚动加载剩余{" "}
                    {visibleDialogueEvents.length -
                      renderedDialogueEvents.length}{" "}
                    条事件
                  </div>
                )}
                {selectedDialogue.hasMore &&
                  renderedDialogueEvents.length >=
                    visibleDialogueEvents.length && (
                    <button
                      type="button"
                      className="dialogue-load-more"
                      disabled={dialogueLoadingMore}
                      onClick={loadOlderDialogue}
                    >
                      {dialogueLoadingMore ? (
                        <LoaderCircle size={14} className="is-spinning" />
                      ) : (
                        <BookOpen size={14} />
                      )}
                      {dialogueLoadingMore
                        ? "正在扫描更早记录…"
                        : "加载更早 10 条消息"}
                    </button>
                  )}
                {!selectedDialogue.hasMore && (
                  <div className="dialogue-load-progress">
                    已到达这条 rollout 的最早记录
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </details>
  );
}
