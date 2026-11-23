"use client";
import type { WorkspaceController } from "@/features/workspace/use-workspace-controller";
import { bridgeUrl } from "@/features/workspace/shared";
import type { SettingsTab } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { ManagerChat } from "./ManagerChat";
import { ResourceOverview } from "./ResourceOverview";
import { TaskComposer } from "./TaskComposer";
import { TaskQueue } from "./TaskQueue";
import type { Section, TaskDraft } from "./types";
import type { WorkbenchClient } from "./use-workbench";
import { WorkbenchSettings } from "./WorkbenchSettings";

export function WorkbenchSurface({
  client,
  section,
  onNavigate,
  workspace,
  settingsTab,
  onSettingsTabChange,
}: {
  client: WorkbenchClient;
  section: Section;
  onNavigate: (section: Section) => void;
  workspace: WorkspaceController;
  settingsTab?: SettingsTab;
  onSettingsTabChange?: (next: SettingsTab) => void;
}) {
  const { tr } = useLocale();
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const { state } = client;
  const taskQueueEnabled = state?.features?.taskQueue !== false;

  function openSession(host: string, id: string) {
    const agent = [...workspace.allAgents, ...workspace.inactiveAgents].find(
      (a) => a.host === host && a.rollout?.id === id,
    );
    onNavigate("projects");
    workspace.chooseHost(host);
    if (agent) workspace.selectAgentAndReveal(agent.id);
    else {
      workspace.setQuery(id);
      workspace.setActionNotice({
        kind: "success",
        text: tr(
          "已定位执行主机；等待会话同步，或在历史中按会话 ID 查找。",
          "Located host; waiting for session sync or search by session ID in history.",
        ),
      });
    }
  }

  async function saveOperatorNameFromSettings(name: string) {
    const response = await fetch(bridgeUrl("/api/operator"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || tr("保存失败", "Save failed"));
    workspace.setOperatorNameDraft(result.operatorName || name);
    await workspace.refresh();
  }

  return (
    <div className={`workbench-surface surface-${section}`}>
      {(client.error || state?.error) && (
        <div className="workbench-notice" role="alert">
          {client.error || state?.error}
        </div>
      )}
      {!state ? (
        <div className="center-loading">
          <LoaderCircle size={20} className="is-spinning" />
          <p>{tr("正在连接工作台…", "Connecting to workbench…")}</p>
        </div>
      ) : (
        <>
          {section === "settings" ? (
            <WorkbenchSettings
              key="settings"
              {...client}
              state={state}
              hosts={workspace.snapshot.hosts}
              onAccounts={workspace.openAccountProfiles}
              tab={settingsTab}
              onTabChange={onSettingsTabChange}
              operatorName={workspace.operatorName}
              onSaveOperatorName={saveOperatorNameFromSettings}
            />
          ) : (
            <>
              <div className="workbench-primary">
                {taskQueueEnabled && taskDraft && (
                  <TaskComposer
                    key={JSON.stringify(taskDraft)}
                    {...client}
                    initial={taskDraft}
                    state={state}
                    hosts={workspace.snapshot.hosts}
                    projects={workspace.projects}
                    onClose={() => setTaskDraft(null)}
                  />
                )}
                {section === "manager" ? (
                  <ManagerChat
                    hosts={workspace.snapshot.hosts}
                    {...client}
                    state={state}
                    onSettings={() => onNavigate("settings")}
                    onDraft={taskQueueEnabled ? setTaskDraft : undefined}
                  />
                ) : (
                  <ResourceOverview
                    hosts={workspace.snapshot.hosts}
                    tasks={state.tasks.filter((t) => !t.archivedAt)}
                    onSelectHost={(alias) => workspace.chooseHost(alias)}
                  />
                )}
              </div>
              {section === "resources" && (
                <aside className="workbench-activity">
                  <TaskQueue
                    {...client}
                    tasks={state.tasks.filter((t) => !t.archivedAt)}
                    onOpenSession={openSession}
                    onNew={taskQueueEnabled ? () =>
                      setTaskDraft({
                        provider: "codex",
                        host:
                          workspace.selectedProject?.host ||
                          state.config.manager.host ||
                          workspace.snapshot.hosts[0]?.alias ||
                          "",
                        cwd: workspace.selectedProject?.cwd || "",
                        prompt: "",
                        gpuCount: 0,
                        minMemoryMiB: 0,
                      }) : undefined
                    }
                  />
                  {!taskQueueEnabled && (
                    <p className="queue-paused">
                      {tr("实验任务队列未启用", "Experimental task queue is disabled")}
                    </p>
                  )}
                  {state.config.scheduler.paused && (
                    <p className="queue-paused">
                      {tr("调度已暂停 · 可在设置中恢复", "Queue paused · resume in Settings")}
                    </p>
                  )}
                </aside>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
