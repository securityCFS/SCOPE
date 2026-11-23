import { LOCAL_HOST } from "@/lib/execution-host";
import type {
  Agent,
  AuthProfile,
  AuthProfilesState,
  AuthRestartJob,
  DeviceLoginJob,
  Snapshot,
} from "@/features/workspace/types";
import type { Dispatch, RefObject, SetStateAction } from "react";

export function openAccountProfiles(
  {
    selectedAgent,
    hostFilter,
    snapshot,
    accountHostRef,
    setAccountHost,
    setAccountProfiles,
    setDeviceLoginJob,
    setAuthRestartJob,
    setProfileNameDraft,
    setAccountProfilesOpen,
  }: {
    selectedAgent: Agent | null;
    hostFilter: string;
    snapshot: Snapshot;
    accountHostRef: RefObject<string>;
    setAccountHost: Dispatch<SetStateAction<string>>;
    setAccountProfiles: Dispatch<SetStateAction<AuthProfilesState | null>>;
    setDeviceLoginJob: Dispatch<SetStateAction<DeviceLoginJob | null>>;
    setAuthRestartJob: Dispatch<SetStateAction<AuthRestartJob | null>>;
    setProfileNameDraft: Dispatch<SetStateAction<string>>;
    setAccountProfilesOpen: Dispatch<SetStateAction<boolean>>;
  },
  preferredHost?: unknown,
) {
  const preferred =
    (typeof preferredHost === "string" && preferredHost) ||
    selectedAgent?.host ||
    (hostFilter !== "all" ? hostFilter : "") ||
    snapshot.hosts.find((host) => host.reachable && host.alias !== LOCAL_HOST)?.alias ||
    snapshot.hosts.find((host) => host.reachable)?.alias ||
    "";
  accountHostRef.current = preferred;
  setAccountHost(preferred);
  setAccountProfiles(null);
  setDeviceLoginJob(null);
  setAuthRestartJob(null);
  setProfileNameDraft("");
  setAccountProfilesOpen(true);
}

export async function loadAccountProfiles(
  {
    accountHost,
    accountHostRef,
    accountProfilesRequestRef,
    setAccountProfilesLoading,
    getJson,
    setAccountProfiles,
    setAuthRestartJob,
    setActionNotice,
  }: {
    accountHost: string;
    accountHostRef: RefObject<string>;
    accountProfilesRequestRef: RefObject<number>;
    setAccountProfilesLoading: Dispatch<SetStateAction<boolean>>;
    getJson: <T>(path: string) => Promise<T & { error?: string | undefined }>;
    setAccountProfiles: Dispatch<SetStateAction<AuthProfilesState | null>>;
    setAuthRestartJob: Dispatch<SetStateAction<AuthRestartJob | null>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
  },
  host = accountHost,
) {
  if (!host || host !== accountHostRef.current) return;
  const requestId = ++accountProfilesRequestRef.current;
  const isCurrentRequest = () =>
    requestId === accountProfilesRequestRef.current &&
    host === accountHostRef.current;
  setAccountProfilesLoading(true);
  try {
    const result = await getJson<AuthProfilesState>(
      `/api/auth/profiles?host=${encodeURIComponent(host)}`,
    );
    if (!isCurrentRequest()) return;
    setAccountProfiles(result);
    setAuthRestartJob(result.restartJob || null);
  } catch (error) {
    if (isCurrentRequest()) {
      setActionNotice({ kind: "error", text: (error as Error).message });
    }
  } finally {
    if (isCurrentRequest()) setAccountProfilesLoading(false);
  }
}

