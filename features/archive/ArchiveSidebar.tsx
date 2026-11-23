"use client";
import "./archive.css";
import { Archive, ArchiveRestore, RotateCw, Trash2 } from "lucide-react";
import type { ArchiveClient, ArchiveRecord } from "./use-session-archives";
import type { WorkbenchClient } from "@/features/command-center/use-workbench";
import { taskStatus, taskStatusEn } from "@/features/command-center/types";
import { AgentLogo } from "@/components/agent-logo";
import type { CatalogEntry } from "@/features/conversation/use-session-catalog";
import { useLocale } from "@/lib/i18n";

export function ArchiveSidebar({
  client,
  archives,
  records,
  host,
  onTasks,
  nativeArchives = [],
  nativeBusy = false,
  onNativeChange,
}: {
  client: WorkbenchClient;
  archives: ArchiveClient;
  records: ArchiveRecord[];
  host: string;
  onTasks: () => void;
  nativeArchives?: CatalogEntry[];
  nativeBusy?: boolean;
  onNativeChange?: (key: string, action: string) => Promise<void>;
}) {
  const { locale, tr } = useLocale();
  const tasks = (client.state?.tasks || []).filter(
    (t) => t.kind !== "manager" && (host === "all" || t.host === host),
  );
  const archived = tasks.filter((t) => t.archivedAt);
  const sessions = records.filter(
    (r) => r.phase !== "restored" && (host === "all" || r.host === host),
  );
  const totalArchived = sessions.length + archived.length + nativeArchives.length;
  const taskAction = (id: string, action: string) =>
    void client.mutate("task-action", { id, action }).catch(() => {});

  return (
    <section className="archive-sidebar" aria-label={tr("任务与归档", "Tasks & Archive")}>
      {(archives.error || client.error) && (
        <p className="archive-error" role="alert">
          {archives.error || client.error}
        </p>
      )}
      {tasks.some((t) => !t.archivedAt) && (
        <details open>
          <summary>{tr("任务", "Tasks")}</summary>
          {tasks
            .filter((t) => !t.archivedAt)
            .slice(-10)
            .reverse()
            .map((task) => (
              <div className="sidebar-history-row" key={task.id}>
                <AgentLogo provider={task.provider} />
                <button
                  type="button"
                  className="sidebar-history-title"
                  title={task.prompt}
                  onClick={onTasks}
                >
                  <span>{task.prompt}</span>
                  <small>
                    {locale === "en" ? taskStatusEn[task.status] || task.status : taskStatus[task.status]} · {task.host}
                  </small>
                </button>
                <button
                  type="button"
                  className="sidebar-archive-action"
                  aria-label={`${tr("归档任务", "Archive task")} ${task.prompt}`}
                  title={
                    task.status === "queued"
                      ? tr("取消排队并归档", "Cancel & archive")
                      : tr("归档任务", "Archive task")
                  }
                  disabled={
                    client.busy ||
                    ![
                      "queued",
                      "completed",
                      "failed",
                      "cancelled",
                      "released",
                    ].includes(task.status)
                  }
                  onClick={() => taskAction(task.id, "archive")}
                >
                  <Archive size={14} />
                </button>
              </div>
            ))}
        </details>
      )}
      <details>
        <summary>
          <Archive size={14} /> {tr("已归档", "Archived")}{" "}
          <span>{totalArchived}</span>
        </summary>
        {totalArchived === 0 && (
          <p className="archive-empty">
            {tr("归档的会话与任务会保留在这里。", "Archived sessions and tasks stay here for restoration.")}
          </p>
        )}
        {sessions.map((record) => (
          <div
            className="sidebar-history-row"
            key={`${record.host}:${record.sessionId}`}
          >
            <AgentLogo provider="codex" />
            <div
              className="sidebar-history-title"
              title={record.error || record.title}
            >
              <span>{record.title}</span>
              <small>
                {record.host}
                {record.phase !== "archived" ? tr(" · 待核实，可重试", " · pending, retry") : ""}
              </small>
            </div>
            <button
              type="button"
              className="sidebar-archive-action"
              disabled={!!archives.busy}
              aria-label={`${record.phase === "archiving" ? tr("重试归档", "Retry archive") : tr("恢复会话", "Restore session")} ${record.title}`}
              onClick={() =>
                void archives.change(
                  record.host,
                  record.sessionId,
                  record.phase === "archiving" ? "archive" : "restore",
                )
              }
            >
              {record.phase === "archiving" ? (
                <RotateCw size={14} />
              ) : (
                <ArchiveRestore size={14} />
              )}
            </button>
          </div>
        ))}
        {nativeArchives.map((entry) => (
          <div className="sidebar-history-row" key={entry.key}>
            <AgentLogo provider={entry.provider} />
            <div className="sidebar-history-title">
              <span title={entry.title}>{entry.title}</span>
              <small>
                {entry.phase === "deleted" ? tr("回收站", "Trash") : tr("已归档", "Archived")} · {entry.host}
              </small>
            </div>
            {onNativeChange && (
              <>
                <button
                  type="button"
                  className="sidebar-archive-action"
                  disabled={nativeBusy}
                  aria-label={`${tr("恢复", "Restore")} ${entry.title}`}
                  onClick={() => void onNativeChange(entry.key, "restore")}
                >
                  <ArchiveRestore size={14} />
                </button>
                {entry.phase !== "deleted" && (
                  <button
                    type="button"
                    className="sidebar-archive-action"
                    disabled={nativeBusy}
                    aria-label={`${tr("移入回收站", "Move to trash")} ${entry.title}`}
                    onClick={() => void onNativeChange(entry.key, "delete")}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </>
            )}
          </div>
        ))}
        {archived.map((task) => (
          <div className="sidebar-history-row" key={task.id}>
            <AgentLogo provider={task.provider} />
            <div className="sidebar-history-title" title={task.prompt}>
              <span>{task.prompt}</span>
              <small>{tr("任务", "Task")} · {task.host}</small>
            </div>
            <button
              type="button"
              className="sidebar-archive-action"
              disabled={client.busy}
              aria-label={`${tr("恢复任务", "Restore task")} ${task.prompt}`}
              onClick={() => taskAction(task.id, "restore")}
            >
              <ArchiveRestore size={14} />
            </button>
          </div>
        ))}
      </details>
    </section>
  );
}
