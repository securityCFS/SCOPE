"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SubagentWorkflowStep } from "@/components/subagent-workflow-drawer";
import type { NativeSubagent } from "./use-native-history";
import { conversationRequest } from "./use-session-catalog";

type ClaudeWorkflowResponse = {
  found?: boolean;
  notModified?: boolean;
  provider?: string;
  subagentId?: string;
  toolUseId?: string;
  role?: string;
  typeName?: string;
  model?: string;
  spawnDepth?: number | null;
  status?: string;
  updatedAt?: number;
  version?: string;
  totalSteps?: number;
  truncated?: boolean;
  steps?: SubagentWorkflowStep[];
};

type FetchState = {
  targetKey: string;
  data: ClaudeWorkflowResponse | null;
  loading: boolean;
  error: string;
};

export function useClaudeSubagentWorkflow(
  catalogKey: string,
  provider: string,
  subagents: NativeSubagent[],
  selectedId: string | null,
) {
  const selected = useMemo(
    () =>
      selectedId
        ? subagents.find(
            (item) =>
              item.id === selectedId ||
              item.agentId === selectedId ||
              item.toolUseId === selectedId,
          ) || null
        : null,
    [subagents, selectedId],
  );
  const lookupId = selected?.agentId || selected?.id || selectedId || "";
  const canFetchDisk = Boolean(
    provider === "claude" &&
      catalogKey &&
      !catalogKey.startsWith("cli:") &&
      lookupId,
  );
  const targetKey = canFetchDisk ? `${catalogKey}::${lookupId}` : "";

  const [state, setState] = useState<FetchState>({
    targetKey: "",
    data: null,
    loading: false,
    error: "",
  });
  const versionRef = useRef<{ targetKey: string; version: string }>({
    targetKey: "",
    version: "",
  });
  const reqIdRef = useRef(0);

  const fetchWorkflow = useCallback(
    async (force = false, showSpinner = false) => {
      if (!canFetchDisk || !targetKey) return;
      const reqId = ++reqIdRef.current;
      const cachedVersion =
        !force && versionRef.current.targetKey === targetKey
          ? versionRef.current.version
          : "";
      if (showSpinner) {
        setState((prev) =>
          prev.targetKey === targetKey
            ? { ...prev, loading: true, error: "" }
            : { targetKey, data: null, loading: true, error: "" },
        );
      }
      try {
        const params = new URLSearchParams({
          key: catalogKey,
          subagentId: lookupId,
        });
        if (cachedVersion) params.set("version", cachedVersion);
        const res = await conversationRequest<ClaudeWorkflowResponse>(
          `/api/session-catalog/subagent-workflow?${params.toString()}`,
        );
        if (reqId !== reqIdRef.current) return;
        if (res.notModified) {
          setState((prev) =>
            prev.targetKey === targetKey
              ? { ...prev, loading: false, error: "" }
              : prev,
          );
          return;
        }
        if (res.version) {
          versionRef.current = { targetKey, version: res.version };
        }
        setState({
          targetKey,
          data: res,
          loading: false,
          error: "",
        });
      } catch (cause) {
        if (reqId !== reqIdRef.current) return;
        setState((prev) => ({
          targetKey,
          data: prev.targetKey === targetKey ? prev.data : null,
          loading: false,
          error: (cause as Error).message || "加载子代理工作流失败",
        }));
      }
    },
    [canFetchDisk, catalogKey, lookupId, targetKey],
  );

  useEffect(() => {
    if (!canFetchDisk || !targetKey) return;
    void fetchWorkflow(true, false);
  }, [canFetchDisk, targetKey, fetchWorkflow]);

  const activeData = state.targetKey === targetKey ? state.data : null;
  const activeStatus =
    selected?.status === "working"
      ? "working"
      : activeData?.status || selected?.status || "completed";

  useEffect(() => {
    if (!canFetchDisk || !targetKey || activeStatus !== "working") return;
    const timer = setInterval(() => {
      if (!document.hidden) void fetchWorkflow(false, false);
    }, 2500);
    return () => clearInterval(timer);
  }, [canFetchDisk, targetKey, activeStatus, fetchWorkflow]);

  const diskSteps = activeData?.found ? activeData.steps || [] : [];
  const liveSteps = selected?.steps || [];
  const useDisk =
    diskSteps.length > 0 &&
    (diskSteps.length >= liveSteps.length || activeStatus !== "working");
  const steps = useDisk ? diskSteps : liveSteps;

  return {
    selected,
    steps,
    partial: activeStatus === "working" ? selected?.partial || "" : "",
    loading:
      state.targetKey === targetKey
        ? state.loading
        : canFetchDisk && liveSteps.length === 0,
    error:
      state.targetKey === targetKey && liveSteps.length === 0
        ? state.error
        : "",
    status: activeStatus,
    model: activeData?.model || selected?.model || "",
    typeName: activeData?.typeName || selected?.typeName || "",
    spawnDepth: activeData?.spawnDepth ?? selected?.spawnDepth ?? null,
    role: activeData?.role || selected?.role || "",
    totalSteps: useDisk ? activeData?.totalSteps ?? diskSteps.length : liveSteps.length,
    truncated: useDisk ? Boolean(activeData?.truncated) : false,
    refresh: () => void fetchWorkflow(true, true),
  };
}
