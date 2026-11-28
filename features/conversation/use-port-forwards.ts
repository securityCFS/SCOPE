"use client";
import { useCallback, useEffect, useState } from "react";
import { bridgeUrl } from "@/features/workspace/shared";
import { LOCAL_HOST } from "@/lib/execution-host";

export type DiscoveredRemotePort = {
  port: number;
  bind: string;
  pid: number | null;
  procName: string;
  label: string;
  cmdline: string;
  cwd: string;
  inProject: boolean;
};

export type PublicPortShare = {
  token: string;
  createdAt: string | null;
  expiresAt: string | null;
  mode: string;
};

export type ActivePortForward = {
  host: string;
  remotePort: number;
  localPort: number;
  localHost?: string;
  localOnly?: boolean;
  localUrl: string;
  status: "connecting" | "connected" | "reconnecting" | "stopped" | "error";
  label: string;
  auto: boolean;
  connectedAt: string | null;
  lastError: string | null;
  publicShare?: PublicPortShare | null;
};

export type HostPortForwardsState = {
  host: string;
  autoForward: boolean;
  discovered: DiscoveredRemotePort[];
  forwards: ActivePortForward[];
  scannedAt: string | null;
  error: string | null;
};

const PORT_FORWARDS_EVENT = "scope:port-forwards-changed";

export function notifyPortForwardsChanged(host: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(PORT_FORWARDS_EVENT, { detail: { host } }),
    );
  }
}

export async function requestPortForward(
  host: string,
  remotePort: number,
  options: { localPort?: number | null; label?: string } = {},
): Promise<{
  alreadyActive: boolean;
  forward: ActivePortForward;
  state: HostPortForwardsState;
}> {
  const response = await fetch(bridgeUrl("/api/port-forwards/forward"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      host,
      remotePort,
      localPort: options.localPort ?? null,
      label: options.label || "",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "端口转发启动失败");
  }
  notifyPortForwardsChanged(host);
  return data;
}

export function usePortForwards(
  host: string | undefined,
  cwd: string | undefined,
  { open = false, allowLocal = false }: { open?: boolean; allowLocal?: boolean } = {},
) {
  const isLocal = host === LOCAL_HOST;
  const isRemote = Boolean(host && !isLocal);
  const enabled = Boolean(host && (isRemote || (isLocal && allowLocal)));
  const [state, setState] = useState<HostPortForwardsState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyPort, setBusyPort] = useState<number | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const fetchState = useCallback(
    async ({ scan = true, force = false }: { scan?: boolean; force?: boolean } = {}) => {
      if (!enabled || !host) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({ host });
        if (cwd) params.set("cwd", cwd);
        if (scan) params.set("scan", "1");
        if (force) params.set("force", "1");
        const response = await fetch(
          bridgeUrl(`/api/port-forwards?${params.toString()}`),
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "无法读取监听端口状态");
        }
        setState(data);
        setActionError("");
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [host, cwd, enabled],
  );

  useEffect(() => {
    if (!enabled || !host) return;
    let cancelled = false;
    const params = new URLSearchParams({ host, scan: "1" });
    if (cwd) params.set("cwd", cwd);
    fetch(bridgeUrl(`/api/port-forwards?${params.toString()}`), {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "无法读取监听端口状态");
        }
        if (!cancelled) {
          setState(data);
          setActionError("");
        }
      })
      .catch((error) => {
        if (!cancelled) setActionError((error as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [host, cwd, enabled]);

  useEffect(() => {
    if (!enabled || !host) return;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ host?: string }>).detail;
      if (!detail?.host || detail.host === host) {
        void fetchState({ scan: false, force: false });
      }
    };
    window.addEventListener(PORT_FORWARDS_EVENT, onChanged);
    return () => window.removeEventListener(PORT_FORWARDS_EVENT, onChanged);
  }, [host, enabled, fetchState]);

  const shouldPoll = Boolean(open || state?.autoForward || (state?.forwards?.length ?? 0) > 0);
  useEffect(() => {
    if (!enabled || !host || !shouldPoll) return;
    const intervalMs = open ? 8_000 : 18_000;
    const timer = setInterval(() => {
      if (!document.hidden) void fetchState({ scan: true, force: false });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, host, shouldPoll, open, fetchState]);

  const forwardPort = useCallback(
    async (remotePort: number, label?: string, localPort?: number | null) => {
      if (!host) return null;
      setBusyPort(remotePort);
      setActionError("");
      try {
        const result = await requestPortForward(host, remotePort, {
          localPort,
          label,
        });
        if (result.state) setState(result.state);
        return result.forward;
      } catch (error) {
        setActionError((error as Error).message);
        return null;
      } finally {
        setBusyPort(null);
      }
    },
    [host],
  );

  const stopPort = useCallback(
    async (remotePort: number) => {
      if (!host) return;
      setBusyPort(remotePort);
      setActionError("");
      try {
        const response = await fetch(bridgeUrl("/api/port-forwards/stop"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host, remotePort }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "停止端口转发失败");
        if (data.state) setState(data.state);
        notifyPortForwardsChanged(host);
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setBusyPort(null);
      }
    },
    [host],
  );

  const setAutoForward = useCallback(
    async (enabled: boolean) => {
      if (!host) return;
      setAutoBusy(true);
      setActionError("");
      try {
        const response = await fetch(bridgeUrl("/api/port-forwards/auto"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host, enabled, cwd: cwd || "" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "切换自动转发失败");
        if (data.state) setState(data.state);
        notifyPortForwardsChanged(host);
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setAutoBusy(false);
      }
    },
    [host, cwd],
  );

  const sharePort = useCallback(
    async (
      remotePort: number,
      ttlHours: number | null = 168,
      rotate = false,
    ): Promise<PublicPortShare | null> => {
      if (!host) return null;
      setBusyPort(remotePort);
      setActionError("");
      try {
        const response = await fetch(bridgeUrl("/api/port-forwards/share"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host, remotePort, ttlHours, rotate }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "生成公网分享链接失败");
        if (data.state) setState(data.state);
        notifyPortForwardsChanged(host);
        return data.share || null;
      } catch (error) {
        setActionError((error as Error).message);
        return null;
      } finally {
        setBusyPort(null);
      }
    },
    [host],
  );

  const unsharePort = useCallback(
    async (remotePort: number) => {
      if (!host) return;
      setBusyPort(remotePort);
      setActionError("");
      try {
        const response = await fetch(bridgeUrl("/api/port-forwards/unshare"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host, remotePort }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "撤销公网分享失败");
        if (data.state) setState(data.state);
        notifyPortForwardsChanged(host);
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setBusyPort(null);
      }
    },
    [host],
  );

  const activeState = enabled && host && state?.host === host ? state : null;

  return {
    isRemote,
    isLocal,
    enabled,
    state: activeState,
    loading,
    busyPort,
    autoBusy,
    actionError,
    refresh: () => fetchState({ scan: true, force: true }),
    forwardPort,
    stopPort,
    setAutoForward,
    sharePort,
    unsharePort,
  };
}
