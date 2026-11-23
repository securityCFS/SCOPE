import { type ProjectEntry } from "@/components/project-sidebar";
import {
  MAX_INSTRUCTION_ATTACHMENTS,
  MAX_INSTRUCTION_ATTACHMENTS_TOTAL_BYTES,
  MAX_INSTRUCTION_ATTACHMENT_BYTES,
  bridgeUrl,
  hostRuntimeConfig,
  managementKey,
} from "@/features/workspace/shared";
import type {
  Agent,
  InstructionAttachment,
  DialogueSnapshot,
  RemoteDirectoryListing,
  Snapshot,
} from "@/features/workspace/types";
import type { Dispatch, RefObject, SetStateAction } from "react";

export function openNewTask(
  {
    snapshot,
    hostFilter,
    setNewTaskDraft,
    setNewTaskDirectoryBrowser,
    setNewTaskOpen,
  }: {
    snapshot: Snapshot;
    hostFilter: string;
    setNewTaskDraft: Dispatch<
      SetStateAction<{
        host: string;
        cwd: string;
        prompt: string;
        model: string;
        effort: string;
        preLaunchCommand: string;
        yolo: boolean;
        transport: "app-server" | "tmux";
      }>
    >;
    setNewTaskDirectoryBrowser: Dispatch<
      SetStateAction<{
        open: boolean;
        loading: boolean;
        error: string;
        listing: RemoteDirectoryListing | null;
      }>
    >;
    setNewTaskOpen: Dispatch<SetStateAction<boolean>>;
  },
  project?: ProjectEntry,
) {
  const preferredHost =
    snapshot.hosts.find(
      (host) => host.alias === (project?.host || hostFilter) && host.reachable,
    ) || (!project ? snapshot.hosts.find((host) => host.reachable) : undefined);
  const preferredCwd =
    project?.cwd ||
    (preferredHost &&
      (preferredHost.defaultCwd || preferredHost.agents.find((agent) => agent.cwd)?.cwd ||
        preferredHost.sessions.find((session) => session.cwd)?.cwd)) ||
    "";
  const runtime = hostRuntimeConfig(
    snapshot.management,
    project?.host || preferredHost?.alias || "",
  );
  setNewTaskDraft({
    host: project?.host || preferredHost?.alias || "",
    cwd: preferredCwd,
    prompt: "",
    model: "",
    effort: "",
    preLaunchCommand: runtime.preLaunchCommand,
    yolo: runtime.yolo,
    transport: "app-server",
  });
  setNewTaskDirectoryBrowser({
    open: false,
    loading: false,
    error: "",
    listing: null,
  });
  setNewTaskOpen(true);
}

export async function browseNewTaskDirectory(
  {
    newTaskDraft,
    setNewTaskDirectoryBrowser,
  }: {
    newTaskDraft: {
      host: string;
      cwd: string;
      prompt: string;
      model: string;
      effort: string;
      preLaunchCommand: string;
      yolo: boolean;
      transport: "app-server" | "tmux";
    };
    setNewTaskDirectoryBrowser: Dispatch<
      SetStateAction<{
        open: boolean;
        loading: boolean;
        error: string;
        listing: RemoteDirectoryListing | null;
      }>
    >;
  },
  pathOverride?: string,
) {
  const requestedPath = pathOverride || newTaskDraft.cwd.trim() || "";
  if (!newTaskDraft.host) {
    setNewTaskDirectoryBrowser({
      open: true,
      loading: false,
      error: "请先选择 SSH 主机。",
      listing: null,
    });
    return;
  }
  setNewTaskDirectoryBrowser((current) => ({
    ...current,
    open: true,
    loading: true,
    error: "",
  }));
  try {
    const response = await fetch(
      bridgeUrl(`/api/remote/directories?host=${encodeURIComponent(
        newTaskDraft.host,
      )}&path=${encodeURIComponent(requestedPath)}`),
      { cache: "no-store" },
    );
    const listing = (await response.json()) as RemoteDirectoryListing & {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(listing.error || `HTTP ${response.status}`);
    }
    setNewTaskDirectoryBrowser({
      open: true,
      loading: false,
      error: "",
      listing,
    });
  } catch (error) {
    setNewTaskDirectoryBrowser((current) => ({
      ...current,
      open: true,
      loading: false,
      error: (error as Error).message,
    }));
  }
}

