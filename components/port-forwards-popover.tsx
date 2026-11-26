"use client";
import { useEffect, useRef, useState } from "react";
import {
  Cable,
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  Square,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { usePortForwards } from "@/features/conversation/use-port-forwards";
import "@/components/subagent-display-toggles.css";
import "./port-forwards-popover.css";

async function copyUrl(url: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      /* fallback below */
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function PortForwardsPopover({
  host,
  cwd,
}: {
  host?: string;
  cwd?: string;
}) {
  const { tr } = useLocale();
  const [open, setOpen] = useState(false);
  const [manualPort, setManualPort] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const anchorRef = useRef<HTMLDivElement>(null);

  const {
    isRemote,
    state,
    loading,
    busyPort,
    autoBusy,
    actionError,
    refresh,
    forwardPort,
    stopPort,
    setAutoForward,
  } = usePortForwards(host, cwd, { open });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        anchorRef.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!isRemote || !host) return null;

  const activeForwards = state?.forwards || [];
  const activeRemotePorts = new Set(activeForwards.map((f) => f.remotePort));
  const availableDiscovered = (state?.discovered || []).filter(
    (item) => !activeRemotePorts.has(item.port),
  );
  const badgeCount = activeForwards.length || availableDiscovered.length;
  const hasActive = activeForwards.length > 0;
  const autoEnabled = Boolean(state?.autoForward);

  const handleManualSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = Number(manualPort.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return;
    const forwarded = await forwardPort(parsed);
    if (forwarded) setManualPort("");
  };

  return (
    <div className="port-forwards-anchor" ref={anchorRef}>
      <button
        type="button"
        className="session-info-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void refresh();
        }}
        title={tr(
          "查看远端监听端口并一键 SSH 转发到本地浏览器",
          "Inspect remote listening ports and forward them via SSH",
        )}
      >
        {hasActive && <span className="port-forwards-trigger-dot" />}
        <Cable size={13} />
        <span>
          {badgeCount > 0
            ? tr(`端口 · ${badgeCount}`, `Ports · ${badgeCount}`)
            : tr("端口", "Ports")}
        </span>
      </button>

      {open && (
        <div
          className="port-forwards-popover"
          role="dialog"
          aria-label={tr("SSH 端口转发", "SSH Port Forwarding")}
        >
          <div className="port-forwards-head">
            <span className="port-forwards-head-title">
              <Cable size={13} />
              <span>{tr("SSH 端口转发", "SSH Port Forwarding")}</span>
              <span className="port-forwards-head-host">{host}</span>
            </span>
            <button
              type="button"
              className="port-forwards-icon-btn"
              disabled={loading}
              onClick={() => void refresh()}
              title={tr("重新扫描远端监听端口", "Rescan remote listening ports")}
            >
              <RefreshCw size={12} className={loading ? "is-spinning" : ""} />
              {tr("扫描", "Scan")}
            </button>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={autoEnabled}
            disabled={autoBusy}
            className="port-forwards-auto-row"
            onClick={() => void setAutoForward(!autoEnabled)}
          >
            <span className="port-forwards-auto-copy">
              <strong>
                {tr("自动转发新发现端口", "Auto-forward new ports")}
              </strong>
              <small>
                {tr(
                  "检测到 Agent 启动 Web / TensorBoard / Jupyter 等服务时自动映射到本地 127.0.0.1",
                  "Automatically forward newly detected web / TensorBoard / Jupyter ports to 127.0.0.1",
                )}
              </small>
            </span>
            <span
              className={`scope-switch${autoEnabled ? " is-checked" : ""}`}
              aria-hidden="true"
            >
              <span className="scope-switch-thumb" />
            </span>
          </button>

          <div className="port-forwards-body">
            {(actionError || state?.error) && (
              <p className="port-forwards-error" role="alert">
                {actionError || state?.error}
              </p>
            )}

            {activeForwards.length > 0 && (
              <div className="port-forwards-section">
                <div className="port-forwards-section-label">
                  <span>
                    {tr(
                      `已转发 (${activeForwards.length})`,
                      `Forwarded (${activeForwards.length})`,
                    )}
                  </span>
                </div>
                {activeForwards.map((item) => {
                  const busy = busyPort === item.remotePort;
                  const copied = copiedKey === `${item.remotePort}`;
                  return (
                    <div
                      key={item.remotePort}
                      className="port-forwards-row is-active"
                    >
                      <div className="port-forwards-row-info">
                        <div className="port-forwards-row-top">
                          <span className="port-forwards-trigger-dot" />
                          <span className="port-forwards-service">
                            {item.label}
                          </span>
                          {item.auto && (
                            <span className="port-forwards-tag">
                              {tr("自动", "Auto")}
                            </span>
                          )}
                        </div>
                        <span
                          className="port-forwards-mapping"
                          title={`remote:${item.remotePort} -> ${item.localUrl}`}
                        >
                          :{item.remotePort} → 127.0.0.1:{item.localPort}
                        </span>
                      </div>
                      <div className="port-forwards-row-actions">
                        <a
                          href={item.localUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="port-forwards-icon-btn is-primary"
                          style={{ textDecoration: "none" }}
                          title={item.localUrl}
                        >
                          <ExternalLink size={11} />
                          {tr("打开", "Open")}
                        </a>
                        <button
                          type="button"
                          className="port-forwards-icon-btn"
                          title={tr("复制本地地址", "Copy local URL")}
                          onClick={async () => {
                            if (await copyUrl(item.localUrl)) {
                              setCopiedKey(`${item.remotePort}`);
                              setTimeout(
                                () =>
                                  setCopiedKey((prev) =>
                                    prev === `${item.remotePort}` ? "" : prev,
                                  ),
                                1600,
                              );
                            }
                          }}
                        >
                          {copied ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                        <button
                          type="button"
                          className="port-forwards-icon-btn is-danger"
                          disabled={busy}
                          title={tr("停止转发", "Stop forwarding")}
                          onClick={() => void stopPort(item.remotePort)}
                        >
                          {busy ? (
                            <LoaderCircle size={11} className="is-spinning" />
                          ) : (
                            <Square size={10} />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="port-forwards-section">
              <div className="port-forwards-section-label">
                <span>
                  {tr(
                    `远端检测到的服务端口 (${availableDiscovered.length})`,
                    `Detected remote ports (${availableDiscovered.length})`,
                  )}
                </span>
              </div>
              {availableDiscovered.length === 0 ? (
                <p className="port-forwards-empty">
                  {loading
                    ? tr("正在扫描远端监听端口…", "Scanning remote listening ports…")
                    : tr(
                        "当前未检测到待转发的用户服务端口；你也可以在下方直接输入端口号一键转发。",
                        "No unforwarded user service ports detected; enter any remote port below to forward.",
                      )}
                </p>
              ) : (
                availableDiscovered.map((item) => {
                  const busy = busyPort === item.port;
                  return (
                    <div key={item.port} className="port-forwards-row">
                      <div className="port-forwards-row-info">
                        <div className="port-forwards-row-top">
                          <span className="port-forwards-service">
                            {item.label}
                          </span>
                          <span className="port-forwards-tag">
                            :{item.port}
                          </span>
                          {item.inProject && (
                            <span className="port-forwards-tag is-project">
                              {tr("当前项目", "Project")}
                            </span>
                          )}
                        </div>
                        <span
                          className="port-forwards-mapping"
                          title={item.cmdline || item.procName}
                        >
                          {item.cmdline || item.procName || `${item.bind}:${item.port}`}
                        </span>
                      </div>
                      <div className="port-forwards-row-actions">
                        <button
                          type="button"
                          className="port-forwards-icon-btn is-primary"
                          disabled={busy}
                          onClick={async () => {
                            const fwd = await forwardPort(item.port, item.label);
                            if (fwd?.localUrl) {
                              window.open(fwd.localUrl, "_blank", "noopener,noreferrer");
                            }
                          }}
                        >
                          {busy ? (
                            <LoaderCircle size={11} className="is-spinning" />
                          ) : (
                            <ExternalLink size={11} />
                          )}
                          {tr("转发打开", "Forward")}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <form className="port-forwards-manual" onSubmit={handleManualSubmit}>
            <input
              type="number"
              min={1}
              max={65535}
              inputMode="numeric"
              value={manualPort}
              onChange={(event) => setManualPort(event.target.value)}
              placeholder={tr(
                "手动输入远端端口（如 6006、8080）",
                "Remote port (e.g. 6006, 8080)",
              )}
              aria-label={tr("远端端口号", "Remote port number")}
            />
            <button
              type="submit"
              className="port-forwards-icon-btn is-primary"
              disabled={
                !manualPort.trim() ||
                busyPort !== null ||
                Number(manualPort) < 1 ||
                Number(manualPort) > 65535
              }
            >
              {busyPort !== null && busyPort === Number(manualPort) ? (
                <LoaderCircle size={12} className="is-spinning" />
              ) : (
                <Plus size={12} />
              )}
              {tr("一键转发", "Forward")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
