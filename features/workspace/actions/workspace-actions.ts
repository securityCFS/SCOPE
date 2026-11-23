import {
  INSPECTOR_WIDTH_KEY,
  bridgeUrl,
  clampInspectorWidth,
  managementKey,
} from "@/features/workspace/shared";
import type {
  Agent,
  DialogueCategory,
  DialogueSnapshot,
} from "@/features/workspace/types";
import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
} from "react";
import type { DialogueEvent } from "../types";

export async function loadOlderDialogue({
  dialogueLoadingMore,
  selectedDialogue,
  selectedDialogueHost,
  selectedDialogueSessionId,
  setDialogueLoadingMore,
  setDialogueState,
  setExpandedDialogueEvents,
}: {
  dialogueLoadingMore: boolean;
  selectedDialogue: DialogueSnapshot | null;
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
  setExpandedDialogueEvents: Dispatch<SetStateAction<Set<string>>>;
}) {
  if (
    dialogueLoadingMore ||
    !selectedDialogue?.hasMore ||
    selectedDialogue.nextBefore === null ||
    !selectedDialogueHost ||
    !selectedDialogueSessionId
  ) {
    return;
  }
  const key = `${selectedDialogueHost}:${selectedDialogueSessionId}`;
  setDialogueLoadingMore(true);
  try {
    const response = await fetch(bridgeUrl("/api/dialogue"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: selectedDialogueHost,
        sessionId: selectedDialogueSessionId,
        limit: 10,
        before: selectedDialogue.nextBefore,
      }),
    });
    const result = (await response.json()) as DialogueSnapshot & {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    setDialogueState((current) => {
      if (current.key !== key || !current.data) return current;
      const seen = new Set<string>();
      const events = [...result.events, ...current.data.events].filter(
        (event) => {
          if (seen.has(event.id)) return false;
          seen.add(event.id);
          return true;
        },
      );
      const counts: DialogueSnapshot["counts"] = {};
      events.forEach((event) => {
        counts[event.kind] = (counts[event.kind] || 0) + 1;
      });
      return {
        ...current,
        error: "",
        data: {
          ...current.data,
          loadedAt: result.loadedAt,
          events,
          counts,
          totalLines: current.data.totalLines + result.totalLines,
          scannedBytes: current.data.scannedBytes + result.scannedBytes,
          toolEventCount: events.filter((event) =>
            ["command", "tool"].includes(event.kind),
          ).length,
          hiddenReasoningCount:
            current.data.hiddenReasoningCount + result.hiddenReasoningCount,
          hasMore: result.hasMore,
          nextBefore: result.nextBefore,
        },
      };
    });
    setExpandedDialogueEvents((current) => {
      const next = new Set(current);
      result.events
        .filter((event) => event.category !== "operations")
        .forEach((event) => next.add(event.id));
      return next;
    });
  } catch (error) {
    setDialogueState((current) =>
      current.key === key
        ? { ...current, error: (error as Error).message }
        : current,
    );
  } finally {
    setDialogueLoadingMore(false);
  }
}

export function toggleDialogueFilter(
  {
    setDialogueFilters,
  }: {
    setDialogueFilters: Dispatch<
      SetStateAction<
        Record<"reasoning" | "dialogue" | "operations" | "subagent", boolean>
      >
    >;
  },
  category: DialogueCategory,
) {
  setDialogueFilters((current) => ({
    ...current,
    [category]: !current[category],
  }));
}

export function setDialogueEventExpanded(
  {
    setExpandedDialogueEvents,
  }: {
    setExpandedDialogueEvents: Dispatch<SetStateAction<Set<string>>>;
  },
  eventId: string,
  expanded: boolean,
) {
  setExpandedDialogueEvents((current) => {
    if (current.has(eventId) === expanded) return current;
    const next = new Set(current);
    if (expanded) next.add(eventId);
    else next.delete(eventId);
    return next;
  });
}

export function setVisibleDialogueExpanded(
  {
    setExpandedDialogueEvents,
    renderedDialogueEvents,
  }: {
    setExpandedDialogueEvents: Dispatch<SetStateAction<Set<string>>>;
    renderedDialogueEvents: DialogueEvent[];
  },
  expanded: boolean,
) {
  setExpandedDialogueEvents((current) => {
    const next = new Set(current);
    renderedDialogueEvents.forEach((event) => {
      if (expanded) next.add(event.id);
      else next.delete(event.id);
    });
    return next;
  });
}