export async function saveCurrentAccountProfile({
  accountHost,
  profileNameDraft,
  setBusyAction,
  postJson,
  setProfileNameDraft,
  loadAccountProfiles,
  setActionNotice,
}: {
  accountHost: string;
  profileNameDraft: string;
  setBusyAction: Dispatch<SetStateAction<string>>;
  postJson: <T>(
    path: string,
    body: unknown,
  ) => Promise<T & { error?: string | undefined }>;
  setProfileNameDraft: Dispatch<SetStateAction<string>>;
  loadAccountProfiles: (host?: string) => Promise<void>;
  setActionNotice: Dispatch<
    SetStateAction<{ kind: "success" | "error"; text: string } | null>
  >;
}) {
  if (!accountHost || !profileNameDraft.trim()) return;
  setBusyAction("profile-save-current");
  try {
    await postJson("/api/auth/profiles/save", {
      host: accountHost,
      profileName: profileNameDraft.trim(),
    });
    setProfileNameDraft("");
    await loadAccountProfiles(accountHost);
    setActionNotice({
      kind: "success",
      text: `已在 ${accountHost} 远端保存当前账号 Profile；凭据未经过浏览器。`,
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function startDeviceLogin({
  accountHost,
  profileNameDraft,
  setBusyAction,
  postJson,
  setDeviceLoginJob,
  setActionNotice,
}: {
  accountHost: string;
  profileNameDraft: string;
  setBusyAction: Dispatch<SetStateAction<string>>;
  postJson: <T>(
    path: string,
    body: unknown,
  ) => Promise<T & { error?: string | undefined }>;
  setDeviceLoginJob: Dispatch<SetStateAction<DeviceLoginJob | null>>;
  setActionNotice: Dispatch<
    SetStateAction<{ kind: "success" | "error"; text: string } | null>
  >;
}) {
  if (!accountHost || !profileNameDraft.trim()) return;
  setBusyAction("profile-device-login");
  try {
    const job = await postJson<DeviceLoginJob>("/api/auth/login/start", {
      host: accountHost,
      profileName: profileNameDraft.trim(),
    });
    setDeviceLoginJob(job);
    setActionNotice({
      kind: "success",
      text: `Device auth 已在 ${accountHost} 启动，请复制一次性代码完成登录。`,
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function closeDeviceLogin({
  deviceLoginJob,
  setDeviceLoginJob,
  setBusyAction,
  postJson,
  loadAccountProfiles,
  setActionNotice,
}: {
  deviceLoginJob: DeviceLoginJob | null;
  setDeviceLoginJob: Dispatch<SetStateAction<DeviceLoginJob | null>>;
  setBusyAction: Dispatch<SetStateAction<string>>;
  postJson: <T>(
    path: string,
    body: unknown,
  ) => Promise<T & { error?: string | undefined }>;
  loadAccountProfiles: (host?: string) => Promise<void>;
  setActionNotice: Dispatch<
    SetStateAction<{ kind: "success" | "error"; text: string } | null>
  >;
}) {
  if (!deviceLoginJob) return;
  if (!["starting", "waiting"].includes(deviceLoginJob.status)) {
    setDeviceLoginJob(null);
    return;
  }
  setBusyAction("profile-device-cancel");
  try {
    await postJson("/api/auth/login/cancel", {
      jobId: deviceLoginJob.id,
    });
    setDeviceLoginJob(null);
    await loadAccountProfiles(deviceLoginJob.host);
    setActionNotice({
      kind: "success",
      text: `${deviceLoginJob.profile.name} 的 Device Auth 已取消。`,
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function deleteAuthProfile(
  {
    accountHost,
    setBusyAction,
    postJson,
    setDeviceLoginJob,
    loadAccountProfiles,
    setActionNotice,
  }: {
    accountHost: string;
    setBusyAction: Dispatch<SetStateAction<string>>;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    setDeviceLoginJob: Dispatch<SetStateAction<DeviceLoginJob | null>>;
    loadAccountProfiles: (host?: string) => Promise<void>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
  },
  profile: AuthProfile,
) {
  if (!accountHost || profile.active) return;
  if (
    !window.confirm(
      `从 SSH 主机 ${accountHost} 永久删除 Profile“${profile.name}”？只删除这套远端登录凭据，不会退出当前账号，也不会重启 Session。`,
    )
  ) {
    return;
  }
  setBusyAction(`profile-delete:${profile.slug}`);
  try {
    await postJson("/api/auth/profiles/delete", {
      host: accountHost,
      slug: profile.slug,
      confirmation: `${accountHost}:${profile.slug}`,
    });
    setDeviceLoginJob((current) =>
      current?.host === accountHost && current.profile.slug === profile.slug
        ? null
        : current,
    );
    await loadAccountProfiles(accountHost);
    setActionNotice({
      kind: "success",
      text: `${profile.name} 已从 ${accountHost} 删除；当前账号和运行中的 Session 未改变。`,
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function activateAuthProfile(
  {
    accountHost,
    setBusyAction,
    postJson,
    loadAccountProfiles,
    reloadModelsForHost,
    setActionNotice,
  }: {
    accountHost: string;
    setBusyAction: Dispatch<SetStateAction<string>>;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    loadAccountProfiles: (host?: string) => Promise<void>;
    reloadModelsForHost: (host: string) => void;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
  },
  profile: AuthProfile,
) {
  if (!accountHost || profile.active) return;
  setBusyAction(`profile-activate:${profile.slug}`);
  try {
    await postJson<{
      runningSessions: number;
      restartRequired: boolean;
    }>("/api/auth/profiles/activate", {
      host: accountHost,
      slug: profile.slug,
      name: profile.name,
      account: profile.account,
    });
    await loadAccountProfiles(accountHost);
    reloadModelsForHost(accountHost);
    setActionNotice({
      kind: "success",
      text: `${accountHost} 新 App Server 会话默认使用 ${profile.name}；现有会话及终端账号保持不变，无需重启。`,
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function restartHostSessionsForAccount({
  accountHost,
  accountProfiles,
  setBusyAction,
  postJson,
  setAuthRestartJob,
  setActionNotice,
}: {
  accountHost: string;
  accountProfiles: AuthProfilesState | null;
  setBusyAction: Dispatch<SetStateAction<string>>;
  postJson: <T>(
    path: string,
    body: unknown,
  ) => Promise<T & { error?: string | undefined }>;
  setAuthRestartJob: Dispatch<SetStateAction<AuthRestartJob | null>>;
  setActionNotice: Dispatch<
    SetStateAction<{ kind: "success" | "error"; text: string } | null>
  >;
}) {
  if (!accountHost) return;
  const count = accountProfiles?.runningSessions || 0;
  if (
    !window.confirm(
      `只重启 SSH 主机 ${accountHost} 上可安全确认的 ${count} 个 Codex Session？当前 turn 会被中断；训练/评测进程不会主动终止。`,
    )
  ) {
    return;
  }
  setBusyAction("profile-restart-host");
  try {
    const job = await postJson<AuthRestartJob>("/api/auth/restart", {
      host: accountHost,
      confirmation: accountHost,
    });
    setAuthRestartJob(job);
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
    setBusyAction("");
  }
}
