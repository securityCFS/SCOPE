"use client";
import { useEffect, useState } from "react";
import { ArrowUpCircle, Cpu, Download, RefreshCw } from "lucide-react";
import { bridgeUrl } from "@/features/workspace/shared";
import { LOCAL_HOST } from "@/lib/execution-host";
import { AgentLogo } from "@/components/agent-logo";
import { ChoiceMenu } from "@/components/choice-menu";
import type { Host } from "@/features/workspace/types";
import { useLocale } from "@/lib/i18n";

type Job = {
  id: string;
  status: string;
  action: string;
  log?: string;
  error?: string;
  info?: {
    installed?: string;
    latest?: string;
    latestError?: string | null;
    executable?: string;
    supported: boolean;
    channel?: string;
  };
};
type Row = { provider: string; job: Job | null };

type CodexUpgradeJob = {
  host: string;
  status: string;
  phase: string;
  action: string;
  error?: string;
  info?: { installed: string; latest: string; executable: string; supported: boolean; backup?: string };
  runningVersions: { connectionKey: string; version: string | null; status: string; sessions: number }[];
  results: { sessionId: string; ok: boolean; error?: string }[];
};

export type DetectedCliMap = Record<
  string,
  { installed: boolean; executable: string | null; version: string | null }
>;

const names: Record<string, string> = {
  codex: "Codex",
  claude: "Claude Code",
  antigravity: "Antigravity",
  dsh: "DSH",
};

function extractSemver(value?: string | null) {
  if (!value) return null;
  const match = String(value).match(/\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?/);
  return match ? match[0] : null;
}

function isNewerVersion(latest?: string | null, installed?: string | null) {
  const latestSemver = extractSemver(latest);
  const installedSemver = extractSemver(installed);
  if (!latestSemver) return false;
  if (!installedSemver) return true;
  const a = latestSemver.split("-")[0].split(".").map(Number);
  const b = installedSemver.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return latestSemver !== installedSemver;
}