export function chooseNewTaskDirectory(
  {
    setNewTaskDraft,
    setNewTaskDirectoryBrowser,
  }: {
    setNewTaskDraft: Dispatch<
      SetStateAction<{
        host: string;
        cwd: string;
        prompt: string;
        model: string;
        effort: string;
        preLaunchCommand: string;
        yolo: boolean;
        transport: "app-server" | "tmux";
      }>
    >;
    setNewTaskDirectoryBrowser: Dispatch<
      SetStateAction<{
        open: boolean;
        loading: boolean;
        error: string;
        listing: RemoteDirectoryListing | null;
      }>
    >;
  },
  cwd: string,
) {
  setNewTaskDraft((current) => ({ ...current, cwd }));
  setNewTaskDirectoryBrowser((current) => ({
    ...current,
    open: false,
    error: "",
  }));
}

export async function createTask(
  {
    setBusyAction,
    setActionNotice,
    postJson,
    newTaskDraft,
    setNewTaskOpen,
    setViewMode,
    setHostFilter,
    setCwdFilter,
    setSelectedAgentId,
    refresh,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    newTaskDraft: {
      host: string;
      cwd: string;
      prompt: string;
      model: string;
      effort: string;
      preLaunchCommand: string;
      yolo: boolean;
      transport: "app-server" | "tmux";
    };
    setNewTaskOpen: Dispatch<SetStateAction<boolean>>;
    setViewMode: Dispatch<SetStateAction<"agents" | "history" | "experiments">>;
    setHostFilter: Dispatch<SetStateAction<string>>;
    setCwdFilter: Dispatch<SetStateAction<string>>;
    setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
    refresh: () => Promise<void>;
  },
  attachments: Array<{ token: string }> = [],
): Promise<boolean> {
  const action = "create-task";
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{
      transport: "app-server" | "tmux";
      session: { sessionId: string; cwd: string };
      tmux?: { target: string };
    }>("/api/session/create", {
      ...newTaskDraft,
      ...(attachments.length ? { attachments } : {}),
    });
    setNewTaskOpen(false);
    setViewMode("agents");
    setHostFilter(newTaskDraft.host);
    setCwdFilter(result.session.cwd);
    if (result.transport === "app-server")
      setSelectedAgentId(
        `app-server:${newTaskDraft.host}:${result.session.sessionId}`,
      );
    setActionNotice({ kind: "success", text: "会话已创建。" });
    window.setTimeout(() => refresh(), 900);
    return true;
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
    return false;
  } finally {
    setBusyAction("");
  }
}

