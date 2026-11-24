"use client";
import type { SubagentWorkflowStep } from "@/components/subagent-workflow-drawer";
import { useCallback, useEffect, useRef, useState } from "react";
import { conversationRequest, type CatalogEntry } from "./use-session-catalog";

export type NativeHistoryMessage = {
  id?: string;
  role: string;
  text: string;
  activity?: string;
  title?: string;
  createdAt?: string;
  truncated?: boolean;
};
export type NativeSubagent = {
  id: string;
  agentId?: string;
  toolUseId?: string;
  taskId?: string;
  role: string;
  typeName?: string;
  model?: string;
  spawnDepth?: number | null;
  background?: boolean;
  status: string;
  lastAction?: string;
  updatedAt?: number | null;
  hasWorkflow?: boolean;
  steps?: SubagentWorkflowStep[];
  partial?: string;
};

export type NativeHistory = {
  messages: NativeHistoryMessage[];
  subagents?: NativeSubagent[];
  summary?: string;
  summaryOnly?: boolean;
  reason?: string;
  limited?: boolean;
  nextBefore?: number | null;
  version?: string;
  reset?: boolean;
};
export function useNativeHistory(
  entry: CatalogEntry,
  sessionId?: string | null,
  turnStatus?: string,
) {
  const nativeId = sessionId || entry.sessionId;
  const key =
    entry.provider === "antigravity" && nativeId
      ? JSON.stringify([entry.host, entry.provider, nativeId])
      : entry.key.startsWith("cli:")
        ? ""
        : entry.key;
  const [history, setHistory] = useState<NativeHistory | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestState = useRef({ generation: 0 });
  const read = useCallback(
    (before?: number, version?: string) => {
      if (!key) return Promise.resolve();
      const state = requestState.current;
      const request = ++state.generation;
      const url = `/api/session-catalog/dialogue?key=${encodeURIComponent(key)}${before === undefined ? "" : `&before=${before}&version=${encodeURIComponent(version || "")}`}`;
      return conversationRequest<NativeHistory>(url)
        .then((value) => {
          if (request !== state.generation) return;
          setHistory((previous) =>
            before !== undefined &&
            previous &&
            !value.reset &&
            previous.version === value.version
              ? {
                  ...value,
                  limited: previous.limited || value.limited,
                  messages: [...value.messages, ...previous.messages],
                }
              : value,
          );
          setError("");
        })
        .catch((cause) => {
          if (request === state.generation) setError((cause as Error).message);
        })
        .finally(() => {
          if (request === state.generation) setBusy(false);
        });
    },
    [key],
  );
  useEffect(() => {
    const state = requestState.current;
    void read();
    return () => {
      state.generation++;
    };
  }, [read, entry.historyVersion, entry.updatedAt, turnStatus]);
  const refresh = useCallback(() => {
    if (!key) return Promise.resolve();
    setBusy(true);
    return read();
  }, [key, read]);
  const nextBeforeCursor = history?.nextBefore;
  const historyVersion = history?.version;
  const earlier = useCallback(() => {
    if (nextBeforeCursor == null) return Promise.resolve();
    setBusy(true);
    return read(nextBeforeCursor, historyVersion);
  }, [nextBeforeCursor, historyVersion, read]);
  return {
    available: Boolean(key),
    history,
    error,
    busy: busy || (!!key && !history && !error),
    refresh,
    earlier,
  };
}
