"use client";
import { useMemo, useState } from "react";
import { SubagentWorkflowDrawer } from "@/components/subagent-workflow-drawer";
import {
  absoluteTime,
  attachCommand,
  capacityRecoveryLabel,
  categoryLabel,
  compactText,
  DIALOGUE_RENDER_BATCH,
  displayCommandError,
  duration,
  ExperimentInspector,
  experimentMetrics,
  gpuEpisodeDuration,
  gpuKey,
  InspectorModule,
  managementKey,
  MarkdownBody,
  pathName,
  relativeTime,
  RemoteWorkdirLink,
  resourcePrompt,
  resumeInTmuxCommand,
  statusLabel,
} from "@/features/workspace/shared";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  CirclePause,
  Command,
  Copy,
  Cpu,
  Layers3,
  LoaderCircle,
  MessageSquareText,
  Minimize2,
  RefreshCw,
  Save,
  Send,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { CodexSubagentRows, toCodexDrawerItems } from "./CodexSubagentsPanel";
import { DialogueTimeline } from "./DialogueTimeline";
import { HumanRequests } from "./HumanRequests";
import { RuntimeDetails } from "./RuntimeDetails";
import { SessionComposer } from "./SessionComposer";
import { SessionModelPanel } from "./SessionModelPanel";
import { SessionSummaryPanel } from "./SessionSummaryPanel";
import { useCodexSubagentWorkflow } from "./use-codex-subagent-workflow";
import type { WorkspaceController } from "./use-workspace-controller";

