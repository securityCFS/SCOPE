"use client";
import { gpuEpisodeDuration, relativeTime } from "@/features/workspace/shared";
import {
  BookOpen,
  Command,
  Cpu,
  Folder,
  LoaderCircle,
  RefreshCw,
  Search,
  SquareTerminal,
} from "lucide-react";
import type { WorkspaceController } from "./use-workspace-controller";
export function SessionFilters({
  hostFilter,
  viewMode,
  setViewMode,
  selectedProjectKey,
  setCwdFilter,
  setStatusFilter,
  allAgents,
  loadHistoryCache,
  historyState,
  inactiveAgents,
  allExperiments,
  usageFrequency,
  historyOrder,
  setHistoryOrder,
  scanHistory,
  historyLimit,
  setHistoryLimit,
  query,
  setQuery,
  gpuFilter,
  cwdFilter,
  chooseGpu,
  gpuOptions,
  gpuWindow,
  setGpuWindow,
  selectedGpu,
  gpuActivityEpisodes,
  setGpuFilter,
  openGpuEpisode,
  cwdOptions,
  statusCounts,
  statusFilter,
  hasPendingAgentOrder,
  setAgentOrderRevision,
  categoryFilter,
  setCategoryFilter,
}: Pick<
  WorkspaceController,
  | "hostFilter"
  | "viewMode"
  | "setViewMode"
  | "selectedProjectKey"
  | "setCwdFilter"
  | "setStatusFilter"
  | "allAgents"
  | "loadHistoryCache"
  | "historyState"
  | "inactiveAgents"
  | "allExperiments"
  | "usageFrequency"
  | "historyOrder"
  | "setHistoryOrder"
  | "scanHistory"
  | "historyLimit"
  | "setHistoryLimit"
  | "query"
  | "setQuery"
  | "gpuFilter"
  | "cwdFilter"
  | "chooseGpu"
  | "gpuOptions"
  | "gpuWindow"
  | "setGpuWindow"
  | "selectedGpu"
  | "gpuActivityEpisodes"
  | "setGpuFilter"
  | "openGpuEpisode"
  | "cwdOptions"
  | "statusCounts"
  | "statusFilter"
  | "hasPendingAgentOrder"
  | "setAgentOrderRevision"
  | "categoryFilter"
  | "setCategoryFilter"
>) {
  return (
    <div className="session-tools">
      <div className="mode-switch" role="tablist">
        <button
          className={viewMode === "agents" ? "active" : ""}
          onClick={() => {
            setViewMode("agents");
            if (!selectedProjectKey) setCwdFilter("all");
            setStatusFilter("all");
          }}
          role="tab"
          aria-selected={viewMode === "agents"}
        >
          <Command size={14} />
          Codex
          <span>{allAgents.length}</span>
        </button>
        <button
          className={viewMode === "history" ? "active" : ""}
          onClick={() => {
            setViewMode("history");
            if (!selectedProjectKey) setCwdFilter("all");
            setStatusFilter("all");
            void loadHistoryCache();
          }}
          role="tab"
          aria-selected={viewMode === "history"}
        >
          <BookOpen size={14} />
          Inactive
          <span>{historyState.scannedAt ? inactiveAgents.length : "—"}</span>
        </button>
        <button
          className={viewMode === "experiments" ? "active" : ""}
          onClick={() => {
            setViewMode("experiments");
            setCwdFilter("all");
          }}
          role="tab"
          aria-selected={viewMode === "experiments"}
        >
          <SquareTerminal size={14} />
          实验 tmux
          <span>{allExperiments.length}</span>
        </button>
      </div>
      <details className="usage-details">
        <summary>使用概览</summary>
        <div
          className="usage-frequency"
          aria-label="最近使用频度（基于当前已采集的 rollout）"
        >
          <div>
            <span>24h 新会话</span>
            <strong>{usageFrequency.started24h}</strong>
          </div>
          <div>
            <span>7d 活跃会话</span>
            <strong>{usageFrequency.active7d}</strong>
          </div>
          <div>
            <span>7d 活跃目录</span>
            <strong>{usageFrequency.activeCwds}</strong>
          </div>
          <div>
            <span>日均 / 高频主机</span>
            <strong>
              {usageFrequency.dailyAverage} · {usageFrequency.busiestHost}
            </strong>
            <small>{usageFrequency.busiestCount} 次活动</small>
          </div>
        </div>
      </details>
      {viewMode === "history" && (
        <div className="history-scan-controls">
          <div>
            <strong>按需扫描旧 Rollout</strong>
            <span>按远端最后一条真实事件筛选；切换顺序会重新扫描</span>
          </div>
          <label>
            <span>排序</span>
            <select
              value={historyOrder}
              onChange={(event) => {
                const requestedOrder = event.target.value as
                  "recent" | "oldest";
                setHistoryOrder(requestedOrder);
                if (historyState.scannedAt) {
                  void scanHistory(requestedOrder);
                }
              }}
              disabled={historyState.loading}
              aria-label="Inactive Session 排序"
            >
              <option value="recent">最近执行优先</option>
              <option value="oldest">最久未执行优先</option>
            </select>
          </label>
          <label>
            <span>上限</span>
            <select
              value={historyLimit}
              onChange={(event) => {
                const requestedLimit = Number(event.target.value);
                setHistoryLimit(requestedLimit);
                void loadHistoryCache(historyOrder, hostFilter, requestedLimit);
              }}
              disabled={historyState.loading}
            >
              <option value={50}>50 / 主机</option>
              <option value={100}>100 / 主机</option>
              <option value={300}>300 / 主机</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => scanHistory()}
            disabled={historyState.loading}
          >
            {historyState.loading ? (
              <LoaderCircle size={14} className="is-spinning" />
            ) : (
              <RefreshCw size={14} />
            )}
            {historyState.loading ? "扫描中" : "扫描历史"}
          </button>
          {historyState.scannedAt && (
            <small>
              {historyState.scope === "all"
                ? "全部在线主机"
                : historyState.scope}
              {" · "}
              {inactiveAgents.length} 条{" · "}
              {relativeTime(historyState.scannedAt)}
              {historyState.hosts.some((host) => host.truncated)
                ? " · 已达扫描上限"
                : ""}
              {historyState.hosts.some((host) => host.error)
                ? ` · ${
                    historyState.hosts.filter((host) => host.error).length
                  } 台主机失败`
                : ""}
            </small>
          )}
          {historyState.error && (
            <small className="history-scan-error">{historyState.error}</small>
          )}
        </div>
      )}
      <label className="session-search">
        <Search size={15} />
        <input
          placeholder="搜索目录、任务、主机或 tmux…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <details className="advanced-filters">
        <summary>
          更多筛选{gpuFilter !== "all" ? " · GPU 已筛选" : ""}
          {cwdFilter !== "all" ? " · 已选目录" : ""}
        </summary>
        <div className="gpu-filter-row">
          <label className="gpu-filter">
            <Cpu size={14} />
            <select
              value={gpuFilter}
              onChange={(event) => chooseGpu(event.target.value)}
              aria-label="按最近占用的 GPU 过滤"
            >
              <option value="all">全部 GPU</option>
              {gpuOptions.map((gpu) => (
                <option key={gpu.key} value={gpu.key}>
                  {gpu.host} · GPU {gpu.index}
                </option>
              ))}
            </select>
          </label>
          <div className="gpu-window-filter" aria-label="GPU 占用时间范围">
            {(
              [
                ["active", "当前"],
                ["1h", "1h"],
                ["6h", "6h"],
                ["24h", "24h"],
                ["168h", "7d"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={gpuWindow === value ? "active" : ""}
                onClick={() => setGpuWindow(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {selectedGpu && (
          <section className="gpu-activity-panel">
            <div className="gpu-activity-heading">
              <div>
                <strong>
                  {selectedGpu.host} · GPU {selectedGpu.index}
                </strong>
                <span>
                  {gpuActivityEpisodes.filter((episode) => episode.active)
                    .length || 0}{" "}
                  个当前任务 · {gpuActivityEpisodes.length} 个占用区间
                </span>
              </div>
              <button type="button" onClick={() => setGpuFilter("all")}>
                清除
              </button>
            </div>
            <div className="gpu-activity-list">
              {gpuActivityEpisodes.slice(0, 8).map((episode) => (
                <button
                  type="button"
                  key={episode.id}
                  className={episode.active ? "active" : ""}
                  onClick={() => openGpuEpisode(episode)}
                >
                  <span className="gpu-activity-state">
                    <i />
                    {episode.active
                      ? "正在占用"
                      : relativeTime(episode.lastSeenAt)}
                  </span>
                  <strong>
                    {episode.sessionTheme ||
                      episode.paneSession ||
                      `未归属进程 ${episode.pid}`}
                  </strong>
                  <span>
                    {episode.kind === "evaluation" ? "评测" : "训练"} · PID{" "}
                    {episode.pid} · 峰值 {episode.maxMemoryMiB} MiB
                  </span>
                  <span>
                    持续 {gpuEpisodeDuration(episode)}
                    {episode.ownerSessionId
                      ? ` · Session ${episode.ownerSessionId.slice(0, 8)}`
                      : " · 尚未可靠关联 Session"}
                  </span>
                </button>
              ))}
              {gpuActivityEpisodes.length === 0 && (
                <div className="gpu-activity-empty">
                  这个时间范围内尚未采集到 GPU 进程。新记录会随 15
                  秒轮询自动出现。
                </div>
              )}
            </div>
          </section>
        )}
        {viewMode !== "experiments" && (
          <label className="cwd-filter">
            <Folder size={14} />
            <select
              value={cwdFilter}
              onChange={(event) => setCwdFilter(event.target.value)}
              title={cwdFilter === "all" ? "全部工作目录" : cwdFilter}
            >
              <option value="all">全部工作目录</option>
              {cwdFilter !== "all" && !cwdOptions.includes(cwdFilter) && (
                <option value={cwdFilter}>{cwdFilter}</option>
              )}
              {cwdOptions.map((cwd) => (
                <option key={cwd} value={cwd}>
                  {cwd}
                </option>
              ))}
            </select>
          </label>
        )}
      </details>
      <div
        className={`status-filters ${viewMode !== "agents" ? "is-hidden" : ""}`}
        role="tablist"
      >
        {(
          [
            ["all", "全部", allAgents.length],
            ["working", "工作中", statusCounts.working],
            ["idle", "空闲", statusCounts.idle],
            ["attention", "需检查", statusCounts.attention],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            className={statusFilter === value ? "active" : ""}
            onClick={() => setStatusFilter(value)}
            role="tab"
            aria-selected={statusFilter === value}
          >
            {label}
            <span>{count}</span>
          </button>
        ))}
        <button
          type="button"
          className={`session-order-refresh ${
            hasPendingAgentOrder ? "has-updates" : ""
          }`}
          onClick={() => setAgentOrderRevision((revision) => revision + 1)}
          disabled={!hasPendingAgentOrder}
          title={
            hasPendingAgentOrder
              ? "实时内容已更新；按当前优先级、状态和活动时间重新排序"
              : "浏览期间卡片顺序保持固定"
          }
        >
          <RefreshCw size={12} />
          更新排序
          {hasPendingAgentOrder && <i aria-hidden="true" />}
        </button>
      </div>
      {viewMode !== "experiments" && (
        <div className="category-filters">
          {(
            [
              ["all", "全部主题"],
              ["research", "调研"],
              ["training", "训练"],
              ["evaluation", "评测"],
              ["engineering", "工程"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={categoryFilter === value ? "active" : ""}
              onClick={() => setCategoryFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
