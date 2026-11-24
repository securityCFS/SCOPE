"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SubagentWorkflowStep } from "@/components/subagent-workflow-drawer";
import { bridgeUrl } from "@/features/workspace/shared";
import type { DialogueEvent, Rollout } from "@/features/workspace/types";

type CodexSubagentDialogueResponse = {
  ok?: boolean;
  error?: string;
  events?: DialogueEvent[];
  hasMore?: boolean;
  nextBefore?: number | null;
  subagent?: {
    id: string;
    agentNickname?: string;
    agentPath?: string;
    agentRole?: string;
    model?: string;
    turnState?: string;
  };
};

type CodexWorkflowState = {
  targetKey: string;
  events: DialogueEvent[];
  hasMore: boolean;
  nextBefore: number | null;
  loading: boolean;
  error: string;
  model: string;
};

function mapDialogueToSteps(events: DialogueEvent[]): SubagentWorkflowStep[] {
  let seenPrompt = false;
  return events.map((event) => {
    if (event.kind === "user") {
      const isFirst = !seenPrompt;
      seenPrompt = true;
      return {
        id: event.id,
        kind: isFirst ? "prompt" : "assistant",
        title: isFirst ? "子代理任务" : event.title || "输入",
        text: event.text,
        timestamp: event.timestamp,
      };
    }
    if (event.kind === "reasoning" || event.kind === "intermediate") {
      return {
        id: event.id,
        kind: "thinking",
        title: event.title || "思考摘要",
        text: event.text,
        timestamp: event.timestamp,
      };
    }
    if (event.kind === "command") {
      return {
        id: event.id,
        kind: "command",
        toolName: event.toolName || "shell",
        title: event.title || "命令",
        command: event.command || event.text,
        summary: (event.command || event.text || "").split(/\r?\n/)[0].slice(0, 90),
        output: event.output || "",
        status: event.status || "completed",
        timestamp: event.timestamp,
      };
    }
    if (event.kind === "tool") {
      return {
        id: event.id,
        kind: "tool",
        toolName: event.toolName || event.title || "Tool",
        title: event.title || "工具调用",
        summary: (event.text || "").split(/\r?\n/)[0].slice(0, 90),
        inputPreview: event.text || "",
        output: event.output || "",
        status: event.status || "completed",
        timestamp: event.timestamp,
      };
    }
    if (event.kind === "error") {
      return {
        id: event.id,
        kind: "error",
        title: event.title || "会话错误",
        text: event.text,
        timestamp: event.timestamp,
      };
    }
    if (event.kind === "system") {
      return {
        id: event.id,
        kind: "note",
        title: event.title || "系统事件",
        text: event.text,
        timestamp: event.timestamp,
      };
    }
    return {
      id: event.id,
      kind: "assistant",
      title: event.title || "Codex",
      text: event.text,
      timestamp: event.timestamp,
    };
  });
}

export function useCodexSubagentWorkflow(
  host: string,
  sessionId: string,
  subagents: Rollout[],
  selectedId: string | null,
) {
  const selected = useMemo(
    () => (selectedId ? subagents.find((item) => item.id === selectedId) || null : null),
    [subagents, selectedId],
  );
  const targetKey = host && sessionId && selectedId ? `${host}:${sessionId}:${selectedId}` : "";
  const [state, setState] = useState<CodexWorkflowState>({
    targetKey: "",
    events: [],
    hasMore: false,
    nextBefore: null,
    loading: false,
    error: "",
    model: "",
  });
  const reqIdRef = useRef(0);

  const load = useCallback(
    async (before?: number | null, showSpinner = false) => {
      if (!targetKey || !selectedId) return;
      const reqId = ++reqIdRef.current;
      if (showSpinner) {
        setState((prev) =>
          prev.targetKey === targetKey
            ? { ...prev, loading: true, error: "" }
            : {
                targetKey,
                events: [],
                hasMore: false,
                nextBefore: null,
                loading: true,
                error: "",
                model: "",
              },
        );
      }
      try {
        const res = await fetch(bridgeUrl("/api/dialogue"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host,
            sessionId,
            subagentId: selectedId,
            limit: 40,
            ...(before != null ? { before } : {}),
          }),
        });
        const data = (await res.json()) as CodexSubagentDialogueResponse;
        if (reqId !== reqIdRef.current) return;
        if (!res.ok || data.error) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const incoming = Array.isArray(data.events) ? data.events : [];
        setState((prev) => {
          const merged =
            before != null && prev.targetKey === targetKey
              ? [
                  ...incoming,
                  ...prev.events.filter(
                    (existing) => !incoming.some((item) => item.id === existing.id),
                  ),
                ]
              : incoming;
          return {
            targetKey,
            events: merged,
            hasMore: Boolean(data.hasMore),
            nextBefore: data.nextBefore ?? null,
            loading: false,
            error: "",
            model: data.subagent?.model || prev.model || "",
          };
        });
      } catch (cause) {
        if (reqId !== reqIdRef.current) return;
        setState((prev) => ({
          targetKey,
          events: prev.targetKey === targetKey ? prev.events : [],
          hasMore: prev.targetKey === targetKey ? prev.hasMore : false,
          nextBefore: prev.targetKey === targetKey ? prev.nextBefore : null,
          loading: false,
          error: (cause as Error).message || "读取 Codex 子代理工作流失败",
          model: prev.targetKey === targetKey ? prev.model : "",
        }));
      }
    },
    [host, sessionId, selectedId, targetKey],
  );

  useEffect(() => {
    if (!targetKey) return;
    void load(null, false);
  }, [targetKey, load]);

  const isWorking = selected?.turnState === "working";
  useEffect(() => {
    if (!targetKey || !isWorking) return;
    const timer = setInterval(() => {
      if (!document.hidden) void load(null, false);
    }, 3000);
    return () => clearInterval(timer);
  }, [targetKey, isWorking, load]);

  const steps = useMemo(
    () =>
      state.targetKey === targetKey
        ? mapDialogueToSteps(state.events)
        : [],
    [state.targetKey, state.events, targetKey],
  );

  return {
    selected,
    steps,
    loading: state.targetKey === targetKey ? state.loading : Boolean(targetKey),
    error: state.targetKey === targetKey ? state.error : "",
    hasMore: state.targetKey === targetKey ? state.hasMore : false,
    model: (state.targetKey === targetKey ? state.model : "") || selected?.model || "",
    status: isWorking ? "working" : "completed",
    refresh: () => void load(null, true),
    loadMore: () => {
      if (state.targetKey === targetKey && state.nextBefore != null) {
        void load(state.nextBefore, true);
      }
    },
  };
}