export function updateInspectorWidth(
  {
    monitorColumnsRef,
    hostSidebarCollapsed,
    setInspectorWidth,
  }: {
    monitorColumnsRef: RefObject<HTMLDivElement | null>;
    hostSidebarCollapsed: boolean;
    setInspectorWidth: Dispatch<SetStateAction<number>>;
  },
  requestedWidth: number,
) {
  const containerWidth =
    monitorColumnsRef.current?.clientWidth || window.innerWidth;
  const nextWidth = clampInspectorWidth(
    requestedWidth,
    containerWidth,
    window.innerWidth,
    hostSidebarCollapsed,
  );
  setInspectorWidth(nextWidth);
  try {
    window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(nextWidth));
  } catch {
    // A blocked localStorage should not prevent resizing in this session.
  }
}

export function resizeInspectorAt(
  {
    monitorColumnsRef,
    updateInspectorWidth,
  }: {
    monitorColumnsRef: RefObject<HTMLDivElement | null>;
    updateInspectorWidth: (requestedWidth: number) => void;
  },
  clientX: number,
) {
  const rightEdge =
    monitorColumnsRef.current?.getBoundingClientRect().right ||
    window.innerWidth;
  updateInspectorWidth(rightEdge - clientX);
}

export function beginColumnResize(
  {
    resizeActiveRef,
    setIsResizing,
    resizeInspectorAt,
  }: {
    resizeActiveRef: RefObject<boolean>;
    setIsResizing: Dispatch<SetStateAction<boolean>>;
    resizeInspectorAt: (clientX: number) => void;
  },
  event: ReactPointerEvent<HTMLButtonElement>,
) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  resizeActiveRef.current = true;
  setIsResizing(true);
  event.currentTarget.setPointerCapture(event.pointerId);
  resizeInspectorAt(event.clientX);
}

export function continueColumnResize(
  {
    resizeActiveRef,
    resizeInspectorAt,
  }: {
    resizeActiveRef: RefObject<boolean>;
    resizeInspectorAt: (clientX: number) => void;
  },
  event: ReactPointerEvent<HTMLButtonElement>,
) {
  if (!resizeActiveRef.current) return;
  resizeInspectorAt(event.clientX);
}

export function endColumnResize(
  {
    resizeActiveRef,
    setIsResizing,
  }: {
    resizeActiveRef: RefObject<boolean>;
    setIsResizing: Dispatch<SetStateAction<boolean>>;
  },
  event: ReactPointerEvent<HTMLButtonElement>,
) {
  if (!resizeActiveRef.current) return;
  resizeActiveRef.current = false;
  setIsResizing(false);
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

export async function copyRawContext(
  {
    setBusyAction,
    setActionNotice,
    postJson,
    copy,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    copy: (value: string, key: string) => Promise<void>;
  },
  agent: Agent,
) {
  if (!agent.rollout?.id) return;
  const action = `raw-context:${managementKey(agent)}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    const result = await postJson<{
      context: {
        truncated?: boolean;
        records?: unknown[];
        [key: string]: unknown;
      };
    }>("/api/session/raw-context", {
      host: agent.host,
      sessionId: agent.rollout.id,
    });
    await copy(JSON.stringify(result.context, null, 2), action);
    setActionNotice({
      kind: "success",
      text: result.context.truncated
        ? "Raw context 已复制；内容超过安全传输上限，最早一段已截断。"
        : `Raw context 已复制（${result.context.records?.length || 0} 条原始记录）。`,
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export async function copyLatestAssistantReply(
  {
    canonicalDialogueMessages,
    selectedDialoguePending,
    setActionNotice,
    copy,
  }: {
    canonicalDialogueMessages: { latestUser: string; latestAssistant: string };
    selectedDialoguePending: boolean;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    copy: (value: string, key: string) => Promise<void>;
  },
  agent: Agent,
) {
  const reply =
    canonicalDialogueMessages.latestAssistant ||
    (!selectedDialoguePending ? agent.rollout?.lastAssistant || "" : "");
  if (!reply) {
    setActionNotice({
      kind: "error",
      text: selectedDialoguePending
        ? "最新回复仍在读取，请稍后再复制。"
        : "当前 Session 尚无可复制的 Codex 回复。",
    });
    return;
  }
  const action = `latest-assistant:${managementKey(agent)}`;
  try {
    await copy(reply, action);
    setActionNotice({
      kind: "success",
      text: "已复制 Codex 最新一条原始回复。",
    });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  }
}
