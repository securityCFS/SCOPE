"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Cable,
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";
import {
  isRemoteBrowserLocation,
  portForwardAccessUrl,
} from "@/lib/remote-ports";
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

const noopSubscribe = () => () => {};

export function PortForwardsPopover({
  host,
  cwd,
  allowLocal = false,
}: {
  host?: string;
  cwd?: string;
  allowLocal?: boolean;
}) {
  const { tr } = useLocale();
  const [open, setOpen] = useState(false);
  const isRemoteView = useSyncExternalStore(
    noopSubscribe,
    () => isRemoteBrowserLocation(),
    () => false,
  );
  const [manualPort, setManualPort] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const [desktopPos, setDesktopPos] = useState<{ top: number; right: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const updatePopoverPosition = useCallback(() => {
    if (typeof window === "undefined" || !anchorRef.current) return;
    if (window.innerWidth <= 720) {
      setDesktopPos(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 120, Math.max(12, Math.round(rect.bottom + 8)));
    const right = Math.max(12, Math.round(window.innerWidth - rect.right));
    setDesktopPos({ top, right });
  }, []);

  const {
    isLocal,
    enabled,
    state,
    loading,
    busyPort,
    autoBusy,
    actionError,
    refresh,
    forwardPort,
    stopPort,
    setAutoForward,
  } = usePortForwards(host, cwd, { open, allowLocal });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        anchorRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onViewportChange = () => updatePopoverPosition();
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, updatePopoverPosition]);

  if (!enabled || !host) return null;

  const activeForwards = state?.forwards || [];
  const activeRemotePorts = new Set(activeForwards.map((f) => f.remotePort));
  const availableDiscovered = (state?.discovered || []).filter(
    (item) => !activeRemotePorts.has(item.port),
  );
  const badgeCount = activeForwards.length || availableDiscovered.length;
  const hasActive = activeForwards.length > 0;
  const autoEnabled = Boolean(state?.autoForward);

  const resolveOpenUrl = (localPort: number) =>
    portForwardAccessUrl(localPort, {
      pathAndQuery: "/",
      location: isRemoteView && typeof window !== "undefined" ? window.location : null,
    });

  const openPortWithGesture = async (port: number, label?: string) => {
    const popup = window.open("about:blank", "_blank");
    if (popup) {
      try {
        popup.opener = null;
      } catch {
        /* ignore */
      }
    }
    const fwd = await forwardPort(port, label);
    if (fwd?.localPort) {
      const nextUrl = resolveOpenUrl(fwd.localPort);
      if (popup && !popup.closed) {
        popup.location.href = nextUrl;
      } else {
        window.open(nextUrl, "_blank", "noopener,noreferrer");
      }
    } else if (popup && !popup.closed) {
      popup.close();
    }
  };

  const handleManualSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = Number(manualPort.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return;
    const forwarded = await forwardPort(parsed);
    if (forwarded) setManualPort("");
  };

  const portalContainer =
    typeof document !== "undefined"
      ? document.querySelector(".monitor-shell") || document.body
      : null;

  const popoverStyle: CSSProperties | undefined = desktopPos
    ? { top: `${desktopPos.top}px`, right: `${desktopPos.right}px` }
    : undefined;

  return (
    <div className="port-forwards-anchor" ref={anchorRef}>
      <button
        type="button"
        className="session-info-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          const next = !open;
          if (next) updatePopoverPosition();
          setOpen(next);
          if (next) void refresh();
        }}
        title={
          isLocal
            ? tr(
                "查看本机监听端口并通过安全代理打开",
                "Inspect local listening ports and open via secure proxy",
              )
            : tr(
                "查看远端监听端口并一键 SSH 转发到当前浏览器",
                "Inspect remote listening ports and forward them via SSH",
              )
        }
      >
        {hasActive && <span className="port-forwards-trigger-dot" />}
        <Cable size={13} />
        <span>
          {badgeCount > 0
            ? tr(`端口 (${badgeCount})`, `Ports (${badgeCount})`)
            : tr("端口", "Ports")}
        </span>
      </button>

      {open && portalContainer && createPortal(
        <>
          <div
            className="port-forwards-backdrop"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div
            ref={popoverRef}
            className="port-forwards-popover"
            style={popoverStyle}
            role="dialog"
            aria-label={
              isLocal
                ? tr("本机服务端口", "Local Service Ports")
                : tr("SSH 端口转发", "SSH Port Forwarding")
            }
          >
          <div className="port-forwards-head">
            <span className="port-forwards-head-title">
              <Cable size={13} />
              <span>
                {isLocal
                  ? tr("本机服务端口", "Local Service Ports")
                  : tr("SSH 端口转发", "SSH Port Forwarding")}
              </span>
              <span className="port-forwards-head-host">{host}</span>
            </span>
            <div className="port-forwards-head-actions">
              <button
                type="button"
                className="port-forwards-icon-btn"
                disabled={loading}
                onClick={() => void refresh()}
                title={
                  isLocal
                    ? tr("重新扫描本机监听端口", "Rescan local listening ports")
                    : tr("重新扫描远端监听端口", "Rescan remote listening ports")
                }
              >
                <RefreshCw size={12} className={loading ? "is-spinning" : ""} />
                {tr("扫描", "Scan")}
              </button>
              <button
                type="button"
                className="port-forwards-icon-btn port-forwards-close-btn"
                aria-label={tr("关闭端口面板", "Close ports panel")}
                onClick={() => setOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
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
                {isLocal
                  ? tr("自动开放新发现端口", "Auto-expose new ports")
                  : tr("自动转发新发现端口", "Auto-forward new ports")}
              </strong>
              <small>
                {isLocal
                  ? isRemoteView
                    ? tr(
                        "检测到本机启动 Web / TensorBoard / Jupyter 等服务时自动加入 /scope-port 代理白名单",
                        "Automatically allow newly detected local web / TensorBoard / Jupyter ports via /scope-port",
                      )
                    : tr(
                        "检测到本机启动 Web / TensorBoard / Jupyter 等服务时自动加入可访问端口列表",
                        "Automatically track newly detected local web / TensorBoard / Jupyter ports",
                      )
                  : isRemoteView
                    ? tr(
                        "检测到 Agent 启动 Web / TensorBoard / Jupyter 等服务时自动 SSH 转发并开放 /scope-port 访问",
                        "Automatically SSH-forward newly detected web / TensorBoard / Jupyter ports to /scope-port",
                      )
                    : tr(
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
                    {isLocal
                      ? tr(
                          `已开放 (${activeForwards.length})`,
                          `Active (${activeForwards.length})`,
                        )
                      : tr(
                          `已转发 (${activeForwards.length})`,
                          `Forwarded (${activeForwards.length})`,
                        )}
                  </span>
                </div>
                {activeForwards.map((item) => {
                  const busy = busyPort === item.remotePort;
                  const copied = copiedKey === `${item.remotePort}`;
                  const accessUrl = resolveOpenUrl(item.localPort);
                  const mappingLabel = isRemoteView
                    ? item.localOnly
                      ? `localhost:${item.remotePort} → /scope-port/${item.localPort}/`
                      : `:${item.remotePort} → /scope-port/${item.localPort}/`
                    : item.localOnly
                      ? `127.0.0.1:${item.localPort}`
                      : `:${item.remotePort} → 127.0.0.1:${item.localPort}`;
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
                          title={accessUrl}
                        >
                          {mappingLabel}
                        </span>
                      </div>
                      <div className="port-forwards-row-actions">
                        <a
                          href={accessUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="port-forwards-icon-btn is-primary"
                          style={{ textDecoration: "none" }}
                          title={accessUrl}
                        >
                          <ExternalLink size={11} />
                          {tr("打开", "Open")}
                        </a>
                        <button
                          type="button"
                          className="port-forwards-icon-btn"
                          title={tr("复制访问地址", "Copy access URL")}
                          onClick={async () => {
                            if (await copyUrl(accessUrl)) {
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
                          title={
                            isLocal
                              ? tr("关闭代理访问", "Revoke access")
                              : tr("停止转发", "Stop forwarding")
                          }
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
                  {isLocal
                    ? tr(
                        `本机检测到的服务端口 (${availableDiscovered.length})`,
                        `Detected local ports (${availableDiscovered.length})`,
                      )
                    : tr(
                        `远端检测到的服务端口 (${availableDiscovered.length})`,
                        `Detected remote ports (${availableDiscovered.length})`,
                      )}
                </span>
              </div>
              {availableDiscovered.length === 0 ? (
                <p className="port-forwards-empty">
                  {loading
                    ? isLocal
                      ? tr("正在扫描本机监听端口…", "Scanning local listening ports…")
                      : tr("正在扫描远端监听端口…", "Scanning remote listening ports…")
                    : isLocal
                      ? tr(
                          "当前未检测到待开放的本机服务端口，你也可以在下方直接输入端口号一键开放。",
                          "No unexposed local service ports detected; enter any local port below to expose.",
                        )
                      : tr(
                          "当前未检测到待转发的用户服务端口，你也可以在下方直接输入端口号一键转发。",
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
                          onClick={() => void openPortWithGesture(item.port, item.label)}
                        >
                          {busy ? (
                            <LoaderCircle size={11} className="is-spinning" />
                          ) : (
                            <ExternalLink size={11} />
                          )}
                          {isLocal ? tr("开放打开", "Open") : tr("转发打开", "Forward")}
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
              placeholder={
                isLocal
                  ? tr(
                      "输入端口（如 4871、8080）",
                      "Port (e.g. 4871, 8080)",
                    )
                  : tr(
                      "输入端口（如 6006、8080）",
                      "Port (e.g. 6006, 8080)",
                    )
              }
              aria-label={
                isLocal
                  ? tr("本机端口号", "Local port number")
                  : tr("远端端口号", "Remote port number")
              }
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
              {isLocal ? tr("一键开放", "Expose") : tr("一键转发", "Forward")}
            </button>
          </form>
        </div>
        </>,
        portalContainer,
      )}
    </div>
  );
}