export async function saveNewTaskRuntimeConfig({
  newTaskDraft,
  setBusyAction,
  setActionNotice,
  postJson,
  refresh,
}: {
  newTaskDraft: {
    host: string;
    cwd: string;
    prompt: string;
    model: string;
    effort: string;
    preLaunchCommand: string;
    yolo: boolean;
    transport: "app-server" | "tmux";
  };
  setBusyAction: Dispatch<SetStateAction<string>>;
  setActionNotice: Dispatch<
    SetStateAction<{ kind: "success" | "error"; text: string } | null>
  >;
  postJson: <T>(
    path: string,
    body: unknown,
  ) => Promise<T & { error?: string | undefined }>;
  refresh: () => Promise<void>;
}) {
  if (!newTaskDraft.host) return;
  const action = `runtime-config:${newTaskDraft.host}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    await postJson("/api/runtime/config", {
      host: newTaskDraft.host,
      preLaunchCommand: newTaskDraft.preLaunchCommand,
      yolo: newTaskDraft.yolo,
    });
    setActionNotice({
      kind: "success",
      text: `已保存 ${newTaskDraft.host} 的启动配置；没有重启或终止任何现有进程。`,
    });
    window.setTimeout(() => refresh(), 500);
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export function removeInstructionAttachment(
  {
    setInstructionAttachments,
  }: {
    setInstructionAttachments: Dispatch<
      SetStateAction<InstructionAttachment[]>
    >;
  },
  localId: string,
) {
  setInstructionAttachments((current) => {
    const removed = current.find(
      (attachment) => attachment.localId === localId,
    );
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    return current.filter((attachment) => attachment.localId !== localId);
  });
}

export function clearInstructionAttachments({
  setInstructionAttachments,
  instructionFileInputRef,
}: {
  setInstructionAttachments: Dispatch<SetStateAction<InstructionAttachment[]>>;
  instructionFileInputRef: RefObject<HTMLInputElement | null>;
}) {
  setInstructionAttachments((current) => {
    for (const attachment of current) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
    return [];
  });
  if (instructionFileInputRef.current) {
    instructionFileInputRef.current.value = "";
  }
}

export async function uploadInstructionFiles(
  {
    instructionAttachments,
    setActionNotice,
    instructionAttachmentOwnerRef,
    setInstructionAttachments,
    instructionFileInputRef,
  }: {
    instructionAttachments: InstructionAttachment[];
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    instructionAttachmentOwnerRef: RefObject<string>;
    setInstructionAttachments: Dispatch<
      SetStateAction<InstructionAttachment[]>
    >;
    instructionFileInputRef: RefObject<HTMLInputElement | null>;
  },
  agent: Agent,
  selectedFiles: File[],
) {
  if (!agent.rollout || !selectedFiles.length) return;
  if (
    instructionAttachments.some(
      (attachment) => attachment.status === "uploading",
    )
  ) {
    setActionNotice({ kind: "error", text: "上一批附件仍在上传，请稍候。" });
    return;
  }
  const ownerKey = managementKey(agent);
  instructionAttachmentOwnerRef.current = ownerKey;
  let totalBytes = instructionAttachments.reduce(
    (sum, attachment) => sum + attachment.size,
    0,
  );
  let remainingSlots = Math.max(
    0,
    MAX_INSTRUCTION_ATTACHMENTS - instructionAttachments.length,
  );
  const accepted: Array<{ file: File; attachment: InstructionAttachment }> = [];
  const rejected: string[] = [];
  for (const file of selectedFiles) {
    if (!remainingSlots) {
      rejected.push(
        `${file.name}：每条消息最多 ${MAX_INSTRUCTION_ATTACHMENTS} 个附件`,
      );
      continue;
    }
    if (file.size > MAX_INSTRUCTION_ATTACHMENT_BYTES) {
      rejected.push(`${file.name}：单个文件不能超过 50 MiB`);
      continue;
    }
    if (totalBytes + file.size > MAX_INSTRUCTION_ATTACHMENTS_TOTAL_BYTES) {
      rejected.push(`${file.name}：附件总大小不能超过 100 MiB`);
      continue;
    }
    const localId =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const previewUrl = file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : "";
    const attachment: InstructionAttachment = {
      localId,
      name: file.name || "attachment",
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      kind: file.type.startsWith("image/") ? "image" : "file",
      status: "uploading",
      token: "",
      remotePath: "",
      previewUrl,
      error: "",
    };
    accepted.push({ file, attachment });
    totalBytes += file.size;
    remainingSlots -= 1;
  }
  if (accepted.length) {
    setInstructionAttachments((current) => [
      ...current,
      ...accepted.map(({ attachment }) => attachment),
    ]);
  }
  if (rejected.length) {
    setActionNotice({ kind: "error", text: rejected.join("；") });
  } else {
    setActionNotice(null);
  }

  for (const { file, attachment } of accepted) {
    try {
      const parameters = new URLSearchParams({
        host: agent.host,
        sessionId: agent.rollout.id,
        name: file.name || "attachment",
        mimeType: file.type || "application/octet-stream",
      });
      const response = await fetch(
        bridgeUrl(`/api/session/attachment?${parameters.toString()}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        },
      );
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        attachment?: {
          token: string;
          name: string;
          mimeType: string;
          kind: "image" | "file";
          size: number;
          remotePath: string;
        };
      };
      if (!response.ok || !result.attachment) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      if (instructionAttachmentOwnerRef.current !== ownerKey) continue;
      setInstructionAttachments((current) =>
        current.map((item) =>
          item.localId === attachment.localId
            ? {
                ...item,
                ...result.attachment!,
                status: "ready",
                error: "",
              }
            : item,
        ),
      );
    } catch (error) {
      if (instructionAttachmentOwnerRef.current !== ownerKey) continue;
      setInstructionAttachments((current) =>
        current.map((item) =>
          item.localId === attachment.localId
            ? { ...item, status: "error", error: (error as Error).message }
            : item,
        ),
      );
    }
  }
  if (instructionFileInputRef.current) {
    instructionFileInputRef.current.value = "";
  }
}

