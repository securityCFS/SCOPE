"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Laptop,
  LogOut,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { useLocale } from "@/lib/i18n";

type TrustedDevice = {
  id: string;
  name: string;
  current: boolean;
  createdAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string | null;
  userAgent: string;
};

type GatewaySession = {
  gateway: boolean;
  authMode: "trusted-device" | "session" | null;
  currentDeviceId: string | null;
  trustedDeviceDays: number;
  devices: TrustedDevice[];
};

function isMobileUserAgent(ua: string, name: string): boolean {
  return /iPhone|iPad|Android|Mobile/i.test(`${ua} ${name}`);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "-";
  return new Date(ts).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return "-";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "-";
  return new Date(ts).toLocaleDateString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

async function fetchGatewaySession(
  signal?: AbortSignal,
): Promise<GatewaySession | null> {
  const response = await fetch("/scope-auth/session", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  const data = (await response.json()) as Partial<GatewaySession>;
  if (!data?.gateway) return null;
  return {
    gateway: true,
    authMode: data.authMode ?? null,
    currentDeviceId: data.currentDeviceId ?? null,
    trustedDeviceDays: Number(data.trustedDeviceDays) || 90,
    devices: Array.isArray(data.devices) ? data.devices : [],
  };
}

export function TrustedDevicesCard() {
  const { tr } = useLocale();
  const [session, setSession] = useState<GatewaySession | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [trustName, setTrustName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  );

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      setSession(await fetchGatewaySession());
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchGatewaySession(controller.signal)
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  if (!session) return null;

  const otherDeviceCount = session.devices.filter((d) => !d.current).length;

  async function trustCurrentDevice() {
    setBusyId("__trust__");
    setNotice(null);
    try {
      const response = await fetch("/scope-auth/devices/trust", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trustName.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setTrustName("");
      setNotice({
        kind: "success",
        text: tr(
          `已将当前设备加入受信任列表（${session?.trustedDeviceDays ?? 90} 天自动续期免密）。`,
          `This device is now trusted (${session?.trustedDeviceDays ?? 90}-day sliding cookie).`,
        ),
      });
      await loadSession();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusyId("");
    }
  }

  async function saveRename(deviceId: string) {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    setBusyId(deviceId);
    setNotice(null);
    try {
      const response = await fetch(
        `/scope-auth/devices/${encodeURIComponent(deviceId)}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setEditingId(null);
      setEditingName("");
      await loadSession();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusyId("");
    }
  }

  async function revokeDevice(device: TrustedDevice) {
    setBusyId(device.id);
    setNotice(null);
    try {
      const response = await fetch(
        `/scope-auth/devices/${encodeURIComponent(device.id)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      if (data.revokedCurrent) {
        window.location.reload();
        return;
      }
      setNotice({
        kind: "success",
        text: tr(
          `已移除受信任设备「${device.name}」，该设备下次请求需重新验证。`,
          `Revoked trusted device "${device.name}".`,
        ),
      });
      await loadSession();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusyId("");
    }
  }

  async function revokeOthers() {
    setBusyId("__others__");
    setNotice(null);
    try {
      const response = await fetch("/scope-auth/devices/revoke-others", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setNotice({
        kind: "success",
        text: tr(
          `已下线其他 ${data.removedCount ?? 0} 台设备。`,
          `Revoked ${data.removedCount ?? 0} other trusted device(s).`,
        ),
      });
      await loadSession();
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusyId("");
    }
  }

  async function logoutCurrent() {
    setBusyId("__logout__");
    try {
      await fetch("/scope-auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      window.location.reload();
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="settings-card">
      <div className="settings-card-head">
        <div>
          <h2>
            <ShieldCheck size={16} />
            {tr("受信任设备（远程访问免密）", "Trusted Devices (Remote Access)")}
          </h2>
          <p>
            {tr(
              `每台受信任设备使用独立的高熵加密凭证并持久化在主机 .scope/private-access.json（默认 ${session.trustedDeviceDays} 天且活跃自动续期），可在任意时间单台吊销，也可通过 CLI 命令 scope devices list / revoke 管理。`,
              `Each trusted device receives an independent per-device credential persisted in .scope/private-access.json (${session.trustedDeviceDays}-day sliding renewal) and can be revoked individually here or via \`scope devices\`.`,
            )}
          </p>
        </div>
        <div className="trusted-devices-head-actions">
          <span
            className={`settings-badge ${session.authMode === "trusted-device" ? "ok" : ""}`}
          >
            {session.authMode === "trusted-device"
              ? tr("当前设备已信任", "Device trusted")
              : tr("临时会话模式", "Temporary session")}
          </span>
          <button
            type="button"
            className="settings-icon-btn"
            disabled={loading}
            onClick={() => void loadSession()}
            title={tr("刷新受信任设备列表", "Refresh trusted devices")}
            aria-label={tr("刷新受信任设备列表", "Refresh trusted devices")}
          >
            <RefreshCw size={14} className={loading ? "is-spinning" : ""} />
          </button>
        </div>
      </div>

      {session.authMode !== "trusted-device" && (
        <div className="trusted-device-upgrade">
          <input
            type="text"
            maxLength={64}
            value={trustName}
            onChange={(e) => setTrustName(e.target.value)}
            placeholder={tr("可选：输入当前设备名称（例如 我的 iPhone）", "Optional device name (e.g. My iPhone)")}
          />
          <button
            type="button"
            className="center-secondary"
            disabled={busyId === "__trust__"}
            onClick={() => void trustCurrentDevice()}
          >
            <ShieldCheck size={14} />
            {busyId === "__trust__"
              ? tr("保存中…", "Trusting…")
              : tr("信任当前设备", "Trust this device")}
          </button>
        </div>
      )}

      {session.devices.length === 0 ? (
        <p className="trusted-devices-empty">
          {tr(
            "当前还没有已保存的受信任设备。点击上方按钮可将本机加入免密设备列表。",
            "No trusted devices saved yet. Trust this device above for persistent mobile login.",
          )}
        </p>
      ) : (
        <div className="trusted-devices-list">
          {session.devices.map((device) => {
            const isMobile = isMobileUserAgent(device.userAgent, device.name);
            const isEditing = editingId === device.id;
            const isBusy = busyId === device.id;
            return (
              <div
                key={device.id}
                className={`trusted-device-row${device.current ? " is-current" : ""}`}
              >
                <div className="trusted-device-main">
                  <span className="trusted-device-icon" aria-hidden="true">
                    {isMobile ? <Smartphone size={15} /> : <Laptop size={15} />}
                  </span>
                  <div className="trusted-device-copy">
                    {isEditing ? (
                      <div className="trusted-device-rename">
                        <input
                          type="text"
                          maxLength={64}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveRename(device.id);
                            if (e.key === "Escape") {
                              setEditingId(null);
                              setEditingName("");
                            }
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="settings-icon-btn"
                          disabled={isBusy || !editingName.trim()}
                          onClick={() => void saveRename(device.id)}
                          aria-label={tr("保存设备名称", "Save device name")}
                        >
                          <Check size={13} />
                        </button>
                        <button
                          type="button"
                          className="settings-icon-btn"
                          onClick={() => {
                            setEditingId(null);
                            setEditingName("");
                          }}
                          aria-label={tr("取消重命名", "Cancel rename")}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="trusted-device-title">
                        <strong>{device.name}</strong>
                        {device.current && (
                          <span className="settings-badge ok">
                            {tr("当前设备", "This device")}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="trusted-device-meta">
                      <span>
                        {tr("最近活跃：", "Last active: ")}
                        {formatDateTime(device.lastSeenAt)}
                      </span>
                      <span>
                        {tr("有效期至：", "Expires: ")}
                        {formatDateOnly(device.expiresAt)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="trusted-device-actions">
                  {!isEditing && (
                    <button
                      type="button"
                      className="settings-icon-btn"
                      disabled={isBusy}
                      onClick={() => {
                        setEditingId(device.id);
                        setEditingName(device.name);
                      }}
                      title={tr("重命名设备", "Rename device")}
                      aria-label={tr("重命名设备", "Rename device")}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="center-secondary trusted-device-revoke"
                    disabled={isBusy}
                    onClick={() => void revokeDevice(device)}
                  >
                    <Trash2 size={13} />
                    {device.current
                      ? tr("退出", "Sign out")
                      : tr("移除", "Revoke")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="trusted-devices-footer">
        {otherDeviceCount > 0 && (
          <button
            type="button"
            className="center-secondary"
            disabled={busyId === "__others__"}
            onClick={() => void revokeOthers()}
          >
            <Trash2 size={13} />
            {tr(
              `下线其他 ${otherDeviceCount} 台设备`,
              `Revoke ${otherDeviceCount} other device(s)`,
            )}
          </button>
        )}
        <button
          type="button"
          className="center-secondary"
          disabled={busyId === "__logout__"}
          onClick={() => void logoutCurrent()}
        >
          <LogOut size={13} />
          {tr("退出当前设备登录", "Sign out this device")}
        </button>
      </div>

      {notice && (
        <p className={`settings-status-banner ${notice.kind}`}>{notice.text}</p>
      )}
    </div>
  );
}
