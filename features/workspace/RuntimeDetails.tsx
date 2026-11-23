"use client";
import {
  duration,
  InspectorModule,
  relatedPaneAttachCommand,
  relativeTime,
  RemoteWorkdirLink,
  submissionStatusClass,
  workloadConfidenceLabel,
} from "@/features/workspace/shared";
import { BookOpen, Check, Copy, Layers3 } from "lucide-react";
import type { WorkspaceController } from "./use-workspace-controller";

export function RuntimeDetails({
  selectedInspectorKey,
  selectedAgent,
  copy,
  copied,
  locateSubmission,
}: Pick<
  WorkspaceController,
  | "selectedInspectorKey"
  | "selectedAgent"
  | "copy"
  | "copied"
  | "locateSubmission"
>) {
  if (!selectedAgent) return null;
  return (
    <InspectorModule
      key={`${selectedInspectorKey}:runtime`}
      title="Session 创建的运行任务"
      meta={
        <>
          {(selectedAgent.relatedPanes?.length || 0) +
            (selectedAgent.localWorkloads?.length || 0) +
            (selectedAgent.remoteJobs?.length || 0)}{" "}
          条关联
        </>
      }
      className="runtime-relations-section"
    >
      {(selectedAgent.relatedPanes?.length || 0) > 0 && (
        <div className="runtime-relation-group">
          <strong className="runtime-relation-title">tmux / 本地终端</strong>
          {selectedAgent.relatedPanes?.map((pane) => {
            const command = relatedPaneAttachCommand(selectedAgent.host, pane);
            const key = `related-pane:${pane.session}:${pane.pane}`;
            return (
              <article
                className="runtime-relation-card tmux"
                key={`${pane.session}:${pane.pane}`}
              >
                <div className="runtime-relation-head">
                  <div>
                    <strong>
                      {pane.session}:{pane.pane}
                    </strong>
                    <code>{pane.tty || "无 TTY"}</code>
                  </div>
                  <span>{pane.dead ? "已结束" : "运行中"}</span>
                </div>
                <code className="runtime-command">
                  {pane.command || "shell"}
                </code>
                <RemoteWorkdirLink
                  host={selectedAgent.host}
                  cwd={pane.cwd || selectedAgent.cwd}
                />
                <div className="runtime-relation-actions">
                  <button type="button" onClick={() => copy(command, key)}>
                    {copied === key ? <Check size={13} /> : <Copy size={13} />}
                    复制 attach
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {(selectedAgent.localWorkloads?.length || 0) > 0 && (
        <div className="runtime-relation-group">
          <strong className="runtime-relation-title">
            同一 SSH 主机上的后台训练 / 评测
          </strong>
          {selectedAgent.localWorkloads?.map((workload) => (
            <article
              className="runtime-relation-card workload"
              key={`${workload.groupId}:${workload.pid}`}
            >
              <div className="runtime-relation-head">
                <div>
                  <strong>
                    {workload.kind === "evaluation" ? "评测" : "训练"} · PID{" "}
                    {workload.pid}
                  </strong>
                  <code>
                    {workload.pane
                      ? `tmux ${workload.pane.session}:${workload.pane.pane}`
                      : workload.tty === "?"
                        ? "detached / 后台"
                        : workload.tty}
                  </code>
                </div>
                <span className={workload.ownerConfidence}>
                  {workloadConfidenceLabel[workload.ownerConfidence]}
                </span>
              </div>
              <code className="runtime-command">{workload.cmdline}</code>
              <div className="runtime-relation-meta">
                <span>已运行 {duration(workload.elapsedSeconds)}</span>
                <span>{workload.workerPids.length} 个相关进程</span>
                <span>
                  {workload.gpus.length
                    ? `GPU ${Array.from(
                        new Set(
                          workload.gpus
                            .map((gpu) => gpu.index)
                            .filter((index): index is number => index !== null),
                        ),
                      ).join(",")} · ${workload.gpuMemoryMiB} MiB`
                    : "未检测到 GPU 占用"}
                </span>
              </div>
              <RemoteWorkdirLink
                host={selectedAgent.host}
                cwd={workload.cwd || selectedAgent.cwd}
              />
              <details className="runtime-evidence">
                <summary>为什么归属于此 Session</summary>
                <ul>
                  {workload.ownerEvidence.map((evidence) => (
                    <li key={evidence}>{evidence}</li>
                  ))}
                </ul>
              </details>
            </article>
          ))}
        </div>
      )}

      {(selectedAgent.remoteJobs?.length || 0) > 0 && (
        <div className="runtime-relation-group">
          <strong className="runtime-relation-title">
            该 Session 提交的远程 DLC 训练
          </strong>
          {selectedAgent.remoteJobs?.map((job) => (
            <article
              className="runtime-relation-card remote"
              key={`${job.host}:${job.jobId}`}
            >
              <div className="runtime-relation-head">
                <div>
                  <strong>{job.name || job.jobId}</strong>
                  <code>{job.jobId}</code>
                </div>
                <span className={submissionStatusClass(job.status)}>
                  {job.status || "Unknown"}
                </span>
              </div>
              <div className="runtime-relation-meta">
                <span>{relativeTime(job.submittedAt)}</span>
                <span>{job.reason || "无 ReasonCode"}</span>
                <span>{job.active ? "提交 Session 活动中" : "历史提交"}</span>
              </div>
              {job.message && (
                <p className="runtime-job-message">{job.message}</p>
              )}
              <div className="runtime-relation-actions">
                <button type="button" onClick={() => locateSubmission(job)}>
                  <BookOpen size={13} />
                  打开提交证据
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {(selectedAgent.relatedPanes?.length || 0) === 0 &&
        (selectedAgent.localWorkloads?.length || 0) === 0 &&
        (selectedAgent.remoteJobs?.length || 0) === 0 && (
          <div className="runtime-relations-empty">
            <Layers3 size={16} />
            <span>暂未发现由该 Session 创建的 tmux、后台任务或 DLC 作业。</span>
          </div>
        )}
    </InspectorModule>
  );
}
