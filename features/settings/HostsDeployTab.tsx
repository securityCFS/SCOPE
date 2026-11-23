"use client";
import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Rocket, Save, Server, Terminal, Trash2 } from "lucide-react";
import { ChoiceMenu } from "@/components/choice-menu";
import { AgentMaintenance } from "@/features/command-center/AgentMaintenance";
import { bridgeUrl } from "@/features/workspace/shared";
import type { Host } from "@/features/workspace/types";
import { LOCAL_HOST, hostLabel } from "@/lib/execution-host";
import { useLocale } from "@/lib/i18n";

type BootstrapReport = {
  user: string;
  isRoot: boolean;
  home: string;
  python3: string | null;
  node: string | null;
  npm: boolean;
  tmux: boolean;
  gpuCount: number;
  localBinInPath: boolean;
  systemdUserAvailable: boolean;
  clis: Record<string, { installed: boolean; executable: string | null; version: string | null }>;
  scopeNotify: {
    installed: boolean;
    executable: string | null;
    daemonActive: boolean;
    systemdServiceActive: boolean;
    relayReachable: boolean;
    queued: number;
    lastDeliveredAt: string | null;
    codexMcp: boolean;
    claudeMcp: boolean;
  };
};

type BootstrapState = {
  host: string | null;
  report: BootstrapReport | null;
  checkedAt: string | null;
  lastAction: string | null;
  tunnel: {
    enabled: boolean;
    remotePort: number;
    status: string;
    connectedAt: string | null;
    lastError: string | null;
  } | null;
  relay: {
    relayListening: boolean;
    relayPort: number;
    relayTokenReady: boolean;
  };
};

