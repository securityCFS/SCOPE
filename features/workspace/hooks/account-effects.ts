"use client";
import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import type { Agent, AuthRestartJob, DeviceLoginJob } from "../types";

import { managementKey } from "@/features/workspace/shared";

export function useAccountSelection({
  selectedAgent,
  setModelDrafts,
  setEffortDrafts,
}: {
  selectedAgent: Agent | null;
  setModelDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setEffortDrafts: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  useEffect(() => {
    if (!selectedAgent?.rollout) return;
    const key = managementKey(selectedAgent);
    setModelDrafts((current) =>
      current[key]
        ? current
        : { ...current, [key]: selectedAgent.rollout?.model || "" },
    );
    setEffortDrafts((current) =>
      current[key]
        ? current
        : {
            ...current,
            [key]: selectedAgent.rollout?.reasoningEffort || "",
          },
    );
  }, [selectedAgent, setEffortDrafts, setModelDrafts]);
}

export function useLoginPolling({
  accountProfilesOpen,
  accountHost,
  setDeviceLoginJob,
  setAuthRestartJob,
  loadAccountProfiles,
}: {
  accountProfilesOpen: boolean;
  accountHost: string;
  setDeviceLoginJob: Dispatch<SetStateAction<DeviceLoginJob | null>>;
  setAuthRestartJob: Dispatch<SetStateAction<AuthRestartJob | null>>;
  loadAccountProfiles: (host?: string) => Promise<void>;
}) {
  useEffect(() => {
    if (!accountProfilesOpen || !accountHost) return;
    setDeviceLoginJob((current) =>
      current?.host === accountHost ? current : null,
    );
    setAuthRestartJob(null);
    loadAccountProfiles(accountHost);
    // loadAccountProfiles is a local action; host/open are the intended triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountHost, accountProfilesOpen]);
}

export function useAccountRestartPolling({
  deviceLoginJob,
  getJson,
  setDeviceLoginJob,
  setProfileNameDraft,
  loadAccountProfiles,
  setActionNotice,
}: {
  deviceLoginJob: DeviceLoginJob | null;
  getJson: <T>(path: string) => Promise<T & { error?: string | undefined }>;
  setDeviceLoginJob: Dispatch<SetStateAction<DeviceLoginJob | null>>;
  setProfileNameDraft: Dispatch<SetStateAction<string>>;
  loadAccountProfiles: (host?: string) => Promise<void>;
  setActionNotice: Dispatch<
    SetStateAction<{ kind: "error" | "success"; text: string } | null>
  >;
}) {
  useEffect(() => {
    if (
      !deviceLoginJob ||
      !["starting", "waiting"].includes(deviceLoginJob.status)
    ) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const next = await getJson<DeviceLoginJob>(
          `/api/auth/login/status?jobId=${encodeURIComponent(deviceLoginJob.id)}`,
        );
        setDeviceLoginJob(next);
        if (next.status === "completed") {
          window.clearInterval(timer);
          setProfileNameDraft("");
          await loadAccountProfiles(next.host);
          setActionNotice({
            kind: "success",
            text: `${next.profile.name} 已登录并保存到 ${next.host}；尚未切换正在运行的 Session。`,
          });
        }
        if (["failed", "cancelled"].includes(next.status)) {
          window.clearInterval(timer);
        }
      } catch {
        // Keep the visible code; a transient bridge poll must not discard it.
      }
    }, 1_500);
    return () => window.clearInterval(timer);
    // Poll identity/status only; including the full job would reset the timer every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceLoginJob?.id, deviceLoginJob?.status]);
}