export function AgentMaintenance({
  hosts,
  selectedHost,
  detectedClis,
}: {
  hosts: Host[];
  selectedHost?: string;
  detectedClis?: DetectedCliMap;
}) {
  const { tr } = useLocale();
  const remote = hosts.filter((h) => h.alias !== LOCAL_HOST);
  const [localHost, setLocalHost] = useState(
    remote.find((h) => h.reachable)?.alias || "",
  );
  const host = selectedHost ?? localHost;
  const hostReachable = Boolean(host && hosts.find((h) => h.alias === host)?.reachable);

  const [data, setData] = useState<{ host: string; rows: Row[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [checkingAll, setCheckingAll] = useState(false);
  const [reload, setReload] = useState(0);

  const [codexUpgradeState, setCodexUpgradeState] = useState<{
    host: string;
    job: CodexUpgradeJob | null;
  } | null>(null);
  const [codexUpgradeError, setCodexUpgradeError] = useState("");
  const [codexUpgradeSending, setCodexUpgradeSending] = useState(false);

  const statuses: Record<string, string> = {
    starting: tr("正在启动", "Starting"),
    running: tr("正在执行", "Running"),
    unknown: tr("等待远端确认", "Awaiting confirmation"),
    failed: tr("检查未通过", "Failed"),
    completed: tr("就绪", "Ready"),
  };

  useEffect(() => {
    if (!host) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(
          bridgeUrl(`/api/agents/maintenance?host=${encodeURIComponent(host)}`),
          { signal: abort.signal, cache: "no-store" },
        );
        const result = await response.json();
        if (!response.ok) {
          throw new Error(
            result.error || tr("无法读取安装状态", "Failed to read installation status"),
          );
        }
        if (!abort.signal.aborted) {
          setData({ host, rows: result.agents });
          setError("");
        }
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        if (!abort.signal.aborted) {
          timer = setTimeout(refresh, 4000);
        }
      }
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [host, reload, tr]);

  useEffect(() => {
    if (!host || !hostReachable) {
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function pollUpgrade() {
      try {
        const response = await fetch(
          bridgeUrl(`/api/codex/upgrade?host=${encodeURIComponent(host)}`),
          { signal: abort.signal, cache: "no-store" },
        );
        if (!response.ok) return;
        const next = (await response.json()) as CodexUpgradeJob | null;
        if (disposed) return;
        setCodexUpgradeState({ host, job: next });
        setCodexUpgradeError("");
        timer = setTimeout(pollUpgrade, next?.status === "running" ? 2000 : 15000);
      } catch {
        /* ignore transient polling failures */
      }
    }
    void pollUpgrade();
    return () => {
      disposed = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [host, hostReachable, reload]);

  async function act(provider: string, action: string) {
    setBusy(provider);
    setError("");
    try {
      const response = await fetch(bridgeUrl("/api/agents/maintenance"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host, provider, action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || tr("操作失败", "Action failed"));
      setData((value) => ({
        host,
        rows: Object.keys(names).map((id) => ({
          provider: id,
          job:
            id === provider
              ? result.job
              : value?.host === host
                ? value.rows.find((r) => r.provider === id)?.job || null
                : null,
        })),
      }));
      setReload((value) => value + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function checkAll() {
    if (!host || !hostReachable || checkingAll || busy) return;
    setCheckingAll(true);
    setError("");
    try {
      for (const provider of Object.keys(names)) {
        await fetch(bridgeUrl("/api/agents/maintenance"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ host, provider, action: "check" }),
        }).catch(() => {});
      }
      setReload((value) => value + 1);
    } finally {
      setCheckingAll(false);
    }
  }

  async function runCodexUpgrade(action: "check" | "upgrade") {
    if (
      action === "upgrade" &&
      !window.confirm(
        tr(
          `升级 ${host} 的 npm 全局 Codex 并安全切换 SCOPE 托管会话？工作中的会话会跳过不会中断，也不会重发指令。`,
          `Upgrade global Codex on ${host} and safely restart idle SCOPE-managed sessions? Active turns are untouched.`,
        ),
      )
    ) {
      return;
    }
    setCodexUpgradeSending(true);
    setCodexUpgradeError("");
    try {
      const response = await fetch(bridgeUrl("/api/codex/upgrade"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, action, confirmation: `upgrade:${host}` }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || tr("升级请求失败", "Upgrade failed"));
      setCodexUpgradeState({ host, job: result });
      setReload((value) => value + 1);
    } catch (e) {
      setCodexUpgradeError((e as Error).message);
    } finally {
      setCodexUpgradeSending(false);
    }
  }

  const rows =
    data?.host === host
      ? data.rows
      : Object.keys(names).map((provider) => ({ provider, job: null }));

  const codexUpgrade =
    hostReachable && codexUpgradeState?.host === host ? codexUpgradeState.job : null;
  const codexBusy = codexUpgradeSending || codexUpgrade?.status === "running";

  return (
    <section
      className="settings-card"
      aria-label={tr("远端 Agent CLI 版本与升级", "Remote Agent CLIs & Upgrades")}
    >
      <div className="settings-card-head">
        <div>
          <h2>
            <Cpu size={16} />
            {tr("远端 Agent CLI 版本与升级", "Remote Agent CLIs & Upgrades")}
          </h2>
          <p>
            {tr(
              "自动显示已探测的 CLI 版本；支持按需检查、安装、更新，以及 Codex 托管会话无损热切换。",
              "Inspect installed CLI versions, update supported CLIs, or safely hot-swap idle Codex managed sessions.",
            )}
          </p>
        </div>
        <button
          type="button"
          className="center-secondary"
          disabled={!hostReachable || checkingAll || Boolean(busy)}
          onClick={() => void checkAll()}
        >
          <RefreshCw size={14} className={checkingAll ? "is-spinning" : ""} />
          {checkingAll ? tr("正在检查…", "Checking…") : tr("检查全部", "Check all")}
        </button>
      </div>

      {selectedHost === undefined && (
        <div className="settings-field" style={{ maxWidth: 320 }}>
          <span className="settings-field-label">{tr("远端设备", "Remote host")}</span>
          <ChoiceMenu
            label={tr("远端设备", "Remote host")}
            value={host}
            disabled={Boolean(busy)}
            options={[
              { value: "", label: tr("选择设备", "Select host") },
              ...remote.map((h) => ({
                value: h.alias,
                label: h.alias,
                description: h.reachable ? tr("在线", "Online") : tr("离线", "Offline"),
                disabled: !h.reachable,
              })),
            ]}
            onChange={(value) => {
              setLocalHost(value);
              setError("");
            }}
          />
        </div>
      )}

      {error && <p className="settings-status-banner error">{error}</p>}
      {codexUpgradeError && <p className="settings-status-banner error">{codexUpgradeError}</p>}

      <div className="cli-maint-list">
        {rows.map(({ provider, job }) => {
          const detected = detectedClis?.[provider];
          const installedVersion = job?.info?.installed || detected?.version || null;
          const isInstalled = Boolean(installedVersion || detected?.installed);
          const active =
            Boolean(job && ["starting", "running", "unknown"].includes(job.status)) ||
            busy === provider;
          const disabled = !hostReachable || Boolean(busy) || checkingAll || active;
          const hasActionError = job?.status === "failed";
          const hasUpdate = isNewerVersion(job?.info?.latest, installedVersion);
          const upToDate = Boolean(
            isInstalled &&
              job?.info?.latest &&
              !hasUpdate &&
              extractSemver(installedVersion),
          );

          return (
            <article className="cli-maint-row" key={provider}>
              <div className="cli-maint-main">
                <div className="cli-maint-identity">
                  <AgentLogo provider={provider} />
                  <strong>{names[provider] || provider}</strong>
                  {isInstalled ? (
                    <span className="settings-badge ok" title={job?.info?.executable || detected?.executable || ""}>
                      {installedVersion || tr("已安装", "Installed")}
                    </span>
                  ) : job?.info ? (
                    <span className="settings-badge">{tr("未安装", "Not installed")}</span>
                  ) : (
                    <span className="settings-badge">{tr("待检查", "Unchecked")}</span>
                  )}
                  {hasUpdate && job?.info?.latest && (
                    <span className="settings-badge warn">
                      {tr("可更新", "Update")} {job.info.latest}
                    </span>
                  )}
                  {upToDate && (
                    <span className="settings-badge ok">
                      {tr("已是最新", "Up to date")}
                    </span>
                  )}
                  {active && (
                    <span className="settings-badge warn">
                      {statuses[job?.status || "running"] || tr("进行中", "Working")}
                    </span>
                  )}
                </div>

                <div className="cli-maint-actions">
                  <button
                    type="button"
                    className="center-secondary"
                    disabled={disabled}
                    onClick={() => void act(provider, "check")}
                  >
                    <RefreshCw size={13} className={active ? "is-spinning" : ""} />
                    {tr("检查", "Check")}
                  </button>
                  {job?.info && provider !== "antigravity" && (
                    <button
                      type="button"
                      className="center-secondary"
                      disabled={disabled || !job.info.supported}
                      onClick={() =>
                        void act(provider, isInstalled ? "update" : "install")
                      }
                    >
                      <Download size={13} />
                      {isInstalled ? tr("更新", "Update") : tr("安装", "Install")}
                    </button>
                  )}
                  {provider === "codex" && isInstalled && (
                    <button
                      type="button"
                      className="center-secondary"
                      disabled={!hostReachable || codexBusy}
                      onClick={() => void runCodexUpgrade("upgrade")}
                    >
                      <ArrowUpCircle size={13} />
                      {codexUpgrade?.status === "pending-switch"
                        ? tr("重试切换会话", "Retry switch")
                        : tr("安全热升级会话", "Safe upgrade")}
                    </button>
                  )}
                </div>
              </div>

              {provider === "codex" && codexUpgrade && (
                <p className="cli-maint-meta" role="status">
                  {codexUpgrade.status === "running"
                    ? tr(`Codex 升级中 (${codexUpgrade.phase})…`, `Codex upgrade running (${codexUpgrade.phase})…`)
                    : codexUpgrade.status === "pending-switch"
                      ? tr("Codex 已升级，存在工作中的会话待空闲后切换。", "Codex upgraded; waiting to switch busy sessions.")
                      : codexUpgrade.status === "failed"
                        ? `${tr("升级异常", "Upgrade error")}：${codexUpgrade.error || ""}`
                        : codexUpgrade.runningVersions?.length
                          ? codexUpgrade.runningVersions
                              .map((r) => `${r.connectionKey}: v${r.version || "?"} (${r.sessions})`)
                              .join(" · ")
                          : tr("Codex 托管版本与会话状态一致。", "Codex runtime up to date.")}
                </p>
              )}

              {provider === "antigravity" && (
                <p className="cli-maint-meta">
                  {tr(
                    "支持版本探测；安装与更新请通过官方原生安装器完成。",
                    "Supports version detection; install or update via the official installer.",
                  )}
                </p>
              )}

              {hasActionError && job?.error && (
                <p className="cli-maint-meta" style={{ color: "var(--red)" }}>
                  {job.error}
                </p>
              )}

              {!hasActionError && job?.info?.latestError && provider !== "antigravity" && (
                <p className="cli-maint-meta">
                  {tr(
                    `未获取到远端最新版本（${job.info.latestError}）。若需通过独立代理访问 npm/下载源，请在上方填写「CLI 更新前命令」。`,
                    `Could not fetch latest version (${job.info.latestError}). If package registries require a separate proxy, set "CLI update pre-command" above.`,
                  )}
                </p>
              )}

              {job?.info && !job.info.supported && provider !== "antigravity" && (
                <p className="cli-maint-meta">
                  {tr(
                    "当前通过独立/外部路径安装，暂不从界面覆盖升级；请使用原安装渠道更新。",
                    "Installed outside npm/managed paths; update using its original package channel.",
                  )}
                </p>
              )}

              {job?.log && (
                <details className="cli-maint-log">
                  <summary>{tr("查看检查日志", "View logs")}</summary>
                  <pre>{job.log}</pre>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