export async function sendInstruction(
  {
    instructionDraft,
    selectedDialogue,
    instructionAttachments,
    setActionNotice,
    instructionAttemptRef,
    setBusyAction,
    postJson,
    setInstructionDraft,
    clearInstructionAttachments,
    setPendingInstruction,
  }: {
    instructionDraft: string;
    selectedDialogue: DialogueSnapshot | null;
    instructionAttachments: InstructionAttachment[];
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    instructionAttemptRef: RefObject<{
      key: string;
      signature: string;
      deliveryId: string;
    } | null>;
    setBusyAction: Dispatch<SetStateAction<string>>;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    setInstructionDraft: Dispatch<SetStateAction<string>>;
    clearInstructionAttachments: () => void;
    setPendingInstruction: Dispatch<
      SetStateAction<{
        key: string;
        sentAt: number;
        baselineAssistant: string;
        baselineAssistantId?: string;
        transport: "app-server" | "tmux";
        target: string;
      } | null>
    >;
  },
  agent: Agent,
) {
  if (!agent.rollout) return;
  const key = managementKey(agent);
  const text = instructionDraft.trim();
  if (!agent.pane && /^\/[\w:-]+(?:\s|$)/.test(text)) {
    setActionNotice({kind:"error",text:"请从 / 菜单选择网页命令；项目技能使用 $技能名，终端专用命令请在原终端执行。"});
    return;
  }
  const blockedAttachment = instructionAttachments.find(
    (attachment) => attachment.status !== "ready",
  );
  if (blockedAttachment) {
    setActionNotice({
      kind: "error",
      text:
        blockedAttachment.status === "uploading"
          ? `附件 ${blockedAttachment.name} 仍在上传。`
          : `附件 ${blockedAttachment.name} 上传失败，请移除后重试。`,
    });
    return;
  }
  if (!text && !instructionAttachments.length) return;
  const action = `instruct:${key}`;
  const signature = JSON.stringify({
    text,
    attachments: instructionAttachments.map((attachment) => attachment.token),
  });
  const previousAttempt = instructionAttemptRef.current;
  const deliveryId =
    previousAttempt?.key === key && previousAttempt.signature === signature
      ? previousAttempt.deliveryId
      : globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  instructionAttemptRef.current = { key, signature, deliveryId };
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{
      transport: "app-server" | "tmux";
      target?: string;
      acknowledged?: boolean;
      deduplicated?: boolean;
      deliveryId?: string;
      paneCommand?: string;
      panePid?: number;
    }>("/api/session/instruct", {
      host: agent.host,
      sessionId: agent.rollout.id,
      prompt: text,
      attachments: instructionAttachments.map((attachment) => ({
        token: attachment.token,
      })),
      deliveryId,
    });
    instructionAttemptRef.current = null;
    setInstructionDraft((current) => (current.trim() === text ? "" : current));
    clearInstructionAttachments();
    setPendingInstruction({
      key: managementKey(agent),
      sentAt: Date.now(),
      baselineAssistant: agent.rollout.lastAssistant || "",
      baselineAssistantId:
        selectedDialogue?.events.findLast((event) => event.kind === "assistant")
          ?.id || "",
      transport: result.transport,
      target: result.target || result.transport,
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}
