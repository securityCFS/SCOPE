"use client";
import { MarkdownBody } from "@/features/workspace/shared";
import { Bot, ChevronRight, LoaderCircle, Send, X } from "lucide-react";
import type { WorkspaceController } from "./use-workspace-controller";

export function ResearchAssistant({
  researchAssistantOpen,
  setResearchAssistantOpen,
  researchAssistantBusy,
  researchAssistantMessagesRef,
  researchAssistantMessages,
  openResearchAssistantCandidate,
  setResearchAssistantDraft,
  askResearchAssistant,
  researchAssistantDraft,
}: Pick<
  WorkspaceController,
  | "researchAssistantOpen"
  | "setResearchAssistantOpen"
  | "researchAssistantBusy"
  | "researchAssistantMessagesRef"
  | "researchAssistantMessages"
  | "openResearchAssistantCandidate"
  | "setResearchAssistantDraft"
  | "askResearchAssistant"
  | "researchAssistantDraft"
>) {
  return (
    <>
      {researchAssistantOpen && (
        <aside
          className="research-assistant-panel"
          aria-label="SCOPE 科研检索助手"
        >
          <div className="research-assistant-head">
            <span className="research-assistant-icon">
              <Bot size={17} />
            </span>
            <div>
              <strong>查找会话</strong>
              <span>搜索本机与远程设备上的实验和任务</span>
            </div>
            <button
              type="button"
              aria-label="关闭科研检索助手"
              onClick={() => setResearchAssistantOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div
            className="research-assistant-messages"
            aria-live="polite"
            aria-busy={researchAssistantBusy}
            ref={researchAssistantMessagesRef}
          >
            {researchAssistantMessages.map((message) => (
              <div
                className={`research-assistant-message ${message.role}`}
                key={message.id}
              >
                {message.role === "assistant" ? (
                  <MarkdownBody
                    value={message.text}
                  />
                ) : (
                  <p>{message.text}</p>
                )}
                {message.role === "assistant" &&
                  message.model &&
                  message.id !== "welcome" && (
                    <span className="research-assistant-model">
                      {message.model === "codex" ? "Codex 整理" : "按相关度排序"}
                    </span>
                  )}
                {message.warning && (
                  <span className="research-assistant-warning">
                    回答整理暂不可用，已展示检索结果：{message.warning}
                  </span>
                )}
                {message.scans && (
                  <details className="research-search-coverage">
                    <summary>已检索 {message.scans.filter((scan) => !scan.error).length} / {message.scans.length} 台设备
                      {message.scans.some((scan) => scan.error) ? " · 部分设备未完成" : ""}
                    </summary>
                    {message.scans.map((scan) => <p key={scan.host}>
                      <strong>{scan.host === "@local" ? "本机" : scan.host}</strong> · {scan.error || `${scan.filesScanned} / ${scan.totalFiles} 个记录 · ${scan.matches} 个候选`}
                    </p>)}
                  </details>
                )}
                {(message.candidates?.length || 0) > 0 && (
                  <div className="research-assistant-candidates">
                    {message.candidates?.slice(0, 6).map((candidate, index) => (
                      <button
                        type="button"
                        key={`${candidate.host}:${candidate.sessionId}`}
                        onClick={() =>
                          openResearchAssistantCandidate(candidate)
                        }
                      >
                        <span className="research-candidate-rank">
                          [{index + 1}]
                        </span>
                        <span className="research-candidate-main">
                          <strong>{candidate.theme}</strong>
                          <code>
                            {candidate.host} · {candidate.sessionId.slice(0, 8)}
                            {candidate.active ? " · 活动中" : " · 历史"}
                          </code>
                          <small>{candidate.cwd}</small>
                          <em>命中：{candidate.matchedTerms.join(" · ")}</em>
                          {candidate.evidence[0]?.text && (
                            <p>{candidate.evidence[0].text}</p>
                          )}
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {researchAssistantBusy && (
              <div className="research-assistant-thinking">
                <LoaderCircle size={15} className="is-spinning" />
                <span>正在查找相关会话…</span>
              </div>
            )}
          </div>
          {researchAssistantMessages.length === 1 && (
            <div className="research-assistant-suggestions" aria-label="常用检索建议">
              <button
                type="button"
                onClick={() =>
                  setResearchAssistantDraft(
                    "我现在想确认使用 reward regressed goal z 去做 QGF 的 Session 是哪一个？",
                  )
                }
              >
                查找 QGF 实验所在的会话
              </button>
              <button
                type="button"
                onClick={() =>
                  setResearchAssistantDraft(
                    "最近哪个 Session 提交了失败后仍在排队的 DLC 任务？",
                  )
                }
              >
                排查异常排队的 DLC 任务
              </button>
            </div>
          )}
          <form
            className="research-assistant-form"
            onSubmit={(event) => {
              event.preventDefault();
              askResearchAssistant();
            }}
          >
            <textarea
              value={researchAssistantDraft}
              maxLength={800}
              rows={1}
              aria-label="搜索会话"
              placeholder="输入实验名称、目录或任务关键词…"
              onChange={(event) =>
                setResearchAssistantDraft(event.target.value)
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  askResearchAssistant();
                }
              }}
            />
            <button
              type="submit"
              aria-label="发送给科研检索助手"
              disabled={researchAssistantBusy || !researchAssistantDraft.trim()}
            >
              {researchAssistantBusy ? (
                <LoaderCircle size={15} className="is-spinning" />
              ) : (
                <Send size={14} />
              )}
            </button>
          </form>
          <p className="research-assistant-footnote">
            只读搜索 · 不改动运行中的会话
          </p>
        </aside>
      )}
    </>
  );
}
