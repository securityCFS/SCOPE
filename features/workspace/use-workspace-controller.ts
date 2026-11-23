"use client";
import { bridgeUrl, managementKey } from "@/features/workspace/shared";
import type { Agent, DialogueCategory } from "@/features/workspace/types";
import { useMemo } from "react";
import { bindWorkspaceActions, type WorkspaceActions } from "./actions";

import {
  useAccountRestartPolling,
  useAccountSelection,
  useLoginPolling,
} from "./hooks/account-effects";
import {
  useAttachmentCleanup,
  useAttachmentOwnership,
  useAttachmentReferences,
  useDialogueBatchProgress,
  useDialogueBatchReset,
  useDialogueConnection,
  useInstructionReceipt,
} from "./hooks/dialogue-effects";
import { useSnapshotConnection } from "./hooks/snapshot-connection";
import { useResourceOverview } from "./hooks/use-resource-overview";
import { useSessionFiltering } from "./hooks/use-session-filtering";
import { useWorkspaceState } from "./hooks/use-workspace-state";
import {
  useModelCatalog,
  useResearchScroll,
  useSessionBatchProgress,
  useSessionBatchReset,
  useSessionOrder,
  useWorkspaceClock,
  useWorkspacePreferences,
  useWorkspaceWidth,
} from "./hooks/workspace-effects";