export function HostsDeployTab({ hosts }: { hosts: Host[] }) {
  const { tr } = useLocale();
  const remoteHosts = hosts.filter((h) => h.alias !== LOCAL_HOST);
  const onlineRemote = remoteHosts.filter((h) => h.reachable);
  const offlineRemote = remoteHosts.filter((h) => !h.reachable);
  const [selectedHost, setSelectedHost] = useState(
    () => onlineRemote[0]?.alias || remoteHosts[0]?.alias || "",
  );
  const [showOffline, setShowOffline] = useState(false);
  const activeHost = remoteHosts.some((h) => h.alias === selectedHost)
    ? selectedHost
    : onlineRemote[0]?.alias || remoteHosts[0]?.alias || "";
  const hostInfo = hosts.find((h) => h.alias === activeHost);

  // Per-host runtime proxy/sandbox state
  const [preLaunchCommand, setPreLaunchCommand] = useState("");
  const [yolo, setYolo] = useState(true);
  const [residentLimitDraft, setResidentLimitDraft] = useState("");
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [runtimeNotice, setRuntimeNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // Remote bootstrap state
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [bootstrapBusy, setBootstrapBusy] = useState("");
  const [bootstrapNotice, setBootstrapNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [remotePort, setRemotePort] = useState(4922);
  const [registerMcp, setRegisterMcp] = useState(true);
  const autoInspectedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeHost) return;
    let cancelled = false;
    const controller = new AbortController();

    fetch(bridgeUrl(`/api/runtime/config?host=${encodeURIComponent(activeHost)}`), {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.config) {
          setPreLaunchCommand(data.config.preLaunchCommand || "");
          setYolo(data.config.yolo !== false);
          setResidentLimitDraft(
            typeof data.config.residentSessionLimit === "number"
              ? String(data.config.residentSessionLimit)
              : "",
          );
          setRuntimeNotice(null);
        }
      })
      .catch(() => {});

    fetch(bridgeUrl(`/api/remote-bootstrap?host=${encodeURIComponent(activeHost)}`), {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data: BootstrapState) => {
        if (cancelled) return;
        setBootstrap(data);
        if (data?.tunnel?.remotePort) setRemotePort(data.tunnel.remotePort);
        setBootstrapNotice(null);
        if (!data?.report && hostInfo?.reachable && !autoInspectedRef.current.has(activeHost)) {
          autoInspectedRef.current.add(activeHost);
          setBootstrapBusy("inspect");
          void fetch(bridgeUrl("/api/remote-bootstrap"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ host: activeHost, action: "inspect" }),
            signal: controller.signal,
          })
            .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
            .then(({ ok, body }) => {
              if (!cancelled && ok) setBootstrap(body);
            })
            .catch(() => {})
            .finally(() => {
              if (!cancelled) setBootstrapBusy("");
            });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeHost, hostInfo?.reachable]);

  async function saveRuntime() {
    if (!activeHost) return;
    setRuntimeSaving(true);
    setRuntimeNotice(null);
    try {
      const response = await fetch(bridgeUrl("/api/runtime/config"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host: activeHost,
          preLaunchCommand,
          yolo,
          residentSessionLimit:
            residentLimitDraft.trim() === ""
              ? null
              : Number(residentLimitDraft.trim()),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || tr("保存失败", "Save failed"));
      setRuntimeNotice({
        kind: "success",
        text: tr("主机启动环境已保存，新启动会话立即生效。", "Host launch environment saved for future sessions."),
      });
    } catch (error) {
      setRuntimeNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setRuntimeSaving(false);
    }
  }

  async function runBootstrap(action: "inspect" | "deploy" | "remove") {
    if (!activeHost) return;
    setBootstrapBusy(action);
    setBootstrapNotice(null);
    try {
      const response = await fetch(bridgeUrl("/api/remote-bootstrap"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host: activeHost,
          action,
          remotePort,
          registerMcp,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || tr("操作失败", "Operation failed"));
      setBootstrap(result);
      setBootstrapNotice({
        kind: "success",
        text:
          action === "inspect"
            ? tr("远端主机环境检查完成。", "Remote host environment inspected.")
            : action === "deploy"
              ? tr("远端 Scope 服务与隧道已部署并启动。", "Remote Scope service and reverse tunnel deployed.")
              : tr("已停止并清理该主机的远端通知服务。", "Remote service and tunnel removed for this host."),
      });
    } catch (error) {
      setBootstrapNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBootstrapBusy("");
    }
  }

  if (!remoteHosts.length) {
    return (
      <div className="settings-hub-body">
        <div className="settings-card">
          <div className="settings-card-head">
            <div>
              <h2><Server size={16} />{tr("未发现远程 SSH 主机", "No SSH hosts found")}</h2>
              <p>
                {tr(
                  "请在本机 ~/.ssh/config 中添加 Host 别名，或通过 SCOPE_SSH_CONFIG 指定 SSH 配置文件路径。",
                  "Add Host entries to ~/.ssh/config or point SCOPE_SSH_CONFIG to your SSH config file.",
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const report = bootstrap?.report;
  const tunnel = bootstrap?.tunnel;
  const visibleOfflineRemote = showOffline
    ? offlineRemote
    : offlineRemote.filter((h) => h.alias === activeHost);
  const hiddenOfflineCount = offlineRemote.length - visibleOfflineRemote.length;
  const visibleRemote = [...onlineRemote, ...visibleOfflineRemote];

  return (
    <div className="settings-hub-body">
      <div className="settings-host-pills" role="tablist" aria-label={tr("选择远程主机", "Select remote host")}>
        {visibleRemote.map((host) => (
          <button
            key={host.alias}
            type="button"
            role="tab"
            aria-selected={host.alias === activeHost}
            className={`settings-host-pill ${host.alias === activeHost ? "active" : ""}`}
            onClick={() => setSelectedHost(host.alias)}
          >
            <span className={`dot ${host.reachable ? "online" : ""}`} />
            <span>{hostLabel(host.alias)}</span>
            {host.gpus.length > 0 && <small>({host.gpus.length} GPU)</small>}
          </button>
        ))}
        {offlineRemote.length > 0 && (showOffline || hiddenOfflineCount > 0) && (
          <button
            type="button"
            className="settings-host-pill offline-toggle"
            aria-expanded={showOffline}
            onClick={() => setShowOffline((value) => !value)}
          >
            {showOffline
              ? tr("收起离线设备", "Hide offline")
              : `+${hiddenOfflineCount} ${tr("台离线设备", "offline")}`}
          </button>
        )}
      </div>

      <div className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>
              <Terminal size={16} />
              {tr(`${activeHost} · 主机启动环境与出口代理`, `${activeHost} · Host Environment & Outbound Proxy`)}
            </h2>
            <p>
              {tr(
                "自定义该主机每次启动 Agent 之前运行的命令（如加载代理、Conda/模块环境或 PATH）。留空则直接启动，不附带任何预设代理命令。",
                "Optional shell commands executed before launching any Agent on this host (such as outbound proxy or PATH setup). Leave blank for direct launch.",
              )}
            </p>
          </div>
          <span className={`settings-badge ${hostInfo?.reachable ? "ok" : "warn"}`}>
            {hostInfo?.reachable ? tr("主机在线", "Online") : tr("主机离线", "Offline")}
          </span>
        </div>

        <div className="center-form-grid">
          <label className="span-full">
            {tr("启动前命令（Pre-launch command）", "Pre-launch command")}
            <textarea
              rows={3}
              value={preLaunchCommand}
              placeholder={tr(
                "例如：export https_proxy=http://127.0.0.1:7890 或 source ~/.proxy_env（留空则直连）",
                "Example: export https_proxy=http://127.0.0.1:7890 or source ~/.proxy_env (empty = direct)",
              )}
              onChange={(e) => {
                setPreLaunchCommand(e.target.value);
                setRuntimeNotice(null);
              }}
            />
          </label>
          <div className="settings-field">
            <span className="settings-field-label">
              {tr("Codex 默认会话权限", "Default Codex session permissions")}
            </span>
            <ChoiceMenu
              label={tr("Codex 默认会话权限", "Default Codex session permissions")}
              value={yolo ? "yolo" : "controlled"}
              options={[
                {
                  value: "yolo",
                  label: tr("完整权限（YOLO，免审批）", "Full access (no approval prompts)"),
                },
                {
                  value: "controlled",
                  label: tr("受控模式（按需审批、仅工作区可写）", "Controlled (approval on request, workspace write)"),
                },
              ]}
              onChange={(next) => {
                setYolo(next === "yolo");
                setRuntimeNotice(null);
              }}
            />
          </div>
          <label className="settings-field">
            <span className="settings-field-label">
              {tr("设备常驻会话池上限（留空跟随全局）", "Resident session pool (empty = global default)")}
            </span>
            <input
              type="number"
              min={0}
              max={64}
              value={residentLimitDraft}
              placeholder={tr("跟随全局设置", "Follow global policy")}
              onChange={(e) => {
                setResidentLimitDraft(e.target.value);
                setRuntimeNotice(null);
              }}
            />
          </label>
        </div>

        {runtimeNotice && (
          <p className={`settings-status-banner ${runtimeNotice.kind}`}>{runtimeNotice.text}</p>
        )}

        <div className="settings-actions">
          <button
            type="button"
            className="center-primary"
            disabled={runtimeSaving}
            onClick={() => void saveRuntime()}
          >
            <Save size={14} />
            {tr("保存主机环境", "Save host setup")}
          </button>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>
              <Rocket size={16} />
              {tr(`${activeHost} · 远端 Scope 服务一键部署`, `${activeHost} · One-Click Remote Scope Bootstrap`)}
            </h2>
            <p>
              {tr(
                "向远端用户目录（~/.local，无需 root）安装免密邮件回传工具 scope-notify、注册 Codex/Claude MCP，并建立安全的本机回环 SSH 反向隧道。",
                "Installs scope-notify into ~/.local (no root required), registers the Codex/Claude completion MCP server, and manages an encrypted loopback SSH reverse tunnel.",
              )}
            </p>
          </div>
          <span
            className={`settings-badge ${
              tunnel?.status === "connected"
                ? "ok"
                : tunnel?.enabled
                  ? "warn"
                  : ""
            }`}
          >
            {tunnel?.status === "connected"
              ? tr("隧道已连接", "Tunnel connected")
              : tunnel?.enabled
                ? `${tr("隧道状态", "Tunnel")}: ${tunnel.status}`
                : tr("隧道未开启", "Tunnel off")}
          </span>
        </div>

        {report && (
          <div className="settings-env-grid">
            <div className="settings-env-item">
              <span>{tr("远端用户 / 目录", "Remote user")}</span>
              <strong>{report.user} ({report.isRoot ? "root" : "non-root"})</strong>
            </div>
            <div className="settings-env-item">
              <span>Python / tmux / GPU</span>
              <strong>
                {report.python3 ? report.python3.replace("Python ", "py ") : "missing"} ·{" "}
                {report.tmux ? "tmux ok" : "no tmux"} · {report.gpuCount} GPU
              </strong>
            </div>
            <div className="settings-env-item">
              <span>scope-notify</span>
              <strong>
                {report.scopeNotify.installed
                  ? report.scopeNotify.daemonActive
                    ? tr("已安装 · 运行中", "Installed · active")
                    : tr("已安装 · 未运行", "Installed · stopped")
                  : tr("尚未部署", "Not installed")}
              </strong>
            </div>
            <div className="settings-env-item">
              <span>{tr("回传通路 / MCP", "Relay & MCP")}</span>
              <strong>
                {report.scopeNotify.relayReachable ? tr("回环可达", "Relay OK") : tr("未连通", "Unreachable")} ·{" "}
                {report.scopeNotify.codexMcp ? "Codex ✓" : "Codex -"} /{" "}
                {report.scopeNotify.claudeMcp ? "Claude ✓" : "Claude -"}
              </strong>
            </div>
          </div>
        )}

        {report && !report.localBinInPath && !report.isRoot && (
          <p className="settings-status-banner">
            {tr(
              `提示：远端 PATH 尚未包含 ${report.home}/.local/bin；MCP 已使用绝对路径注册，终端手动调用可将该目录加入 PATH。`,
              `Note: ${report.home}/.local/bin is not in remote PATH. MCP uses the absolute path automatically; add it to PATH for manual shell calls.`,
            )}
          </p>
        )}

        <div className="center-form-grid">
          <label className="settings-field">
            <span className="settings-field-label">
              {tr("远端回环监听端口", "Remote loopback port")}
            </span>
            <input
              type="number"
              min={1024}
              max={65535}
              value={remotePort}
              onChange={(e) => setRemotePort(Number(e.target.value) || 4922)}
            />
          </label>
          <div className="settings-field">
            <span className="settings-field-label">{tr("MCP 自动注册", "MCP Integration")}</span>
            <label className="settings-check-box-row">
              <input
                type="checkbox"
                checked={registerMcp}
                onChange={(e) => setRegisterMcp(e.target.checked)}
              />
              <span>{tr("自动注册 Codex / Claude 完成通知 MCP", "Register scope-email MCP in Codex & Claude")}</span>
            </label>
          </div>
        </div>

        {bootstrapNotice && (
          <p className={`settings-status-banner ${bootstrapNotice.kind}`}>{bootstrapNotice.text}</p>
        )}
        {tunnel?.lastError && (
          <p className="settings-status-banner error">{tunnel.lastError}</p>
        )}

        <div className="settings-actions">
          <button
            type="button"
            className="center-secondary"
            disabled={!hostInfo?.reachable || Boolean(bootstrapBusy)}
            onClick={() => void runBootstrap("inspect")}
          >
            <RefreshCw size={14} className={bootstrapBusy === "inspect" ? "is-spinning" : ""} />
            {tr("检查远端环境", "Inspect host")}
          </button>
          <button
            type="button"
            className="center-primary"
            disabled={!hostInfo?.reachable || Boolean(bootstrapBusy)}
            onClick={() => void runBootstrap("deploy")}
          >
            <Check size={14} />
            {bootstrapBusy === "deploy"
              ? tr("正在部署…", "Deploying…")
              : tr("一键部署远端服务", "One-click deploy")}
          </button>
          {report?.scopeNotify.installed && (
            <button
              type="button"
              className="center-secondary"
              disabled={!hostInfo?.reachable || Boolean(bootstrapBusy)}
              onClick={() => void runBootstrap("remove")}
            >
              <Trash2 size={14} />
              {tr("卸载通知服务", "Remove service")}
            </button>
          )}
        </div>
      </div>

      <AgentMaintenance
        hosts={hosts}
        selectedHost={activeHost}
        detectedClis={bootstrap?.host === activeHost ? bootstrap?.report?.clis : undefined}
      />
    </div>
  );
}
