"use client";
import {
  dlcInvocationLabel,
  dlcOutcomeLabel,
  relativeTime,
  RemoteWorkdirLink,
  submissionStatusClass,
} from "@/features/workspace/shared";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Check,
  Copy,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import type { WorkspaceController } from "./use-workspace-controller";

export function SubmissionDialog({
  submissionTrackerOpen,
  setSubmissionTrackerOpen,
  submissionTracker,
  submissionWindowDays,
  setSubmissionWindowDays,
  refreshSubmissions,
  dlcCallCounts,
  submissionCounts,
  submissionWindowLabel,
  submissionHostFailures,
  auditedDlcCalls,
  locateSubmission,
  setShowDlcCandidates,
  showDlcCandidates,
  copy,
  copied,
}: Pick<
  WorkspaceController,
  | "submissionTrackerOpen"
  | "setSubmissionTrackerOpen"
  | "submissionTracker"
  | "submissionWindowDays"
  | "setSubmissionWindowDays"
  | "refreshSubmissions"
  | "dlcCallCounts"
  | "submissionCounts"
  | "submissionWindowLabel"
  | "submissionHostFailures"
  | "auditedDlcCalls"
  | "locateSubmission"
  | "setShowDlcCandidates"
  | "showDlcCandidates"
  | "copy"
  | "copied"
>) {
  return (
    <>
      {submissionTrackerOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSubmissionTrackerOpen(false);
            }
          }}
        >
          <section className="submission-modal" aria-label="实验提交归属追踪">
            <div className="submission-modal-head">
              <div>
                <h2>DLC 调用与实验归属</h2>
                <p>
                  提交主机：{submissionTracker.targetHostname || "未启用"} · 关联会话、Job 与运行状态。可在设置中更改。
                </p>
              </div>
              <div>
                <select
                  aria-label="DLC 提交追踪时间范围"
                  value={submissionWindowDays}
                  disabled={submissionTracker.scanning}
                  onChange={(event) => {
                    const days = Number(event.target.value);
                    setSubmissionWindowDays(days);
                    void refreshSubmissions(days);
                  }}
                >
                  <option value={1}>最近 24 小时</option>
                  <option value={7}>最近 7 天</option>
                  <option value={14}>最近 14 天</option>
                  <option value={30}>最近 30 天</option>
                  <option value={90}>最近 90 天</option>
                  <option value={0}>全部历史</option>
                </select>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={submissionTracker.scanning}
                  onClick={() => refreshSubmissions()}
                >
                  <RefreshCw
                    size={14}
                    className={submissionTracker.scanning ? "is-spinning" : ""}
                  />
                  {submissionTracker.scanning ? "扫描中" : "刷新"}
                </button>
                <button
                  type="button"
                  aria-label="关闭提交追踪"
                  onClick={() => setSubmissionTrackerOpen(false)}
                >
                  <X size={17} />
                </button>
              </div>
            </div>
            <div className="submission-summary">
              <div>
                <span>精确提交尝试</span>
                <strong>{dlcCallCounts.actual}</strong>
              </div>
              <div>
                <span>已关联 Job</span>
                <strong>{submissionTracker.items.length}</strong>
              </div>
              <div className="failed">
                <span>失败 / 终止</span>
                <strong>{submissionCounts.failed}</strong>
              </div>
              <div className="queued">
                <span>排队</span>
                <strong>{submissionCounts.queued}</strong>
              </div>
              <div className="running">
                <span>运行中</span>
                <strong>{submissionCounts.running}</strong>
              </div>
              <small>
                {submissionTracker.scannedAt
                  ? `${submissionWindowLabel} · 更新于 ${relativeTime(submissionTracker.scannedAt)}`
                  : submissionTracker.scanning
                    ? `正在扫描${submissionWindowDays ? `最近 ${submissionWindowDays} 天` : "全部历史"}…`
                    : "尚未扫描"}
              </small>
            </div>
            <div className="submission-modal-body">
              {submissionTracker.alerts.map((alert) => (
                <div
                  className="submission-alert"
                  key={`${alert.host}:${alert.sessionId}`}
                >
                  <AlertTriangle size={17} />
                  <div>
                    <strong>{alert.sessionTheme}</strong>
                    <span>
                      {alert.failed}/{alert.total} 已失败或终止
                      {alert.queued > 0
                        ? `，但仍有 ${alert.queued} 个排队项`
                        : "，整批任务达到高失败率"}{" "}
                      · {alert.host} · Session {alert.sessionId.slice(0, 8)}
                    </span>
                  </div>
                </div>
              ))}
              {submissionTracker.error && (
                <div className="submission-empty error">
                  <AlertTriangle size={16} />
                  {submissionTracker.error}
                </div>
              )}
              {submissionHostFailures.length > 0 && (
                <div className="submission-scan-warning">
                  <AlertTriangle size={16} />
                  <div>
                    <strong>本次结果不完整</strong>
                    {submissionHostFailures.map((host) => (
                      <span key={host.host}>
                        {host.host}：{host.error}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {submissionTracker.calls.length > 0 && (
                <details className="dlc-call-audit" open>
                  <summary>
                    <span>完整 DLC 调用审计</span>
                    <strong>
                      {dlcCallCounts.actual} 次精确提交尝试 ·{" "}
                      {auditedDlcCalls.explicitAttempts.length} 次显式 wrapper
                      尝试 · {dlcCallCounts.candidates} 条待复核证据
                    </strong>
                  </summary>
                  <p>
                    直接 CLI 和 Python subprocess 调用按工具 call_id
                    记录；提交脚本只有观察到 SUBMITTING 或 Job ID
                    才计入精确提交尝试。仅带 `--submit` 的 wrapper
                    会保留为显式尝试， 不冒充底层 `dlc submit` 已执行。
                  </p>
                  <div className="dlc-call-list">
                    {auditedDlcCalls.confirmed.map((call) => {
                      const callClass =
                        call.outcome === "failed" ||
                        call.outcome === "unresolved"
                          ? "failed"
                          : call.outcome === "submitted"
                            ? "submitted"
                            : call.outcome === "inspection" ||
                                call.outcome === "dry-run"
                              ? "inspection"
                              : "unknown";
                      return (
                        <article
                          className={`dlc-call-row ${callClass}`}
                          key={`${call.host}:${call.id}`}
                        >
                          <div className="dlc-call-head">
                            <div>
                              <strong>
                                {dlcInvocationLabel[call.invocationKind]}
                                {call.isSubagent ? " · subagent" : ""}
                              </strong>
                              <span>
                                {call.host} · {relativeTime(call.timestamp)} ·{" "}
                                {call.callId || `rollout line ${call.line}`}
                              </span>
                            </div>
                            <span>{dlcOutcomeLabel[call.outcome]}</span>
                          </div>
                          <div className="dlc-call-owner">
                            <strong>{call.sessionTheme}</strong>
                            <code>{call.sessionId}</code>
                            {call.parentThreadId && (
                              <small>parent {call.parentThreadId}</small>
                            )}
                            <RemoteWorkdirLink
                              host={call.host}
                              cwd={call.cwd}
                            />
                          </div>
                          <div className="dlc-call-metrics">
                            <span>
                              观察调用 {call.observedInvocations}
                              {call.syntacticInvocations !==
                              call.observedInvocations
                                ? `（静态 ${call.syntacticInvocations}）`
                                : ""}
                            </span>
                            <span>
                              exit{" "}
                              {call.exitCode === null
                                ? "unknown"
                                : call.exitCode}
                            </span>
                            <span>Job {call.jobIds.length || "未解析"}</span>
                            <small>
                              {call.rolloutPath}:{call.line}
                              {call.resultLine
                                ? ` → output:${call.resultLine}`
                                : ""}
                            </small>
                          </div>
                          {call.jobIds.length > 0 && (
                            <div className="dlc-call-jobs">
                              {call.jobIds.map((jobId) => (
                                <code key={jobId}>{jobId}</code>
                              ))}
                            </div>
                          )}
                          <details>
                            <summary>命令与返回证据</summary>
                            {call.command && <code>{call.command}</code>}
                            {call.resultEvidence && (
                              <pre>{call.resultEvidence}</pre>
                            )}
                          </details>
                          <button
                            type="button"
                            onClick={() => locateSubmission(call)}
                          >
                            <BookOpen size={13} />
                            {call.active
                              ? "打开调用 Session"
                              : "在 History 定位"}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                  {auditedDlcCalls.candidates.length > 0 && (
                    <details
                      className="launch-evidence dlc-call-candidates"
                      onToggle={(event) =>
                        setShowDlcCandidates(event.currentTarget.open)
                      }
                    >
                      <summary>
                        查看未计入精确提交尝试的 wrapper、帮助与 dry-run（
                        {auditedDlcCalls.candidates.length}）
                      </summary>
                      <p>
                        其中 {auditedDlcCalls.explicitAttempts.length} 条带有
                        `--submit` / `SUBMIT=1` 等显式提交参数，但没有 Job 或
                        SUBMITTING
                        输出；所有记录均保留用于人工复核，不占“精确提交尝试”
                        计数。
                      </p>
                      {showDlcCandidates &&
                        auditedDlcCalls.candidates.map((call) => (
                          <div
                            className="dlc-candidate-row"
                            key={`${call.host}:${call.id}`}
                          >
                            <span>{dlcOutcomeLabel[call.outcome]}</span>
                            <strong>
                              {call.host} · {call.sessionTheme} ·{" "}
                              {dlcInvocationLabel[call.invocationKind]}
                            </strong>
                            <small>
                              {relativeTime(call.timestamp)} ·{" "}
                              {call.callId || `rollout line ${call.line}`}
                            </small>
                            <code>{call.command}</code>
                          </div>
                        ))}
                    </details>
                  )}
                </details>
              )}
              {submissionTracker.items.length > 0 ? (
                <div className="submission-list">
                  {submissionTracker.items.slice(0, 100).map((item) => {
                    const statusClass = submissionStatusClass(item.status);
                    return (
                      <article key={`${item.host}:${item.jobId}`}>
                        <div className="submission-job-head">
                          <div>
                            <strong>{item.name}</strong>
                            <code>{item.jobId}</code>
                          </div>
                          <span className={statusClass}>
                            {item.status || "Unknown"}
                          </span>
                        </div>
                        <div className="submission-owner">
                          <span>提交 Session</span>
                          <strong>{item.sessionTheme}</strong>
                          <code>
                            {item.host} · {item.sessionId}
                          </code>
                          <RemoteWorkdirLink host={item.host} cwd={item.cwd} />
                        </div>
                        <div className="submission-job-meta">
                          <span>{relativeTime(item.submittedAt)}</span>
                          <span>
                            {item.active ? "Session 仍活动" : "Session 已结束"}
                          </span>
                          <span>
                            {item.ownershipSource === "output-only"
                              ? "仅输出证据，归属待核对"
                              : "命令与返回值精确归属"}
                          </span>
                          <span>{item.reason || "无 ReasonCode"}</span>
                        </div>
                        {item.message && (
                          <p className="submission-message">{item.message}</p>
                        )}
                        <details>
                          <summary>原始提交证据</summary>
                          <code>{item.evidence}</code>
                          <small>
                            {item.rolloutPath}:{item.line}
                          </small>
                        </details>
                        <div className="submission-card-actions">
                          <button
                            type="button"
                            onClick={() => locateSubmission(item)}
                          >
                            <BookOpen size={13} />
                            {item.active
                              ? "打开提交 Session"
                              : "在 History 定位"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              copy(item.sessionId, `submission-${item.jobId}`)
                            }
                          >
                            {copied === `submission-${item.jobId}` ? (
                              <Check size={13} />
                            ) : (
                              <Copy size={13} />
                            )}
                            复制 Session ID
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="submission-empty">
                  {submissionTracker.scanning ? (
                    <LoaderCircle size={18} className="is-spinning" />
                  ) : (
                    <BarChart3 size={18} />
                  )}
                  <strong>
                    {submissionTracker.scanning
                      ? "正在建立 Job → Session 归属链"
                      : `${submissionWindowLabel}内没有解析到 DLC Job`}
                  </strong>
                  <span>扫描不会提交、取消或修改任何远端任务。</span>
                </div>
              )}
              {submissionTracker.launches.length > 0 && (
                <details className="launch-evidence">
                  <summary>
                    其他训练/调度命令证据（{submissionTracker.launches.length}）
                  </summary>
                  {submissionTracker.launches
                    .slice(0, 30)
                    .map((launch, index) => (
                      <div
                        key={`${launch.host}:${launch.sessionId}:${launch.timestamp}:${index}`}
                      >
                        <span>{launch.kind}</span>
                        <strong>
                          {launch.host} · {launch.sessionId.slice(0, 8)} ·{" "}
                          {relativeTime(launch.timestamp)}
                        </strong>
                        <code>{launch.command}</code>
                      </div>
                    ))}
                </details>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
