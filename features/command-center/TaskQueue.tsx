"use client";
import { MarkdownBody } from "@/features/workspace/shared";
import { AgentLogo } from "@/components/agent-logo";
import { ArrowUpRight, CheckCircle2, Clock3, Plus } from "lucide-react";
import { taskStatus, type TaskRecord } from "./types";
import type { WorkbenchClient } from "./use-workbench";

export function TaskQueue({
  tasks,
  busy,
  mutate,
  onNew,
  onOpenSession,
}: Pick<WorkbenchClient, "busy" | "mutate"> & {
  tasks: TaskRecord[];
  onNew?: () => void;
  onOpenSession: (host: string, id: string) => void;
}) {
  return (
    <section className="task-queue" aria-label="跨项目任务队列">
      <header className="queue-heading">
        <div>
          <h2>
            任务队列{" "}
            <span>
              {
                tasks.filter(
                  (t) =>
                    !["completed", "cancelled", "failed", "released"].includes(
                      t.status,
                    ),
                ).length
              }
            </span>
          </h2>
          <p>每项工作都有明确的去向和结果。</p>
        </div>
        {onNew && <button className="center-secondary" onClick={onNew}>
          <Plus size={15} /> 派发任务
        </button>}
      </header>
      {!tasks.length && (
        <div className="queue-empty">
          <CheckCircle2 size={22} />
          <strong>这里还很安静</strong>
          <p>{onNew ? "开始一个任务，或让总调度帮你规划下一步。" : "实验任务队列未启用；现有执行记录仍可查看。"}</p>
        </div>
      )}
      {[...tasks].reverse().map((task) => (
        <details className={`queue-task ${task.status}`} key={task.id}>
          <summary>
            <AgentLogo provider={task.provider} />
            <div>
              <strong>
                {task.kind === "manager" ? "总调度 · " : ""}
                {task.prompt.slice(0, 100)}
              </strong>
              <small>
                {task.host} · {task.cwd.split("/").pop() || "/"} ·{" "}
                {task.provider}
              </small>
            </div>
            <span className="task-status-label">
              {taskStatus[task.status] || task.status}
            </span>
          </summary>
          <div className="queue-task-detail">
            <code>{task.cwd}</code>
            <p>{task.prompt}</p>
            {task.queueReason && (
              <p className="queue-reason">
                <Clock3 size={14} /> {task.queueReason}
              </p>
            )}
            {task.gpuIndices.length > 0 && (
              <p>已分配 GPU {task.gpuIndices.join(", ")}</p>
            )}
            {task.error && (
              <p role="status" className="center-error">
                {task.error}
              </p>
            )}
            {task.note && <p>{task.note}</p>}
            {task.result?.text && <MarkdownBody value={task.result.text} />}
            {task.result?.stderr && (
              <details>
                <summary>执行日志</summary>
                <pre>{task.result.stderr}</pre>
              </details>
            )}
            {task.result?.truncated && (
              <p>输出过长，显示末尾部分；完整日志保留在远端。</p>
            )}
            {(task.remote?.remotePath || task.result?.remotePath) && (
              <code>{task.remote?.remotePath || task.result?.remotePath}</code>
            )}
            <footer>
              {task.remote?.sessionId && task.provider === "codex" && (
                <button
                  className="center-secondary"
                  onClick={() =>
                    onOpenSession(task.host, task.remote!.sessionId!)
                  }
                >
                  查看会话 <ArrowUpRight size={13} />
                </button>
              )}
              {task.status === "queued" && (
                <button
                  className="center-secondary"
                  disabled={busy}
                  onClick={() =>
                    void mutate("task-action", {
                      id: task.id,
                      action: "cancel",
                    }).catch(() => {})
                  }
                >
                  取消排队
                </button>
              )}
              {task.status === "unknown" && (
                <button
                  className="center-secondary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "请先核实远端任务已结束。继续只会释放工作台的并发和 GPU 记录，不会终止远端进程。",
                      )
                    )
                      void mutate("task-action", {
                        id: task.id,
                        action: "release",
                      }).catch(() => {});
                  }}
                >
                  已核实远端结束，释放占用
                </button>
              )}
            </footer>
          </div>
        </details>
      ))}
    </section>
  );
}