export function SessionInspector(
  workspace: WorkspaceController & { auxiliary?: boolean },
) {
  const {
    viewMode,
    selectedExperiment,
    copied,
    busyAction,
    copy,
    terminateTmuxSession,
    selectedAgent,
    selectedSummary,
    selectedManagement,
    setConversationFocus,
    conversationFocus,
    selectedAppServerSession,
    selectedRecoveryCwd,
    connectAppServer,
    takeoverSession,
    closeSession,
    selectedDialogueExpanded,
    renderedDialogueEvents,
    visibleDialogueEvents,
    setDialogueRenderLimit,
    setInspectorSectionOpen,
    selectedResearchExpanded,
    selectedResearchResult,
    selectedInspectorKey,
    canonicalDialogueMessages,
    selectedDialoguePending,
    selectedDialogueError,
    copyLatestAssistantReply,
    snapshot,
    selectedExperimentsExpanded,
    discoverExperiments,
    selectedAgentGpuUsage,
    chooseGpu,
    selectedPolicyExpanded,
    policyDraft,
    setPolicyDraft,
    saveResourcePolicy,
    syncResourcePrompt,
    selectedControlExpanded,
    compactSession,
  } = workspace;

  const [openCodexSubagent, setOpenCodexSubagent] = useState<{
    inspectorKey: string;
    id: string;
  } | null>(null);
  const activeCodexSubagentId =
    openCodexSubagent?.inspectorKey === selectedInspectorKey
      ? openCodexSubagent.id
      : null;
  const selectedSubagents = useMemo(
    () => selectedAgent?.subagents || [],
    [selectedAgent?.subagents],
  );
  const codexWorkflow = useCodexSubagentWorkflow(
    selectedAgent?.host || "",
    selectedAgent?.rollout?.id || "",
    selectedSubagents,
    activeCodexSubagentId,
  );
  const codexDrawerItems = useMemo(
    () => toCodexDrawerItems(selectedSubagents),
    [selectedSubagents],
  );

  return (
    <aside className="inspector" id="inspector-panel">
      {viewMode === "experiments" ? (
        selectedExperiment ? (
          <ExperimentInspector
            experiment={selectedExperiment}
            copied={copied}
            terminating={
              busyAction ===
              `terminate-tmux:${selectedExperiment.host}:${selectedExperiment.session}`
            }
            onCopy={copy}
            onTerminate={terminateTmuxSession}
          />
        ) : (
          <div className="no-selection">
            <SquareTerminal size={23} />
            <strong>选择一个实验 tmux</strong>
            <span>这里会显示真实终端输出、进度、ETA、GPU 和连接命令。</span>
          </div>
        )
      ) : selectedAgent ? (
        <>
          <div className="inspector-head">
            <div className={`large-state ${selectedAgent.status}`}>
              {selectedAgent.historical ? (
                <BookOpen size={18} />
              ) : selectedAgent.status === "working" ? (
                <Activity size={18} />
              ) : selectedAgent.status === "attention" ? (
                <AlertTriangle size={18} />
              ) : (
                <CirclePause size={18} />
              )}
            </div>
            <div className="inspector-head-copy">
              <span>
                {selectedSummary
                  ? categoryLabel[selectedSummary.category]
                  : statusLabel[selectedAgent.status]}
                {" · "}
                {selectedAgent.historical
                  ? "历史"
                  : selectedManagement.priority || "P2"}
              </span>
              <h2>{selectedSummary?.theme || pathName(selectedAgent.cwd)}</h2>
              <small>
                {selectedAgent.host} · {selectedAgent.cwd || "未知目录"}
              </small>
              {selectedAgent.capacityRecovery && (
                <small
                  className={`capacity-recovery-state ${selectedAgent.capacityRecovery.status}`}
                  title={selectedAgent.capacityRecovery.lastError || undefined}
                >
                  {capacityRecoveryLabel(selectedAgent.capacityRecovery)}
                </small>
              )}
            </div>
            <div className="inspector-head-actions">
              {!workspace.auxiliary && (
                <button
                  type="button"
                  className="project-focus-toggle"
                  onClick={() => setConversationFocus((current) => !current)}
                >
                  {conversationFocus ? "显示会话列表" : "展开会话"}
                </button>
              )}
              <div
                className="inspector-transport-switch"
                role="group"
                aria-label="Session 运行模式"
              >
                <button
                  type="button"
                  className={selectedAppServerSession ? "active" : ""}
                  disabled={
                    !selectedAgent.rollout ||
                    Boolean(selectedAppServerSession) ||
                    (selectedAgent.historical && !selectedRecoveryCwd) ||
                    (!selectedAgent.historical &&
                      !selectedAgent.appServerManaged) ||
                    busyAction ===
                      `app-server:${managementKey(selectedAgent)}` ||
                    busyAction === `takeover:${managementKey(selectedAgent)}`
                  }
                  onClick={() => connectAppServer(selectedAgent)}
                  title="切换到结构化 app-server 通道"
                >
                  {busyAction ===
                  `app-server:${managementKey(selectedAgent)}` ? (
                    <LoaderCircle size={15} className="is-spinning" />
                  ) : (
                    <MessageSquareText size={15} />
                  )}
                  App Server
                </button>
                <button
                  type="button"
                  className={selectedAgent.pane ? "active" : ""}
                  disabled={
                    !selectedAgent.rollout ||
                    Boolean(selectedAgent.pane) ||
                    (selectedAgent.historical && !selectedRecoveryCwd) ||
                    selectedAppServerSession?.status === "working" ||
                    (!selectedAgent.historical &&
                      !selectedAgent.appServerManaged) ||
                    busyAction ===
                      `app-server:${managementKey(selectedAgent)}` ||
                    busyAction === `takeover:${managementKey(selectedAgent)}`
                  }
                  onClick={() => takeoverSession(selectedAgent)}
                  title={
                    selectedAppServerSession?.status === "working"
                      ? "等待当前 app-server Turn 完成后再切换"
                      : "切换到可 attach 的 tmux TUI"
                  }
                >
                  {busyAction === `takeover:${managementKey(selectedAgent)}` ? (
                    <LoaderCircle size={15} className="is-spinning" />
                  ) : (
                    <SquareTerminal size={15} />
                  )}
                  tmux
                </button>
              </div>
              {selectedAgent.appServerManaged && (
                <button
                  type="button"
                  className="inspector-close-action"
                  disabled={
                    selectedAppServerSession?.status === "offline" ||
                    busyAction === `close:${managementKey(selectedAgent)}`
                  }
                  onClick={() => closeSession(selectedAgent)}
                  title={
                    selectedAppServerSession?.status === "offline"
                      ? "主机离线，无法确认远端 Turn 已停止"
                      : "停止当前 Turn 和网页托管；保留 Session 日志"
                  }
                >
                  {busyAction === `close:${managementKey(selectedAgent)}` ? (
                    <LoaderCircle size={14} className="is-spinning" />
                  ) : (
                    <CirclePause size={14} />
                  )}
                  关闭
                </button>
              )}
              {selectedAgent.pane && (
                <>
                  <button
                    type="button"
                    className="inspector-terminate-action"
                    disabled={
                      busyAction ===
                      `terminate-tmux:${selectedAgent.host}:${selectedAgent.pane.session}`
                    }
                    onClick={() =>
                      terminateTmuxSession(
                        selectedAgent.host,
                        selectedAgent.pane!.session,
                      )
                    }
                    title={`精确终止 tmux ${selectedAgent.pane.session}；保留 Codex Session 日志`}
                  >
                    {busyAction ===
                    `terminate-tmux:${selectedAgent.host}:${selectedAgent.pane.session}` ? (
                      <LoaderCircle size={14} className="is-spinning" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    终止 tmux
                  </button>
                  <button
                    type="button"
                    className="inspector-attach-action"
                    onClick={() =>
                      copy(
                        attachCommand(selectedAgent),
                        "primary-attach-command",
                      )
                    }
                    title={`复制进入 ${selectedAgent.pane.session} 的命令`}
                  >
                    {copied === "primary-attach-command" ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                    {copied === "primary-attach-command" ? "已复制" : "Attach"}
                  </button>
                </>
              )}
            </div>
          </div>

          <div
            className="inspector-scroll"
            onScroll={(event) => {
              const inspector = event.currentTarget;
              if (
                selectedDialogueExpanded &&
                renderedDialogueEvents.length < visibleDialogueEvents.length &&
                inspector.scrollHeight -
                  inspector.scrollTop -
                  inspector.clientHeight <
                  900
              ) {
                setDialogueRenderLimit((current) =>
                  Math.min(
                    visibleDialogueEvents.length,
                    current + DIALOGUE_RENDER_BATCH,
                  ),
                );
              }
            }}
          >
            {!workspace.auxiliary && <HumanRequests {...workspace} />}

            <SessionSummaryPanel {...workspace} />

            {selectedSummary?.category === "research" && (
              <details
                className="detail-section research-section inspector-collapsible"
                key={`research:${managementKey(selectedAgent)}`}
                open={selectedResearchExpanded}
                onToggle={(event) => {
                  const sectionKey = `${managementKey(selectedAgent)}:research`;
                  const open = event.currentTarget.open;
                  setInspectorSectionOpen((current) =>
                    current[sectionKey] === open
                      ? current
                      : { ...current, [sectionKey]: open },
                  );
                }}
              >
                <summary className="section-title-row collapsible-section-summary">
                  <span className="detail-label">调研结果</span>
                  <span>
                    <BookOpen size={13} /> Research
                  </span>
                  <ChevronRight size={15} className="section-chevron" />
                </summary>
                {selectedResearchExpanded && (
                  <MarkdownBody
                    className="summary-markdown research-result"
                    value={
                      selectedResearchResult ||
                      "rollout 中暂未提取到明确结论。点击“AI 更新摘要”可将任务历史与最近汇报压缩为调研结论。"
                    }
                    remoteHost={selectedAgent.host}
                    remoteCwd={selectedAgent.cwd}
                  />
                )}
              </details>
            )}

            <InspectorModule
              key={`${selectedInspectorKey}:latest-user`}
              title="最近用户任务"
              defaultOpen
              className="latest-user-section"
            >
              <MarkdownBody
                className="task-text task-markdown"
                value={compactText(
                  canonicalDialogueMessages.latestUser ||
                    selectedAgent.rollout?.lastUser ||
                    "",
                  "会话记录中尚未提取到用户任务",
                )}
                remoteHost={selectedAgent.host}
                remoteCwd={selectedAgent.cwd}
              />
            </InspectorModule>

            <InspectorModule
              key={`${selectedInspectorKey}:latest-assistant`}
              title="Codex 最新回复"
              defaultOpen
              meta={
                selectedDialoguePending
                  ? "读取完整 Markdown…"
                  : selectedDialogueError
                    ? "rollout 摘要"
                    : "完整 Dialogue"
              }
              className="latest-assistant-section"
            >
              <div className="latest-assistant-toolbar">
                <button
                  type="button"
                  className="dialogue-refresh-button latest-reply-copy-button"
                  disabled={
                    selectedDialoguePending ||
                    !(
                      canonicalDialogueMessages.latestAssistant ||
                      selectedAgent.rollout?.lastAssistant
                    )
                  }
                  onClick={() => copyLatestAssistantReply(selectedAgent)}
                  title="复制当前显示的最新一条 Codex assistant 原文（保留 Markdown）"
                >
                  {copied ===
                  `latest-assistant:${managementKey(selectedAgent)}` ? (
                    <Check size={13} />
                  ) : (
                    <Copy size={13} />
                  )}
                  复制原始回复
                </button>
              </div>
              <MarkdownBody
                className="task-text task-markdown latest-assistant-text"
                value={compactText(
                  canonicalDialogueMessages.latestAssistant ||
                    (selectedDialoguePending
                      ? "正在读取完整回复…"
                      : selectedAgent.rollout?.lastAssistant || ""),
                  "主 Session 尚未产生可读取的回复",
                )}
                remoteHost={selectedAgent.host}
                remoteCwd={selectedAgent.cwd}
              />
            </InspectorModule>

            {!workspace.auxiliary && <SessionComposer {...workspace} />}

            <SessionModelPanel {...workspace} />

            <details
              className="detail-section experiments-section inspector-collapsible"
              open={selectedExperimentsExpanded}
              onToggle={(event) => {
                const sectionKey = `${selectedInspectorKey}:experiments`;
                const open = event.currentTarget.open;
                setInspectorSectionOpen((current) =>
                  current[sectionKey] === open
                    ? current
                    : { ...current, [sectionKey]: open },
                );
              }}
            >
              <summary className="section-title-row collapsible-section-summary">
                <span className="detail-label">本会话关联实验</span>
                <span>
                  {selectedManagement.experiments?.runs.length
                    ? `${selectedManagement.experiments.runs.length} runs`
                    : "按需扫描"}
                </span>
                <ChevronRight size={15} className="section-chevron" />
              </summary>
              {selectedExperimentsExpanded && (
                <>
                  <div className="section-inline-actions">
                    <button
                      className="inline-action"
                      disabled={
                        !selectedAgent.rollout ||
                        selectedAgent.historical ||
                        busyAction ===
                          `experiments:${managementKey(selectedAgent)}`
                      }
                      onClick={() => discoverExperiments(selectedAgent)}
                    >
                      {busyAction ===
                      `experiments:${managementKey(selectedAgent)}` ? (
                        <LoaderCircle size={14} className="is-spinning" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                      扫描 W&B
                    </button>
                  </div>
                  <p className="mapping-note">
                    按需在这个 session 的真实工作目录内读取本地 W&B
                    summary/metadata；不上传文件，也不把同主机的所有 run
                    强行归给当前会话。
                  </p>
                  {selectedManagement.experiments?.runs.length ? (
                    <div className="wandb-runs">
                      {selectedManagement.experiments.runs
                        .slice(0, 8)
                        .map((run) => (
                          <article key={`${run.path}:${run.id}`}>
                            <div className="wandb-run-head">
                              <div>
                                <strong>{run.id}</strong>
                                <span>
                                  {run.live
                                    ? "最近仍在写入"
                                    : relativeTime(run.updatedAt)}
                                </span>
                              </div>
                              <span
                                className={
                                  run.confidence === "high"
                                    ? "confidence-high"
                                    : ""
                                }
                              >
                                {run.confidence === "high"
                                  ? "rollout 提及"
                                  : "同目录候选"}
                              </span>
                            </div>
                            <div className="wandb-metrics">
                              {experimentMetrics(run.summary).map(
                                ([name, value]) => (
                                  <div key={name}>
                                    <span>{name}</span>
                                    <strong>{String(value ?? "—")}</strong>
                                  </div>
                                ),
                              )}
                              {!experimentMetrics(run.summary).length && (
                                <small>该 run 尚无可读取的 summary 指标</small>
                              )}
                            </div>
                            <code>{run.path}</code>
                          </article>
                        ))}
                    </div>
                  ) : (
                    <div className="wandb-empty">
                      <BarChart3 size={16} />
                      <span>
                        {selectedManagement.experiments
                          ? "已扫描：当前目录未发现本地 W&B run。"
                          : "尚未扫描。已有 W&B 的项目可直接显示 run、step、loss 等 summary；没有 W&B 的训练仍从 tmux/rollout 观察。"}
                      </span>
                    </div>
                  )}
                </>
              )}
            </details>

            <InspectorModule
              key={`${selectedInspectorKey}:activity`}
              title="当前操作（含子代理）"
            >
              <div className="current-activity">
                <Command size={14} />
                <code>
                  {selectedAgent.rollout?.lastAction ||
                    selectedAgent.subagents?.[0]?.lastAction ||
                    selectedAgent.subagents?.[0]?.lastAssistant ||
                    "等待新的会话事件"}
                </code>
              </div>
            </InspectorModule>

            {selectedAgent.rollout?.lastError && (
              <InspectorModule
                key={`${selectedInspectorKey}:error`}
                title="最近命令错误"
                defaultOpen
                className="error-section"
              >
                <div className="error-block">
                  <AlertTriangle size={14} />
                  <code>
                    {displayCommandError(selectedAgent.rollout.lastError)}
                  </code>
                </div>
              </InspectorModule>
            )}

            {!workspace.auxiliary && <DialogueTimeline {...workspace} />}

            <InspectorModule
              key={`${selectedInspectorKey}:mapping`}
              title="关联依据"
            >
              <div className="process-grid mapping-grid">
                <div>
                  <span>Rollout</span>
                  <strong>
                    {selectedAgent.mapping?.rollout === "open-fd"
                      ? "进程 FD 精确"
                      : selectedAgent.mapping?.rollout === "history"
                        ? "历史文件"
                        : "未关联"}
                  </strong>
                </div>
                <div>
                  <span>tmux</span>
                  <strong>
                    {selectedAgent.mapping?.tmux === "tty"
                      ? "TTY 精确"
                      : "未关联"}
                  </strong>
                </div>
                <div>
                  <span>Session</span>
                  <strong>
                    {selectedAgent.rollout?.id.slice(0, 8) || "—"}
                  </strong>
                </div>
                <div>
                  <span>子代理</span>
                  <strong>{selectedAgent.subagents?.length || 0}</strong>
                </div>
                <div>
                  <span>tmux / pane</span>
                  <strong>{selectedAgent.relatedPanes?.length || 0}</strong>
                </div>
                <div>
                  <span>同主机任务</span>
                  <strong>{selectedAgent.localWorkloads?.length || 0}</strong>
                </div>
                <div>
                  <span>远程 DLC</span>
                  <strong>{selectedAgent.remoteJobs?.length || 0}</strong>
                </div>
              </div>
              <p className="mapping-note">
                {selectedAgent.historical
                  ? "这条 Session 来自历史扫描；仍会保留 rollout 中可审计的 DLC 提交关系。"
                  : "Session 本身用 rollout FD 和 TTY 精确关联；后台任务优先使用父子进程、TTY、tmux 名称或 rollout 中的启动命令，只有证据足够强时才归属。"}
              </p>
            </InspectorModule>

            <RuntimeDetails {...workspace} />

            {selectedAgentGpuUsage.length > 0 && (
              <InspectorModule
                key={`${selectedInspectorKey}:gpu-history`}
                title="最近 GPU 占用"
                meta={
                  <>
                    {
                      selectedAgentGpuUsage.filter((episode) => episode.active)
                        .length
                    }{" "}
                    当前 · {selectedAgentGpuUsage.length} 个区间
                  </>
                }
                className="session-gpu-history"
              >
                <div className="session-gpu-timeline">
                  {selectedAgentGpuUsage.slice(0, 12).map((episode) => (
                    <button
                      type="button"
                      key={episode.id}
                      className={episode.active ? "active" : ""}
                      onClick={() =>
                        chooseGpu(gpuKey(episode.host, episode.gpuIndex))
                      }
                    >
                      <span>
                        <Cpu size={14} />
                        GPU {episode.gpuIndex}
                      </span>
                      <strong>
                        {episode.active
                          ? `${episode.lastMemoryMiB} MiB`
                          : relativeTime(episode.lastSeenAt)}
                      </strong>
                      <small>
                        {episode.kind === "evaluation" ? "评测" : "训练"} · 峰值{" "}
                        {episode.maxMemoryMiB} MiB ·{" "}
                        {gpuEpisodeDuration(episode)}
                      </small>
                    </button>
                  ))}
                </div>
                <p className="mapping-note">
                  记录由 15 秒轮询合并为占用区间；只在父子进程、TTY、tmux 名称或
                  rollout 启动命令足够明确时关联到该 Session。
                </p>
              </InspectorModule>
            )}

            {selectedSubagents.length > 0 && (
              <InspectorModule
                key={`${selectedInspectorKey}:subagents`}
                title="当前子代理"
                meta={`${selectedSubagents.length} 个`}
              >
                <CodexSubagentRows
                  subagents={selectedSubagents}
                  onInspect={(subagent) =>
                    setOpenCodexSubagent({
                      inspectorKey: selectedInspectorKey,
                      id: subagent.id,
                    })
                  }
                />
              </InspectorModule>
            )}

            {!selectedAgent.historical && (
              <details
                className="detail-section resource-policy-section inspector-collapsible"
                open={selectedPolicyExpanded}
                onToggle={(event) => {
                  const sectionKey = `${selectedInspectorKey}:policy`;
                  const open = event.currentTarget.open;
                  setInspectorSectionOpen((current) =>
                    current[sectionKey] === open
                      ? current
                      : { ...current, [sectionKey]: open },
                  );
                }}
              >
                <summary className="section-title-row collapsible-section-summary">
                  <span className="detail-label">资源抢占 Prompt</span>
                  <span>
                    v{snapshot.management?.resourcePolicy.version || 0}
                  </span>
                  <ChevronRight size={15} className="section-chevron" />
                </summary>
                {selectedPolicyExpanded && (
                  <>
                    <p className="policy-intro">
                      写你的全局 GPU/CPU
                      分配规则。保存只更新本机控制面；点击“同步到此会话”才会把包含本会话优先级的指令发送到精确匹配的
                      tmux。
                    </p>
                    <textarea
                      value={
                        policyDraft ??
                        snapshot.management?.resourcePolicy.prompt ??
                        ""
                      }
                      placeholder="例如：P0 可抢占 P2/P3 的 GPU；P1 只在 checkpoint 后抢占；评测优先保留 GPU 0；任何 kill 前先汇报 PID 和影响。"
                      onChange={(event) => {
                        setPolicyDraft(event.target.value);
                      }}
                    />
                    <div className="policy-actions">
                      <button
                        className="secondary-action"
                        disabled={busyAction === "policy"}
                        onClick={saveResourcePolicy}
                      >
                        {busyAction === "policy" ? (
                          <LoaderCircle size={15} className="is-spinning" />
                        ) : (
                          <Save size={15} />
                        )}
                        保存策略
                      </button>
                      <button
                        className="secondary-action"
                        onClick={() =>
                          copy(
                            resourcePrompt(selectedAgent, snapshot.management),
                            "resource-prompt",
                          )
                        }
                      >
                        {copied === "resource-prompt" ? (
                          <Check size={15} />
                        ) : (
                          <Copy size={15} />
                        )}
                        复制调度 Prompt
                      </button>
                      <button
                        className="primary-action"
                        disabled={
                          !selectedAgent.pane ||
                          !selectedAgent.rollout ||
                          busyAction === `sync:${managementKey(selectedAgent)}`
                        }
                        onClick={() => syncResourcePrompt(selectedAgent)}
                      >
                        {busyAction ===
                        `sync:${managementKey(selectedAgent)}` ? (
                          <LoaderCircle size={15} className="is-spinning" />
                        ) : (
                          <Send size={15} />
                        )}
                        同步到此会话
                      </button>
                    </div>
                    {!selectedAgent.pane && (
                      <p className="policy-warning">
                        此进程未精确匹配 tmux，网页拒绝向未知 PTY
                        注入输入；可复制调度 Prompt 后粘贴到对应 VS Code
                        terminal。
                      </p>
                    )}
                  </>
                )}
              </details>
            )}

            <details
              className="detail-section inspector-collapsible session-control-section"
              open={selectedControlExpanded}
              onToggle={(event) => {
                const sectionKey = `${selectedInspectorKey}:control`;
                const open = event.currentTarget.open;
                setInspectorSectionOpen((current) =>
                  current[sectionKey] === open
                    ? current
                    : { ...current, [sectionKey]: open },
                );
              }}
            >
              <summary className="section-title-row collapsible-section-summary">
                <span className="detail-label">高级会话控制</span>
                <span>
                  {selectedAppServerSession
                    ? "app-server"
                    : selectedAgent.pane
                      ? "tmux"
                      : "恢复与接管"}
                </span>
                <ChevronRight size={15} className="section-chevron" />
              </summary>
              {selectedControlExpanded && (
                <>
                  <div className="control-mode-note">
                    <Layers3 size={15} />
                    <div>
                      <strong>
                        {selectedAppServerSession
                          ? "已由 app-server 实时管理"
                          : selectedAgent.historical
                            ? "历史 Session 已结束"
                            : selectedAgent.pane
                              ? "已由 tmux 托管"
                              : "可直接接管到 tmux"}
                      </strong>
                      <span>
                        {selectedAppServerSession
                          ? "远端结构化事件通过 SSH stdio 进入本机 Bridge；问题、审批和 MCP elicitation 会出现在详情栏顶部。"
                          : selectedAgent.historical
                            ? "可在原工作目录恢复到 tmux，也可恢复到 app-server 以接收所有结构化人工请求。"
                            : selectedAgent.pane
                              ? "tmux 支持显式 prompt；切换到 app-server 后才能可靠接收并响应问题、审批和 MCP elicitation。"
                              : "外部 VS Code/CLI Session 只读保护中。请先让原 Session 正常退出，再从 Inactive 恢复到 tmux 或 app-server。"}
                      </span>
                    </div>
                  </div>
                  <div className="advanced-session-actions">
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={
                        (!selectedAppServerSession && !selectedAgent.pane) ||
                        busyAction === `compact:${managementKey(selectedAgent)}`
                      }
                      onClick={() => compactSession(selectedAgent)}
                    >
                      {busyAction ===
                      `compact:${managementKey(selectedAgent)}` ? (
                        <LoaderCircle size={15} className="is-spinning" />
                      ) : (
                        <Minimize2 size={15} />
                      )}
                      压缩上下文
                    </button>
                  </div>
                  <p className="transport-switch-hint">
                    运行模式已放在详情标题栏：App Server
                    提供结构化事件与网页审批； tmux 提供可 attach 的
                    TUI。切换只恢复同一个 rollout，不会批量终止该 Session
                    创建的训练、评测或 long run。
                  </p>
                  <div className="manual-command-label">
                    {selectedAgent.pane ? "进入现有 tmux" : "手动命令（备用）"}
                  </div>
                  <div className="attach-command">
                    <code>
                      {selectedAgent.pane
                        ? attachCommand(selectedAgent)
                        : resumeInTmuxCommand(selectedAgent)}
                    </code>
                    <button
                      aria-label={
                        selectedAgent.pane
                          ? "复制进入 tmux 命令"
                          : "复制迁移到 tmux 命令"
                      }
                      onClick={() =>
                        copy(
                          selectedAgent.pane
                            ? attachCommand(selectedAgent)
                            : resumeInTmuxCommand(selectedAgent),
                          "resume-command",
                        )
                      }
                    >
                      {copied === "resume-command" ? (
                        <Check size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                  {!selectedAgent.pane && (
                    <p className="attach-note">
                      命令使用{" "}
                      <code>
                        tmux new-session -A -s scope-
                        {selectedAgent.rollout?.id.slice(0, 8)}
                      </code>
                      ：重复执行会重新进入同一 tmux，不会创建一堆重复会话。
                    </p>
                  )}
                </>
              )}
            </details>

            <InspectorModule
              key={`${selectedInspectorKey}:process`}
              title={selectedAgent.historical ? "Session 信息" : "进程信息"}
            >
              <div className="process-grid">
                <div>
                  <span>{selectedAgent.historical ? "状态" : "PID"}</span>
                  <strong>
                    {selectedAgent.historical ? "已结束" : selectedAgent.pid}
                  </strong>
                </div>
                <div>
                  <span>{selectedAgent.historical ? "Session" : "TTY"}</span>
                  <strong>
                    {selectedAgent.historical
                      ? selectedAgent.rollout?.id.slice(0, 8) || "—"
                      : selectedAgent.tty}
                  </strong>
                </div>
                <div>
                  <span>
                    {selectedAgent.historical ? "最后活动" : "运行时间"}
                  </span>
                  <strong>
                    {selectedAgent.historical
                      ? absoluteTime(selectedAgent.lastActivityAt)
                      : duration(selectedAgent.elapsedSeconds)}
                  </strong>
                </div>
                <div>
                  <span>Codex CLI</span>
                  <strong>{selectedAgent.rollout?.cliVersion || "—"}</strong>
                </div>
              </div>
              <RemoteWorkdirLink
                className="cwd-row"
                host={selectedAgent.host}
                cwd={selectedAgent.cwd}
              />
            </InspectorModule>

            <InspectorModule
              key={`${selectedInspectorKey}:terminal`}
              title="终端尾部"
              meta={
                <>
                  {selectedAgent.pane
                    ? `tmux:${selectedAgent.pane.session}`
                    : selectedAgent.historical
                      ? "历史记录"
                      : "未匹配 tmux"}
                </>
              }
            >
              <div className="terminal-preview">
                <div className="terminal-preview-head">
                  <span>
                    <i />
                    {selectedAgent.host}
                  </span>
                  <span>只读采集</span>
                </div>
                <pre>
                  {selectedAgent.pane?.preview ||
                    (selectedAgent.historical
                      ? "这条历史 Session 当前没有运行中的终端。\n可通过上方 Dialogue 查看完整记录，或用“会话控制”中的命令恢复到 tmux。"
                      : "该 Codex 进程未运行在可识别的 tmux pane 中。\n仍可通过 rollout 日志观察任务和工具调用。")}
                </pre>
              </div>
            </InspectorModule>

            <InspectorModule
              key={`${selectedInspectorKey}:attach`}
              title="连接命令"
            >
              <div className="attach-command">
                <code>{attachCommand(selectedAgent)}</code>
                <button
                  aria-label="复制连接命令"
                  onClick={() =>
                    copy(attachCommand(selectedAgent), "attach-command")
                  }
                >
                  {copied === "attach-command" ? (
                    <Check size={14} />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
              <p className="attach-note">
                {selectedAgent.pane
                  ? "在本机终端执行即可进入这条真实 tmux 会话。"
                  : selectedAgent.historical
                    ? "先 SSH 到主机；若要继续工作，请复制上方“会话控制”中的 resume 命令。"
                    : "这条会话没有匹配到 tmux，只能先 SSH 到主机后按 TTY 定位。"}
              </p>
            </InspectorModule>

            {!selectedAgent.historical &&
            snapshot.hosts.find((host) => host.alias === selectedAgent.host)
              ?.gpus.length ? (
              <InspectorModule
                key={`${selectedInspectorKey}:host-gpu`}
                title="主机 GPU"
              >
                <div className="gpu-list">
                  {snapshot.hosts
                    .find((host) => host.alias === selectedAgent.host)!
                    .gpus.map((gpu) => (
                      <div key={gpu.index}>
                        <span>
                          <Cpu size={13} /> GPU {gpu.index}
                        </span>
                        <strong>{gpu.utilization}%</strong>
                        <i>
                          <b style={{ width: `${gpu.utilization}%` }} />
                        </i>
                        <small>
                          {gpu.memoryUsed} / {gpu.memoryTotal} MiB
                        </small>
                      </div>
                    ))}
                </div>
              </InspectorModule>
            ) : null}
          </div>
          <SubagentWorkflowDrawer
            open={Boolean(activeCodexSubagentId)}
            providerLabel="Codex"
            items={codexDrawerItems}
            selectedId={activeCodexSubagentId}
            onSelect={(id) =>
              setOpenCodexSubagent({ inspectorKey: selectedInspectorKey, id })
            }
            onClose={() => setOpenCodexSubagent(null)}
            onRefresh={codexWorkflow.refresh}
            onLoadMore={codexWorkflow.loadMore}
            loading={codexWorkflow.loading}
            error={codexWorkflow.error}
            steps={codexWorkflow.steps}
            hasMore={codexWorkflow.hasMore}
            host={selectedAgent.host}
            cwd={selectedAgent.cwd}
            activeStatus={codexWorkflow.status}
            activeModel={codexWorkflow.model}
            activeTypeName={codexWorkflow.selected?.agentRole || ""}
            activeRole={
              codexWorkflow.selected?.agentNickname ||
              codexWorkflow.selected?.agentPath ||
              ""
            }
          />
        </>
      ) : (
        <div className="no-selection">
          <SquareTerminal size={23} />
          <strong>选择一条 Codex 会话</strong>
          <span>这里会显示真实任务、进程、tmux 终端尾部和连接命令。</span>
        </div>
      )}
    </aside>
  );
}
