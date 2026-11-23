"use client";
import type { Host } from "@/features/workspace/types";
import { hostLabel } from "@/lib/execution-host";
import { useLocale } from "@/lib/i18n";
import { AlertCircle, ChevronRight, Cpu, Server } from "lucide-react";
import type { TaskRecord } from "./types";

function cleanHostError(
  raw: string | null | undefined,
  tr: (zh: string, en: string) => string,
) {
  if (!raw) return tr("连接不可达", "Unreachable");
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|@{4,}/i.test(raw)) {
    return tr(
      "SSH 主机指纹已变更，请在终端更新 known_hosts",
      "SSH host key changed — refresh known_hosts",
    );
  }
  const singleLine = raw.replace(/\s+/g, " ").trim();
  return singleLine.length > 90 ? `${singleLine.slice(0, 89)}…` : singleLine;
}

export function ResourceOverview({
  hosts,
  tasks,
  onSelectHost,
}: {
  hosts: Host[];
  tasks: TaskRecord[];
  onSelectHost?: (alias: string) => void;
}) {
  const { tr } = useLocale();
  const onlineHosts = hosts
    .filter((host) => host.reachable)
    .sort(
      (a, b) =>
        b.gpus.length - a.gpus.length ||
        b.agents.length - a.agents.length ||
        a.alias.localeCompare(b.alias),
    );
  const offlineHosts = hosts.filter((host) => !host.reachable);
  const totalGpus = onlineHosts.reduce((sum, host) => sum + host.gpus.length, 0);
  const totalSessions = onlineHosts.reduce(
    (sum, host) => sum + host.agents.length,
    0,
  );

  return (
    <section className="resource-overview" aria-label={tr("主机与资源", "Hosts & Resources")}>
      <header className="center-page-heading">
        <div>
          <span className="center-eyebrow">
            {tr("SCOPE / 资源", "SCOPE / Resources")}
          </span>
          <h1>{tr("知道工作在哪里运行。", "See where every job runs.")}</h1>
          <p>
            {tr(
              "仅展示当前在线主机与 GPU 负载；离线或认证失败节点默认折叠在下方。",
              "Showing online hosts and live GPUs; unreachable hosts are collapsed below.",
            )}
          </p>
        </div>
        {hosts.length > 0 && (
          <div className="resource-summary-strip">
            <span>
              <strong>{onlineHosts.length}</strong> / {hosts.length}{" "}
              {tr("在线主机", "Online")}
            </span>
            <span>
              <strong>{totalGpus}</strong> GPU
            </span>
            <span>
              <strong>{totalSessions}</strong> {tr("活动会话", "Active sessions")}
            </span>
          </div>
        )}
      </header>

      {onlineHosts.length > 0 && (
        <div className="resource-grid">
          {onlineHosts.map((host) => {
            const activeTasks = tasks.filter(
              (t) =>
                t.host === host.alias &&
                ["starting", "running", "waiting", "unknown"].includes(
                  t.status,
                ),
            ).length;
            return (
              <article className="resource-card center-card" key={host.alias}>
                <header>
                  <Server size={18} />
                  <strong>{hostLabel(host.alias)}</strong>
                  <span className="resource-status online">
                    {tr("在线", "Online")}
                  </span>
                </header>
                <p className="resource-hostname" title={host.hostname || ""}>
                  {host.hostname || host.alias}
                </p>
                {(host.stale || host.inventoryError) && (
                  <p className="center-error">
                    {cleanHostError(host.inventoryError, tr)}
                  </p>
                )}
                <div className="resource-metrics">
                  <span>
                    <strong>{host.agents.length}</strong>{" "}
                    {tr("活动会话", "Sessions")}
                  </span>
                  <span>
                    <strong>{activeTasks}</strong> {tr("工作台占用", "Tasks")}
                  </span>
                  {onSelectHost && (
                    <button
                      type="button"
                      className="resource-jump"
                      onClick={() => onSelectHost(host.alias)}
                    >
                      {tr("查看会话", "Sessions")}
                      <ChevronRight size={13} />
                    </button>
                  )}
                </div>
                {host.gpus.length ? (
                  host.gpus.map((gpu) => {
                    const percent = gpu.memoryTotal
                      ? Math.min(
                          100,
                          Math.round((gpu.memoryUsed / gpu.memoryTotal) * 100),
                        )
                      : 0;
                    return (
                      <div className="resource-gpu" key={gpu.index}>
                        <div>
                          <Cpu size={14} />
                          <strong>GPU {gpu.index}</strong>
                          <span title={gpu.name}>{gpu.name}</span>
                        </div>
                        <div
                          className="resource-gpu-bar"
                          role="progressbar"
                          aria-valuenow={percent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${host.alias} GPU ${gpu.index} 显存使用率`}
                        >
                          <div
                            className="resource-gpu-fill"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <small>
                          {gpu.memoryUsed.toLocaleString()} /{" "}
                          {gpu.memoryTotal.toLocaleString()} MiB ·{" "}
                          {tr("计算利用率", "Compute")} {gpu.utilization}%
                        </small>
                      </div>
                    );
                  })
                ) : (
                  <p className="resource-no-gpu">
                    {tr("未发现 GPU，可运行通用任务", "CPU host · general workloads")}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {offlineHosts.length > 0 && (
        <details
          className="resource-offline-section"
          open={onlineHosts.length === 0}
        >
          <summary>
            <AlertCircle size={15} />
            <strong>
              {tr(
                `已折叠 ${offlineHosts.length} 台不可用 / 离线主机`,
                `${offlineHosts.length} unreachable / offline hosts collapsed`,
              )}
            </strong>
            <span>{tr("点击展开连接诊断", "Click to inspect connection errors")}</span>
          </summary>
          <div className="resource-offline-grid">
            {offlineHosts.map((host) => {
              const reason = cleanHostError(
                host.error || host.inventoryError,
                tr,
              );
              return (
                <div className="resource-offline-item" key={host.alias}>
                  <div>
                    <span className="dot" />
                    <strong>{hostLabel(host.alias)}</strong>
                  </div>
                  <p title={host.error || host.inventoryError || ""}>
                    {reason}
                  </p>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {!hosts.length && (
        <div className="queue-empty">
          <Server size={24} />
          <strong>{tr("连接你的工作主机", "Connect your hosts")}</strong>
          <p>
            {tr(
              "配置 SSH 主机并完成首次扫描后，资源会显示在这里。",
              "Configure SSH aliases and complete a scan to monitor resources here.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}
