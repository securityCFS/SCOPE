"use client";
import {
  loadBrowserSnapshotCache,
  saveBrowserSnapshotCache,
} from "@/lib/browser-snapshot-cache";
import { applySnapshotSync } from "@/lib/incremental-snapshot";
import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import type {
  CachedSnapshotSync,
  Snapshot,
  SnapshotSyncPayload,
} from "../types";

import { bridgeUrl } from "@/features/workspace/shared";

export function useSnapshotConnection({
  setSnapshot,
  setBridgeState,
}: {
  setSnapshot: Dispatch<SetStateAction<Snapshot>>;
  setBridgeState: Dispatch<
    SetStateAction<"connecting" | "connected" | "offline">
  >;
}) {
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let disposed = false;
    let refreshInFlight = false;
    let refreshPending = false;
    let syncEpoch = "";
    let syncRevision = 0;
    let currentSnapshot: Snapshot | null = null;
    let pendingCache: CachedSnapshotSync | null = null;
    let cacheTimer: number | null = null;

    function flushSnapshotCache() {
      if (cacheTimer !== null) {
        window.clearTimeout(cacheTimer);
        cacheTimer = null;
      }
      const record = pendingCache;
      pendingCache = null;
      if (record) void saveBrowserSnapshotCache(record).catch(() => {});
    }

    function scheduleSnapshotCache(snapshotValue: Snapshot) {
      if (!syncEpoch || syncRevision <= 0) return;
      pendingCache = {
        protocol: 1,
        epoch: syncEpoch,
        revision: syncRevision,
        savedAt: Date.now(),
        snapshot: snapshotValue,
      };
      if (cacheTimer !== null) return;
      cacheTimer = window.setTimeout(flushSnapshotCache, 30_000);
    }

    async function refreshSnapshot() {
      if (refreshInFlight) {
        refreshPending = true;
        return;
      }
      refreshInFlight = true;
      try {
        do {
          refreshPending = false;
          const parameters = new URLSearchParams();
          parameters.set("fields", "1");
          if (syncEpoch) parameters.set("epoch", syncEpoch);
          if (syncRevision > 0) parameters.set("since", String(syncRevision));
          const response = await fetch(bridgeUrl(`/api/sync?${parameters}`), {
            cache: "no-store",
          });
          if (!response.ok) throw new Error("bridge unavailable");
          const payload = (await response.json()) as SnapshotSyncPayload;
          if (disposed) return;
          let latest: Snapshot;
          try {
            latest = applySnapshotSync(currentSnapshot, payload) as Snapshot;
          } catch (error) {
            if (syncEpoch || syncRevision) {
              syncEpoch = "";
              syncRevision = 0;
              currentSnapshot = null;
              refreshPending = true;
              continue;
            }
            throw error;
          }
          currentSnapshot = latest;
          syncEpoch = payload.epoch;
          syncRevision = payload.revision;
          setSnapshot(latest);
          setBridgeState("connected");
          scheduleSnapshotCache(latest);
        } while (refreshPending && !disposed);
      } catch {
        if (!disposed) setBridgeState("offline");
      } finally {
        refreshInFlight = false;
      }
    }

    async function connect() {
      try {
        const cached = (await loadBrowserSnapshotCache().catch(
          () => null,
        )) as CachedSnapshotSync | null;
        if (
          cached?.protocol === 1 &&
          cached.epoch &&
          cached.revision > 0 &&
          // Old conversation content is recovery data, not an expiring lease.
          Array.isArray(cached.snapshot?.hosts)
        ) {
          currentSnapshot = cached.snapshot;
          syncEpoch = cached.epoch;
          syncRevision = cached.revision;
          if (!disposed) {
            // Render cached cards immediately, but never expose a stale
            // approval/question as actionable before the live delta arrives.
            setSnapshot({
              ...cached.snapshot,
              scanning: true,
              appServer: {
                ...cached.snapshot.appServer,
                pendingRequests: [],
                pendingInputs: [],
              },
            });
          }
        }

        eventSource = new EventSource(bridgeUrl("/api/events"));
        eventSource.onopen = () => { if (!disposed) void refreshSnapshot(); };
        eventSource.onmessage = (event) => {
          try {
            const notice = JSON.parse(event.data) as {
              type?: string;
              scanning?: boolean;
              epoch?: string;
              revision?: number;
            };
            if (notice.type !== "snapshot-invalidated") return;
            setBridgeState("connected");
            if (notice.scanning) {
              setSnapshot((current) => ({ ...current, scanning: true }));
              return;
            }
            if (
              notice.epoch === syncEpoch &&
              Number(notice.revision || 0) <= syncRevision
            ) {
              return;
            }
            void refreshSnapshot();
          } catch {
            // Ignore one malformed event and keep the last valid snapshot.
          }
        };
        eventSource.onerror = () => {
          if (!disposed) setBridgeState("offline");
        };
        await refreshSnapshot();
      } catch {
        if (!disposed) setBridgeState("offline");
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushSnapshotCache();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const reconnect = () => { void refreshSnapshot(); };
    window.addEventListener("scope:reconnect", reconnect);
    connect();
    return () => {
      disposed = true;
      eventSource?.close();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("scope:reconnect", reconnect);
      flushSnapshotCache();
    };
  }, [setBridgeState, setSnapshot]);
}
