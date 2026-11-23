"use client";
import { HostCodexSettings } from "@/components/host-codex-settings";
import {
  absoluteTime,
  bridgeUrl,
  categoryLabel,
  managementKey,
  managementRecord,
  pathName,
  relativeTime,
  RemoteWorkdirLink,
  resolvedSummary,
  SESSION_RENDER_BATCH,
  statusLabel,
} from "@/features/workspace/shared";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  CirclePause,
  Copy,
  Folder,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Sparkles,
  SquareTerminal,
  WifiOff,
  X,
} from "lucide-react";
import { SessionFilters } from "./SessionFilters";
import type { WorkspaceController } from "./use-workspace-controller";

export function SessionList(workspace: WorkspaceController) {
  const {
    selectedProject,
    hostFilter,
    selectedHost,
    viewMode,
    hostSettingsOpen,
    setHostSettingsOpen,
    hostModelOpen,
    setHostModelOpen,
    selectedHostAppServerCount,
    busyAction,
    recoverHostAppServer,
    restartHostCodex,
    snapshot,
    hostModelDrafts,
    setHostModelDrafts,
    modelsByHost,
    reloadModelsForHost,
    changeHostModel,
    modelErrors,
    hostModelResults,
    copy,
    copied,
    historyState,
    inactiveAgents,
    scanHistory,
    renderedAgents,
    filteredAgents,
    setSessionRenderLimit,
    gpuEpisodesBySession,
    clockNow,
    inlineRename,
    selectedAgent,
    selectAgentAndReveal,
    saveTheme,
    setInlineRename,
    setSelectedAgentId,
    summarizeSession,
    filteredExperiments,
    selectedExperiment,
    setSelectedExperimentId,
  } = workspace;

  return (
    <section className="session-column" id="session-list">
      <div className="session-column-head">
        <div>
          <span className="column-kicker">
            {selectedProject
              ? `${selectedProject.host} · ${selectedProject.cwd}`
              : hostFilter === "all"
                ? "所有可连接主机"
                : hostFilter}
          </span>
          <h1>
            {selectedHost && !selectedHost.reachable
              ? "SSH 连接不可用"
              : selectedProject && viewMode !== "experiments"
                ? selectedProject.name || pathName(selectedProject.cwd)
                : viewMode === "agents"
                  ? "Codex 会话"
                  : viewMode === "history"
                    ? "Inactive Session"
                    : "实验进程"}
          </h1>
        </div>
        <div className="session-column-actions">
          {selectedHost?.reachable && (
            <button
              className="host-recovery-button"
              type="button"
              aria-expanded={hostSettingsOpen}
              onClick={() => setHostSettingsOpen((open) => !open)}
            >
              <RefreshCw size={14} /> 主机设置 · 更新
            </button>
          )}
          {selectedHost?.reachable && (
            <button
              className="host-recovery-button"
              type="button"
              aria-expanded={hostModelOpen}
              onClick={() => setHostModelOpen((open) => !open)}
            >
              <Sparkles size={14} /> 主机模型
            </button>
          )}
          {selectedHost && selectedHostAppServerCount > 0 && (
            <button
              type="button"
              className="host-recovery-button"
              disabled={busyAction === `host-recovery:${selectedHost.alias}`}
              onClick={() => recoverHostAppServer(selectedHost.alias)}
              title="重连该主机全部 SCOPE 托管会话；只对中断前仍在工作的 Session 发送“继续”"
            >
              <RefreshCw
                size={14}
                className={
                  busyAction === `host-recovery:${selectedHost.alias}`
                    ? "is-spinning"
                    : ""
                }
              />
              一键恢复主机
              <span>{selectedHostAppServerCount}</span>
            </button>
          )}
          <div className="scan-time">
            {selectedHost?.reachable && selectedHostAppServerCount > 0 && (
              <button
                type="button"
                className="host-recovery-button"
                disabled={!!busyAction}
                onClick={() => restartHostCodex(selectedHost.alias)}
                title="重启托管进程以重新加载 config.toml；安全预检失败时不停止进程"
              >
                <RefreshCw size={14} /> 重启 Codex · 加载配置
              </button>
            )}
            <CircleDot size={12} />
            {selectedHost?.inventoryError
              ? `资源数据延迟 · 上次采集 ${relativeTime(selectedHost.inventoryUpdatedAt)}`
              : snapshot.generatedAt
                ? `采集于 ${relativeTime(snapshot.generatedAt)}`
                : "首次扫描中"}
          </div>
        </div>
      </div>

      {hostSettingsOpen && selectedHost?.reachable && (
        <HostCodexSettings
          key={selectedHost.alias}
          host={selectedHost.alias}
          url={bridgeUrl}
        />
      )}
      {hostModelOpen && selectedHost?.reachable && (
        <div className="host-model-panel">
          <strong>{selectedHost.alias} · 批量切换模型</strong>
          <div className="host-model-actions">
            <select
              aria-label="当前 SSH 主机的目标模型"
              value={hostModelDrafts[selectedHost.alias] || ""}
              onChange={(event) =>
                setHostModelDrafts((current) => ({
                  ...current,
                  [selectedHost.alias]: event.target.value,
                }))
              }
            >
              <option value="">选择模型…</option>
              {(modelsByHost[selectedHost.alias] || []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.displayName || model.id}
                </option>
              ))}
            </select>
            <button
              className="inline-action"
              onClick={() => reloadModelsForHost(selectedHost.alias)}
            >
              <RefreshCw size={14} /> 刷新模型
            </button>
            <button
              className="inline-action"
              disabled={!hostModelDrafts[selectedHost.alias] || !!busyAction}
              onClick={() => changeHostModel(selectedHost.alias)}
            >
              {busyAction === `host-model:${selectedHost.alias}`
                ? "正在切换…"
                : "应用到此主机会话"}
            </button>
          </div>
          <p>
            仅作用于 {selectedHost.alias}。App Server
            运行中的回合在下一轮生效；保留兼容的推理强度。繁忙 tmux
            和未接管终端会列为跳过。
          </p>
          {modelErrors[selectedHost.alias] && (
            <p role="alert">{modelErrors[selectedHost.alias]}</p>
          )}
          {!!hostModelResults[selectedHost.alias]?.length && (
            <details open>
              <summary>
                切换结果（{hostModelResults[selectedHost.alias].length}）
              </summary>
              {hostModelResults[selectedHost.alias].map((item) => (
                <div key={item.sessionId}>
                  <code>{item.sessionId.slice(0, 8)}</code> ·{" "}
                  {{
                    applied: "已应用",
                    "next-turn": "下一轮生效",
                    skipped: "已跳过",
                    failed: "失败",
                  }[item.status] || item.status}
                  {item.error || item.reason
                    ? ` · ${item.error || item.reason}`
                    : ""}
                </div>
              ))}
            </details>
          )}
        </div>
      )}
      {selectedHost && !selectedHost.reachable ? (
        <div className="host-error-view">
          <span className="error-icon">
            <WifiOff size={22} />
          </span>
          <h2>{selectedHost.alias}</h2>
          <p>{selectedHost.error}</p>
          <code>ssh {selectedHost.alias}</code>
          <button
            onClick={() => copy(`ssh ${selectedHost.alias}`, "ssh-error")}
          >
            {copied === "ssh-error" ? <Check size={14} /> : <Copy size={14} />}
            复制诊断命令
          </button>
        </div>
      ) : (
        <>
          <SessionFilters {...workspace} />

          <div
            className="session-list"
            onScroll={(event) => {
              const list = event.currentTarget;
              if (
                viewMode !== "experiments" &&
                renderedAgents.length < filteredAgents.length &&
                list.scrollHeight - list.scrollTop - list.clientHeight < 720
              ) {
                setSessionRenderLimit((current) =>
                  Math.min(
                    filteredAgents.length,
                    current + SESSION_RENDER_BATCH,
                  ),
                );
              }
            }}
          >
            {viewMode !== "experiments" ? (
              <>
                {renderedAgents.map((agent) => {
                  const management = managementRecord(
                    agent,
                    snapshot.management,
                  );
                  const summary = resolvedSummary(agent, snapshot.management);
                  const priority = management.priority || "P2";
                  const key = managementKey(agent);
                  const sessionGpuUsage = gpuEpisodesBySession.get(key) || [];
                  const sessionGpuIndices = [
                    ...new Set(
                      sessionGpuUsage
                        .filter(
                          (episode) =>
                            episode.active ||
                            clockNow - Date.parse(episode.lastSeenAt) <=
                              24 * 60 * 60 * 1_000,
                        )
                        .map((episode) => episode.gpuIndex),
                    ),
                  ].sort((left, right) => left - right);
                  const isRenaming = inlineRename?.key === key;
                  const isSavingName = busyAction === `theme:${key}`;
                  const isSummarizing = busyAction === `summary:${key}`;
                  return (
                    <div
                      key={agent.id}
                      className={`session-row ${
                        selectedAgent?.id === agent.id ? "selected" : ""
                      }`}
                      onClick={() => selectAgentAndReveal(agent.id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectAgentAndReveal(agent.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`打开 Session：${summary.theme}`}
                    >
                      <span className={`session-state ${agent.status}`}>
                        {agent.status === "working" ? (
                          <Activity size={15} />
                        ) : agent.status === "attention" ? (
                          <AlertTriangle size={15} />
                        ) : (
                          <CirclePause size={15} />
                        )}
                      </span>
                      <div className="session-main">
                        {isRenaming ? (
                          <form
                            className="session-inline-rename"
                            onClick={(event) => event.stopPropagation()}
                            onSubmit={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              saveTheme(agent, inlineRename.value);
                            }}
                          >
                            <input
                              autoFocus
                              aria-label={`重命名 ${summary.theme}`}
                              maxLength={40}
                              value={inlineRename.value}
                              onChange={(event) =>
                                setInlineRename({
                                  key,
                                  value: event.target.value,
                                })
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setInlineRename(null);
                                }
                              }}
                            />
                            <button
                              type="submit"
                              aria-label="保存 Session 名称"
                              title="保存名称"
                              disabled={
                                !inlineRename.value.trim() || isSavingName
                              }
                            >
                              {isSavingName ? (
                                <LoaderCircle
                                  size={14}
                                  className="is-spinning"
                                />
                              ) : (
                                <Check size={14} />
                              )}
                            </button>
                            <button
                              type="button"
                              aria-label="取消重命名"
                              title="取消"
                              onClick={() => setInlineRename(null)}
                            >
                              <X size={14} />
                            </button>
                          </form>
                        ) : (
                          <span className="session-row-top">
                            <strong title={summary.theme}>
                              {summary.theme}
                            </strong>
                            <span className={`status-text ${agent.status}`}>
                              {statusLabel[agent.status]}
                            </span>
                            <span className="session-card-actions">
                              <button
                                type="button"
                                aria-label={`重命名 ${summary.theme}`}
                                title="重命名 Session"
                                disabled={!agent.rollout || agent.historical}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedAgentId(agent.id);
                                  setInlineRename({
                                    key,
                                    value: summary.theme,
                                  });
                                }}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                aria-label={`用 Codex 总结 ${summary.theme}`}
                                title="调用该主机的 Codex CLI 生成标题与工作摘要"
                                disabled={
                                  !agent.rollout ||
                                  agent.historical ||
                                  busyAction.startsWith("summary:")
                                }
                                aria-busy={isSummarizing}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedAgentId(agent.id);
                                  summarizeSession(agent);
                                }}
                              >
                                {isSummarizing ? (
                                  <LoaderCircle
                                    size={13}
                                    className="is-spinning"
                                  />
                                ) : (
                                  <Sparkles size={13} />
                                )}
                              </button>
                            </span>
                          </span>
                        )}
                        <span className="session-tags">
                          {agent.historical ? (
                            <span className="history-chip">历史</span>
                          ) : (
                            <span
                              className={`priority-chip ${priority.toLowerCase()}`}
                            >
                              {priority === "paused" ? "暂停" : priority}
                            </span>
                          )}
                          <span className={`category-chip ${summary.category}`}>
                            {categoryLabel[summary.category]}
                          </span>
                          <span>
                            {management.displayName
                              ? "手动命名"
                              : summary.source === "codex"
                                ? "AI 摘要"
                                : summary.source === "manual"
                                  ? "手动主题"
                                  : "rollout 草稿"}
                          </span>
                        </span>
                        <span className="session-location">
                          <span>{agent.host}</span>
                          <span>
                            {agent.pane
                              ? `tmux:${agent.pane.session}`
                              : agent.historical
                                ? "已结束"
                                : agent.tty}
                          </span>
                        </span>
                        <span className="session-relations">
                          <span
                            className={
                              (agent.relatedPanes?.length || 0) > 0
                                ? "tmux"
                                : "empty"
                            }
                          >
                            tmux {agent.relatedPanes?.length || 0}
                          </span>
                          <span
                            className={
                              (agent.localWorkloads?.length || 0) > 0
                                ? "local"
                                : "empty"
                            }
                          >
                            同主机任务 {agent.localWorkloads?.length || 0}
                          </span>
                          <span
                            className={
                              (agent.remoteJobs?.length || 0) > 0
                                ? "remote"
                                : "empty"
                            }
                          >
                            DLC {agent.remoteJobs?.length || 0}
                          </span>
                          <span
                            className={
                              sessionGpuUsage.some((episode) => episode.active)
                                ? "gpu active"
                                : sessionGpuIndices.length > 0
                                  ? "gpu"
                                  : "empty"
                            }
                          >
                            {sessionGpuIndices.length > 0
                              ? `GPU ${sessionGpuIndices.join("/")}`
                              : "GPU —"}
                          </span>
                        </span>
                        <RemoteWorkdirLink
                          className="session-workdir"
                          host={agent.host}
                          cwd={agent.cwd}
                        />
                        <span className="session-action">
                          {summary.progress ||
                            agent.rollout?.lastAction ||
                            "尚未匹配到最近的 Codex 事件"}
                        </span>
                      </div>
                      <span className="session-meta">
                        <span
                          className={
                            agent.mapping?.rollout === "open-fd"
                              ? "mapping-exact"
                              : agent.mapping?.rollout === "history"
                                ? "mapping-history"
                                : "mapping-missing"
                          }
                        >
                          {agent.mapping?.rollout === "open-fd"
                            ? "rollout:FD"
                            : agent.mapping?.rollout === "history"
                              ? "rollout:历史"
                              : "rollout:未关联"}
                        </span>
                        <span
                          title={
                            agent.historical
                              ? `远端最后执行：${absoluteTime(
                                  agent.lastActivityAt,
                                )}`
                              : undefined
                          }
                        >
                          {agent.historical
                            ? `最后执行 ${relativeTime(agent.lastActivityAt)}`
                            : relativeTime(agent.lastActivityAt)}
                        </span>
                        <span>
                          {agent.subagents?.length
                            ? `${agent.subagents.length} subagents`
                            : agent.historical
                              ? `Session ${agent.rollout?.id.slice(0, 8)}`
                              : `PID ${agent.pid}`}
                        </span>
                      </span>
                      <ChevronRight size={15} className="session-chevron" />
                    </div>
                  );
                })}

                {renderedAgents.length < filteredAgents.length && (
                  <div className="session-list-progress" aria-live="polite">
                    已显示 {renderedAgents.length} / {filteredAgents.length}
                    ；继续滚动加载
                  </div>
                )}

                {viewMode === "agents" &&
                  snapshot.scanning &&
                  snapshot.hosts.length === 0 &&
                  filteredAgents.length === 0 && (
                    <div className="scan-empty">
                      <LoaderCircle size={20} className="is-spinning" />
                      <strong>正在扫描真实 SSH 主机</strong>
                      <span>首次扫描可能需要等待离线主机超时</span>
                    </div>
                  )}

                {viewMode === "agents" &&
                  (!snapshot.scanning || snapshot.hosts.length > 0) &&
                  filteredAgents.length === 0 && (
                    <div className="scan-empty">
                      <SquareTerminal size={20} />
                      <strong>没有匹配的 Codex 进程</strong>
                      <span>当前筛选条件下未发现正在运行的 Codex CLI</span>
                    </div>
                  )}

                {viewMode === "history" &&
                  !historyState.scannedAt &&
                  !historyState.loading && (
                    <div className="scan-empty history-empty">
                      <BookOpen size={22} />
                      <strong>历史 Session 默认不扫描</strong>
                      <span>
                        点击后才读取所选主机上的 ~/.codex/sessions；活动 Session
                        会自动排除。
                      </span>
                      <button type="button" onClick={() => scanHistory()}>
                        <RefreshCw size={14} />
                        扫描历史 Session
                      </button>
                    </div>
                  )}

                {viewMode === "history" &&
                  historyState.loading &&
                  inactiveAgents.length === 0 && (
                    <div className="scan-empty">
                      <LoaderCircle size={20} className="is-spinning" />
                      <strong>正在扫描历史 Session</strong>
                      <span>
                        只读取元数据摘要；完整 Dialogue 在选中后加载。
                      </span>
                    </div>
                  )}

                {viewMode === "history" &&
                  historyState.scannedAt &&
                  !historyState.loading &&
                  filteredAgents.length === 0 && (
                    <div className="scan-empty">
                      <BookOpen size={20} />
                      <strong>当前筛选下没有历史 Session</strong>
                      <span>可更换主机、工作目录或主题筛选后重试。</span>
                    </div>
                  )}
              </>
            ) : (
              <>
                {filteredExperiments.map((experiment) => (
                  <button
                    key={experiment.id}
                    className={`session-row ${
                      selectedExperiment?.id === experiment.id ? "selected" : ""
                    }`}
                    onClick={() => setSelectedExperimentId(experiment.id)}
                  >
                    <span className={`session-state ${experiment.status}`}>
                      {experiment.status === "working" ? (
                        <Activity size={15} />
                      ) : experiment.status === "attention" ? (
                        <AlertTriangle size={15} />
                      ) : (
                        <CirclePause size={15} />
                      )}
                    </span>
                    <span className="session-main">
                      <span className="session-row-top">
                        <strong>{experiment.session}</strong>
                        <span className={`status-text ${experiment.status}`}>
                          {experiment.dead
                            ? `退出 ${experiment.exitStatus ?? "?"}`
                            : statusLabel[experiment.status]}
                        </span>
                      </span>
                      <span className="session-location">
                        <span>{experiment.host}</span>
                        <span>{experiment.command}</span>
                      </span>
                      <span
                        className="remote-workdir-link session-workdir is-static"
                        title={experiment.cwd}
                      >
                        <Folder size={13} />
                        <code>{experiment.cwd || "tmux 未返回工作目录"}</code>
                      </span>
                      <span className="session-action">
                        {experiment.lastLine}
                      </span>
                    </span>
                    <span className="session-meta">
                      <span>{experiment.progress || "实时输出"}</span>
                      <span>
                        {experiment.eta
                          ? `ETA ${experiment.eta}`
                          : experiment.pane}
                      </span>
                      <span>PID {experiment.pid}</span>
                    </span>
                    <ChevronRight size={15} className="session-chevron" />
                  </button>
                ))}

                {!snapshot.scanning && filteredExperiments.length === 0 && (
                  <div className="scan-empty">
                    <SquareTerminal size={20} />
                    <strong>没有匹配的实验 tmux</strong>
                    <span>当前筛选条件下未发现 tmux pane</span>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