export function useWorkspaceController() {
  const actions: WorkspaceActions = bindWorkspaceActions(() => context);
  const { loadAccountProfiles, reloadModelsForHost } = actions;

  const state = useWorkspaceState();
  const {
    snapshot,
    setSnapshot,
    setBridgeState,
    viewMode,
    hostFilter,
    cwdFilter,
    setConversationFocus,
    gpuFilter,
    gpuWindow,
    historyOrder,
    historyState,
    statusFilter,
    categoryFilter,
    query,
    sessionRenderLimit,
    setSessionRenderLimit,
    agentOrderRevision,
    activeAgentOrder,
    setActiveAgentOrder,
    selectedAgentId,
    selectedExperimentId,
    setCopied,
    hostSidebarCollapsed,
    setHostSidebarCollapsed,
    setUiTheme,
    setBusyAction,
    setClockNow,
    dialogueRefresh,
    dialogueOrder,
    dialogueFilters,
    setExpandedDialogueEvents,
    dialogueRenderLimit,
    setDialogueRenderLimit,
    inspectorSectionOpen,
    dialogueState,
    setDialogueState,
    setDialogueLoadingMore,
    setActionNotice,
    accountProfilesOpen,
    accountHost,
    setProfileNameDraft,
    deviceLoginJob,
    setDeviceLoginJob,
    authRestartJob,
    setAuthRestartJob,
    setModelsByHost,
    setModelDrafts,
    modelRefresh,
    setModelErrors,
    hostModelOpen,
    setEffortDrafts,
    recoveryCwdDrafts,
    recoveryYoloDrafts,
    researchAssistantOpen,
    researchAssistantBusy,
    researchAssistantMessages,
    instructionAttachments,
    setInstructionAttachments,
    pendingInstruction,
    setPendingInstruction,
    instructionAttachmentOwnerRef,
    instructionAttachmentsRef,
    instructionFileInputRef,
    monitorColumnsRef,
    researchAssistantMessagesRef,
    setInspectorWidth,
  } = state;

  useWorkspacePreferences({ setUiTheme, setHostSidebarCollapsed });

  useResearchScroll({
    researchAssistantOpen,
    researchAssistantMessagesRef,
    researchAssistantBusy,
    researchAssistantMessages,
  });

  useSnapshotConnection({ setSnapshot, setBridgeState });

  useWorkspaceClock({ snapshot, setClockNow });

  useAttachmentReferences({
    instructionAttachmentsRef,
    instructionAttachments,
  });

  useAttachmentCleanup({ instructionAttachmentsRef });

  useAttachmentOwnership({
    instructionAttachmentOwnerRef,
    setInstructionAttachments,
    instructionFileInputRef,
    selectedAgentId,
  });

  useWorkspaceWidth({
    monitorColumnsRef,
    setInspectorWidth,
    hostSidebarCollapsed,
  });

  const resources = useResourceOverview({
    snapshot,
    gpuFilter,
    gpuWindow,
    historyState,
    hostFilter,
    cwdFilter,
    viewMode,
    query,
    statusFilter,
    categoryFilter,
    historyOrder,
    agentOrderRevision,
    activeAgentOrder,
  });
  const {
    allAgents,
    gpuActivityEpisodes,
    gpuEpisodesBySession,
    allExperiments,
    sortedMatchingAgents,
    activeAgentOrderScope,
    stableAgentOrder,
    filteredAgents,
  } = resources;
  useSessionOrder({ viewMode, filteredAgents, setConversationFocus });
  const hasPendingAgentOrder =
    viewMode === "agents" &&
    sortedMatchingAgents.some(
      (agent, index) =>
        managementKey(agent) !== managementKey(filteredAgents[index]),
    );

  useSessionBatchReset({
    viewMode,
    setActiveAgentOrder,
    activeAgentOrderScope,
    stableAgentOrder,
  });

  const renderedAgents = useMemo(
    () => filteredAgents.slice(0, sessionRenderLimit),
    [filteredAgents, sessionRenderLimit],
  );

  useSessionBatchProgress({
    setSessionRenderLimit,
    categoryFilter,
    cwdFilter,
    gpuFilter,
    historyOrder,
    hostFilter,
    query,
    statusFilter,
    viewMode,
  });

  const selection = useSessionFiltering({
    query,
    allExperiments,
    hostFilter,
    gpuFilter,
    gpuActivityEpisodes,
    filteredAgents: [...allAgents, ...resources.inactiveAgents],
    selectedAgentId,
    inspectorSectionOpen,
    gpuEpisodesBySession,
    snapshot,
    dialogueState,
    recoveryCwdDrafts,
    recoveryYoloDrafts,
    hostModelOpen,
  });
  const {
    filteredExperiments,
    selectedAgent,
    selectedDialogueExpanded,
    selectedSummary,
    selectedDialogueHost,
    selectedDialogueSessionId,
    selectedDialogueLastEventAt,
    selectedDialogueKey,
    selectedDialogue,
    modelCatalogHost,
    modelCatalogSessionId,
    modelCatalogKey,
  } = selection;
  useModelCatalog({
    modelCatalogHost,
    modelCatalogKey,
    modelCatalogSessionId,
    setModelsByHost,
    setModelErrors,
    modelRefresh,
  });

  useAccountSelection({ selectedAgent, setModelDrafts, setEffortDrafts });

  useLoginPolling({
    accountProfilesOpen,
    accountHost,
    setDeviceLoginJob,
    setAuthRestartJob,
    loadAccountProfiles,
  });

  useAccountRestartPolling({
    deviceLoginJob,
    getJson,
    setDeviceLoginJob,
    setProfileNameDraft,
    loadAccountProfiles,
    setActionNotice,
  });

  useInstructionReceipt({
    authRestartJob,
    getJson,
    setAuthRestartJob,
    setBusyAction,
    reloadModelsForHost,
    setActionNotice,
    refresh,
  });
  const dialogueCategoryCounts = useMemo(() => {
    const counts: Record<DialogueCategory, number> = {
      dialogue: 0,
      operations: 0,
      reasoning: 0,
      subagent: 0,
    };
    selectedDialogue?.events.forEach((event) => {
      counts[event.category] += 1;
    });
    return counts;
  }, [selectedDialogue]);
  const visibleDialogueEvents = useMemo(() => {
    const events = (selectedDialogue?.events || []).filter(
      (event) => dialogueFilters[event.category],
    );
    return dialogueOrder === "desc" ? [...events].reverse() : events;
  }, [dialogueFilters, dialogueOrder, selectedDialogue]);
  const renderedDialogueEvents = useMemo(
    () => visibleDialogueEvents.slice(0, dialogueRenderLimit),
    [dialogueRenderLimit, visibleDialogueEvents],
  );

  useDialogueBatchReset({
    setDialogueRenderLimit,
    dialogueFilters,
    dialogueOrder,
    selectedDialogueKey,
  });
  const canonicalDialogueMessages = useMemo(() => {
    let latestUser = "";
    let latestAssistant = "";
    let latestAssistantId = "";
    for (const event of selectedDialogue?.events || []) {
      if (event.category !== "dialogue" || !event.text) continue;
      if (event.kind === "user") latestUser = event.text;
      if (event.kind === "assistant") {
        latestAssistant = event.text;
        latestAssistantId = event.id;
      }
    }
    return { latestUser, latestAssistant, latestAssistantId };
  }, [selectedDialogue]);
  useDialogueBatchProgress({
    pendingInstruction,
    selectedAgent,
    canonicalDialogueMessages,
    setPendingInstruction,
    setActionNotice,
  });
  const selectedResearchResult =
    selectedSummary?.source === "rollout"
      ? canonicalDialogueMessages.latestAssistant || selectedSummary.result
      : selectedSummary?.result || canonicalDialogueMessages.latestAssistant;

  const selectedExperiment =
    allExperiments.find(
      (experiment) => experiment.id === selectedExperimentId,
    ) ||
    filteredExperiments[0] ||
    null;

  const selectedHost =
    hostFilter === "all"
      ? null
      : snapshot.hosts.find((host) => host.alias === hostFilter) || null;
  const selectedHostAppServerCount = selectedHost
    ? new Set([
        ...snapshot.appServer.sessions
          .filter((session) => session.host === selectedHost.alias)
          .map((session) => session.sessionId),
        ...(snapshot.appServer.restorePending || [])
          .filter((session) => session.host === selectedHost.alias)
          .map((session) => session.sessionId),
      ]).size
    : 0;

  const statusCounts = useMemo(
    () => ({
      working: allAgents.filter((agent) => agent.status === "working").length,
      idle: allAgents.filter((agent) => agent.status === "idle").length,
      attention: allAgents.filter((agent) => agent.status === "attention")
        .length,
    }),
    [allAgents],
  );

  useDialogueConnection({
    selectedDialogueHost,
    selectedDialogueSessionId,
    setDialogueLoadingMore,
    setDialogueState,
    selectedDialogueExpanded,
    setExpandedDialogueEvents,
    dialogueRefresh,
    selectedDialogueLastEventAt,
  });

  async function refresh() {
    try {
      await fetch(bridgeUrl("/api/refresh"), { method: "POST" });
      setBridgeState("connected");
    } catch {
      setBridgeState("offline");
    }
  }

  async function postJson<T>(path: string, body: unknown) {
    const response = await fetch(bridgeUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }

  async function getJson<T>(path: string) {
    const response = await fetch(bridgeUrl(path), { cache: "no-store" });
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  }

  function sortedHistorySessions(
    sessions: Agent[],
    requestedOrder: "recent" | "oldest",
  ) {
    return [...sessions].sort((left, right) => {
      const difference =
        (right.lastActivityAt || 0) - (left.lastActivityAt || 0);
      return requestedOrder === "recent" ? difference : -difference;
    });
  }

  async function copy(value: string, key: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1500);
  }

  const context = {
    ...state,
    ...resources,
    ...selection,
    ...actions,
    hasPendingAgentOrder,
    renderedAgents,
    dialogueCategoryCounts,
    visibleDialogueEvents,
    renderedDialogueEvents,
    canonicalDialogueMessages,
    selectedResearchResult,
    selectedExperiment,
    selectedHost,
    selectedHostAppServerCount,
    statusCounts,
    refresh,
    postJson,
    getJson,
    sortedHistorySessions,
    copy,
  };
  return context;
}
export type WorkspaceController = ReturnType<typeof useWorkspaceController>;
