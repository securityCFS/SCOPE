"use client";
import {
  beginDialogueRefresh,
  failDialogueRefresh,
} from "@/lib/dialogue-refresh.js";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import {
  hasConversationReply,
  mergeConversationPage,
} from "@/lib/conversation";
import type {
  Agent,
  AuthRestartJob,
  DialogueSnapshot,
  InstructionAttachment,
} from "../types";

import {
  DIALOGUE_RENDER_BATCH,
  bridgeUrl,
  managementKey,
} from "@/features/workspace/shared";

export function useAttachmentReferences({
  instructionAttachmentsRef,
  instructionAttachments,
}: {
  instructionAttachmentsRef: RefObject<InstructionAttachment[]>;
  instructionAttachments: InstructionAttachment[];
}) {
  useEffect(() => {
    instructionAttachmentsRef.current = instructionAttachments;
  }, [instructionAttachments, instructionAttachmentsRef]);
}

export function useAttachmentCleanup({
  instructionAttachmentsRef,
}: {
  instructionAttachmentsRef: RefObject<InstructionAttachment[]>;
}) {
  useEffect(() => {
    return () => {
      // This ref stores the latest attachments, not a mounted DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const attachment of instructionAttachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, [instructionAttachmentsRef]);
}

export function useAttachmentOwnership({
  instructionAttachmentOwnerRef,
  setInstructionAttachments,
  instructionFileInputRef,
  selectedAgentId,
}: {
  instructionAttachmentOwnerRef: RefObject<string>;
  setInstructionAttachments: Dispatch<SetStateAction<InstructionAttachment[]>>;
  instructionFileInputRef: RefObject<HTMLInputElement | null>;
  selectedAgentId: string | null;
}) {
  useEffect(() => {
    instructionAttachmentOwnerRef.current = "";
    setInstructionAttachments((current) => {
      for (const attachment of current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
      return [];
    });
    if (instructionFileInputRef.current) {
      instructionFileInputRef.current.value = "";
    }
  }, [
    instructionAttachmentOwnerRef,
    instructionFileInputRef,
    selectedAgentId,
    setInstructionAttachments,
  ]);
}

export function useInstructionReceipt({
  authRestartJob,
  getJson,
  setAuthRestartJob,
  setBusyAction,
  reloadModelsForHost,
  setActionNotice,
  refresh,
}: {
  authRestartJob: AuthRestartJob | null;
  getJson: <T>(path: string) => Promise<T & { error?: string | undefined }>;
  setAuthRestartJob: Dispatch<SetStateAction<AuthRestartJob | null>>;
  setBusyAction: Dispatch<SetStateAction<string>>;
  reloadModelsForHost: (host: string) => void;
  setActionNotice: Dispatch<
    SetStateAction<{ kind: "error" | "success"; text: string } | null>
  >;
  refresh: () => Promise<void>;
}) {
  useEffect(() => {
    if (
      !authRestartJob ||
      !["queued", "running"].includes(authRestartJob.status)
    ) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const next = await getJson<AuthRestartJob>(
          `/api/auth/restart/status?jobId=${encodeURIComponent(authRestartJob.id)}`,
        );
        setAuthRestartJob(next);
        if (["completed", "failed"].includes(next.status)) {
          window.clearInterval(timer);
          setBusyAction("");
          reloadModelsForHost(next.host);
          const failed = next.results.filter((result) => !result.ok).length;
          setActionNotice({
            kind: failed || next.status === "failed" ? "error" : "success",
            text: `主机 ${next.host} 的账号重启任务完成：${
              next.results.length - failed
            } 成功，${failed} 跳过或失败。`,
          });
          window.setTimeout(() => refresh(), 800);
        }
      } catch {
        // Keep polling; each remote Session is restarted serially by design.
      }
    }, 1_500);
    return () => window.clearInterval(timer);
    // Poll identity/status only; including the result array would reset the timer every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRestartJob?.id, authRestartJob?.status]);
}

export function useDialogueBatchReset({
  setDialogueRenderLimit,
  dialogueFilters,
  dialogueOrder,
  selectedDialogueKey,
}: {
  setDialogueRenderLimit: Dispatch<SetStateAction<number>>;
  dialogueFilters: Record<
    "dialogue" | "operations" | "reasoning" | "subagent",
    boolean
  >;
  dialogueOrder: "asc" | "desc";
  selectedDialogueKey: string;
}) {
  useEffect(() => {
    setDialogueRenderLimit(DIALOGUE_RENDER_BATCH);
  }, [
    dialogueFilters,
    dialogueOrder,
    selectedDialogueKey,
    setDialogueRenderLimit,
  ]);
}

export function useDialogueBatchProgress({
  pendingInstruction,
  selectedAgent,
  canonicalDialogueMessages,
  setPendingInstruction,
}: {
  pendingInstruction: {
    key: string;
    sentAt: number;
    baselineAssistant: string;
    baselineAssistantId?: string;
    transport: "app-server" | "tmux";
    target: string;
  } | null;
  selectedAgent: Agent | null;
  canonicalDialogueMessages: {
    latestUser: string;
    latestAssistant: string;
    latestAssistantId: string;
  };
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
  setActionNotice: Dispatch<
    SetStateAction<{ kind: "error" | "success"; text: string } | null>
  >;
}) {
  useEffect(() => {
    if (!pendingInstruction || !selectedAgent) return;
    if (pendingInstruction.key !== managementKey(selectedAgent)) return;
    const latestAssistant =
      canonicalDialogueMessages.latestAssistant ||
      selectedAgent.rollout?.lastAssistant ||
      "";
    if (
      hasConversationReply(pendingInstruction, {
        latestAssistant,
        latestAssistantId: canonicalDialogueMessages.latestAssistantId,
      })
    ) {
      setPendingInstruction(null);
    }
  }, [
    canonicalDialogueMessages.latestAssistant,
    canonicalDialogueMessages.latestAssistantId,
    pendingInstruction,
    selectedAgent,
    setPendingInstruction,
  ]);
}

export function useDialogueConnection({
  selectedDialogueHost,
  selectedDialogueSessionId,
  setDialogueLoadingMore,
  setDialogueState,
  selectedDialogueExpanded,
  setExpandedDialogueEvents,
  dialogueRefresh,
  selectedDialogueLastEventAt,
}: {
  selectedDialogueHost: string;
  selectedDialogueSessionId: string;
  setDialogueLoadingMore: Dispatch<SetStateAction<boolean>>;
  setDialogueState: Dispatch<
    SetStateAction<{
      key: string;
      loading: boolean;
      data: DialogueSnapshot | null;
      error: string;
    }>
  >;
  selectedDialogueExpanded: boolean;
  setExpandedDialogueEvents: Dispatch<SetStateAction<Set<string>>>;
  dialogueRefresh: number;
  selectedDialogueLastEventAt: string;
}) {
  useEffect(() => {
    if (!selectedDialogueHost || !selectedDialogueSessionId) {
      return;
    }

    const key = `${selectedDialogueHost}:${selectedDialogueSessionId}`;
    const controller = new AbortController();
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) {
        setDialogueLoadingMore(false);
        setDialogueState((current) => beginDialogueRefresh(current, key));
      }
    });

    async function loadDialogue() {
      try {
        const response = await fetch(bridgeUrl("/api/dialogue"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: selectedDialogueHost,
            sessionId: selectedDialogueSessionId,
            limit: 30,
            dialogueOnly: false,
          }),
          signal: controller.signal,
        });
        const result = (await response.json()) as DialogueSnapshot & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error || `HTTP ${response.status}`);
        }
        if (!disposed) {
          setDialogueState((current) => ({
            key,
            loading: false,
            data: mergeConversationPage(
              current.key === key ? current.data : null,
              result,
            ),
            error: "",
          }));
          setExpandedDialogueEvents(
            new Set(
              result.events
                .filter((event) => event.category !== "operations")
                .map((event) => event.id),
            ),
          );
        }
      } catch (error) {
        if (!disposed && (error as Error).name !== "AbortError") {
          setDialogueState((current) =>
            failDialogueRefresh(current, key, (error as Error).message),
          );
        }
      }
    }

    loadDialogue();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [
    dialogueRefresh,
    selectedDialogueExpanded,
    selectedDialogueHost,
    selectedDialogueLastEventAt,
    selectedDialogueSessionId,
    setDialogueLoadingMore,
    setDialogueState,
    setExpandedDialogueEvents,
  ]);
}
