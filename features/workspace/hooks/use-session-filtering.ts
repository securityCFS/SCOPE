"use client";
import { useMemo } from "react";
import type {
  Agent,
  DialogueSnapshot,
  Experiment,
  GpuUsageEpisode,
  Snapshot,
} from "../types";

import {
  managementKey,
  managementRecord,
  recoveryCwdOptions,
  resolvedSummary,
  rolloutUsesYolo,
  sessionModelCatalogKey,
} from "@/features/workspace/shared";

export function useSessionFiltering({
  query,
  allExperiments,
  hostFilter,
  gpuFilter,
  gpuActivityEpisodes,
  filteredAgents,
  selectedAgentId,
  inspectorSectionOpen,
  gpuEpisodesBySession,
  snapshot,
  dialogueState,
  recoveryCwdDrafts,
  recoveryYoloDrafts,
  hostModelOpen,
}: {
  query: string;
  allExperiments: Experiment[];
  hostFilter: string;
  gpuFilter: string;
  gpuActivityEpisodes: GpuUsageEpisode[];
  filteredAgents: Agent[];
  selectedAgentId: string | null;
  inspectorSectionOpen: Record<string, boolean>;
  gpuEpisodesBySession: Map<string, GpuUsageEpisode[]>;
  snapshot: Snapshot;
  dialogueState: {
    key: string;
    loading: boolean;
    data: DialogueSnapshot | null;
    error: string;
  };
  recoveryCwdDrafts: Record<string, string>;
  recoveryYoloDrafts: Record<string, boolean>;
  hostModelOpen: boolean;
}) {
  const filteredExperiments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return allExperiments
      .filter(
        (experiment) => hostFilter === "all" || experiment.host === hostFilter,
      )
      .filter(
        (experiment) =>
          gpuFilter === "all" ||
          gpuActivityEpisodes.some(
            (episode) =>
              episode.host === experiment.host &&
              episode.paneSession === experiment.session &&
              (!episode.pane || episode.pane === experiment.pane),
          ),
      )
      .filter((experiment) => {
        if (!normalized) return true;
        return [
          experiment.host,
          experiment.hostname,
          experiment.cwd,
          experiment.session,
          experiment.command,
          experiment.preview,
        ].some((value) => value?.toLowerCase().includes(normalized));
      })
      .sort((a, b) => {
        const priority = { attention: 0, working: 1, idle: 2 };
        if (priority[a.status] !== priority[b.status]) {
          return priority[a.status] - priority[b.status];
        }
        return (b.activityAt || 0) - (a.activityAt || 0);
      });
  }, [allExperiments, gpuActivityEpisodes, gpuFilter, hostFilter, query]);
  const selectedAgent =
    filteredAgents.find((agent) => agent.id === selectedAgentId) || null;
  const selectedAgentIsExternalTerminal = Boolean(
    selectedAgent &&
    !selectedAgent.historical &&
    !selectedAgent.appServerManaged &&
    !selectedAgent.pane &&
    selectedAgent.pid > 0,
  );
  const selectedInspectorKey = selectedAgent
    ? managementKey(selectedAgent)
    : "";
  const selectedDialogueExpanded = selectedInspectorKey
    ? (inspectorSectionOpen[`${selectedInspectorKey}:dialogue`] ?? false)
    : false;
  const selectedSummaryExpanded = selectedInspectorKey
    ? (inspectorSectionOpen[`${selectedInspectorKey}:summary`] ?? false)
    : false;
  const selectedResearchExpanded = selectedInspectorKey
    ? (inspectorSectionOpen[`${selectedInspectorKey}:research`] ?? false)
    : false;
  const selectedControlExpanded = selectedInspectorKey
    ? (inspectorSectionOpen[`${selectedInspectorKey}:control`] ?? false)
    : false;
  const selectedExperimentsExpanded = selectedInspectorKey
    ? (inspectorSectionOpen[`${selectedInspectorKey}:experiments`] ?? false)
    : false;
  const selectedPolicyExpanded = selectedInspectorKey
    ? (inspectorSectionOpen[`${selectedInspectorKey}:policy`] ?? false)
    : false;
  const selectedAgentGpuUsage = selectedAgent
    ? gpuEpisodesBySession.get(managementKey(selectedAgent)) || []
    : [];
  const selectedManagement = selectedAgent
    ? managementRecord(selectedAgent, snapshot.management)
    : {};
  const selectedSummary = selectedAgent
    ? resolvedSummary(selectedAgent, snapshot.management)
    : null;
  const selectedQuotaUsed =
    selectedAgent?.rollout?.account?.primary?.used_percent ?? null;
  const selectedDialogueHost = selectedAgent?.host || "";
  const selectedDialogueSessionId = selectedAgent?.rollout?.id || "";
  const selectedDialogueLastEventAt =
    selectedAgent?.rollout?.lastEventAt ||
    String(selectedAgent?.rollout?.mtimeMs || "");
  const selectedDialogueKey =
    selectedDialogueHost && selectedDialogueSessionId
      ? `${selectedDialogueHost}:${selectedDialogueSessionId}`
      : "";
  const selectedDialogue =
    dialogueState.key === selectedDialogueKey ? dialogueState.data : null;
  const selectedDialogueLoading =
    dialogueState.key === selectedDialogueKey && dialogueState.loading;
  const selectedDialoguePending = Boolean(
    selectedDialogueKey &&
    (dialogueState.key !== selectedDialogueKey || dialogueState.loading),
  );
  const selectedDialogueError =
    dialogueState.key === selectedDialogueKey ? dialogueState.error : "";
  const pendingHumanRequests =
    snapshot.appServer?.pendingRequests ||
    snapshot.appServer?.pendingInputs ||
    [];
  const selectedHumanRequests = selectedAgent?.rollout?.id
    ? pendingHumanRequests.filter(
        (request) =>
          request.host === selectedAgent.host &&
          request.threadId === selectedAgent.rollout?.id,
      )
    : [];
  const selectedAppServerConnected = Boolean(
    selectedAgent &&
    snapshot.appServer?.connections.some(
      (connection) =>
        connection.host === selectedAgent.host &&
        connection.status === "connected" &&
        connection.sessionIds.includes(selectedAgent.rollout?.id || ""),
    ),
  );
  const selectedAppServerSession = selectedAgent?.rollout?.id
    ? snapshot.appServer?.sessions.find(
        (session) =>
          session.host === selectedAgent.host &&
          session.sessionId === selectedAgent.rollout?.id &&
          ((selectedAppServerConnected && session.status !== "offline") ||
            Boolean(session.profileAssignment?.handoff)),
      )
    : null;
  const selectedRecoveryCwdOptions = selectedAgent
    ? recoveryCwdOptions(selectedAgent, snapshot.hosts)
    : [];
  const selectedRecoveryCwd = selectedAgent
    ? (recoveryCwdDrafts[managementKey(selectedAgent)] ??
      (selectedAgent.historical
        ? selectedRecoveryCwdOptions[0] || ""
        : selectedAgent.cwd))
    : "";
  const selectedRecoveryYolo = selectedAgent
    ? (recoveryYoloDrafts[managementKey(selectedAgent)] ??
      selectedAppServerSession?.yolo ??
      rolloutUsesYolo(selectedAgent, snapshot.management))
    : true;
  const modelCatalogHost =
    hostModelOpen && hostFilter !== "all"
      ? hostFilter
      : selectedAgent?.host || "";
  const modelCatalogSessionId = hostModelOpen
    ? ""
    : selectedAgent?.rollout?.id || "";
  const modelCatalogConnectionKey = snapshot.appServer?.sessions.find(
    (session) =>
      session.host === modelCatalogHost &&
      session.sessionId === modelCatalogSessionId,
  )?.connectionKey;
  const modelCatalogKey =
    modelCatalogSessionId && modelCatalogHost
      ? sessionModelCatalogKey(
          modelCatalogHost,
          modelCatalogSessionId,
          modelCatalogConnectionKey,
        )
      : modelCatalogHost;
  return {
    filteredExperiments,
    selectedAgent,
    selectedAgentIsExternalTerminal,
    selectedInspectorKey,
    selectedDialogueExpanded,
    selectedSummaryExpanded,
    selectedResearchExpanded,
    selectedControlExpanded,
    selectedExperimentsExpanded,
    selectedPolicyExpanded,
    selectedAgentGpuUsage,
    selectedManagement,
    selectedSummary,
    selectedQuotaUsed,
    selectedDialogueHost,
    selectedDialogueSessionId,
    selectedDialogueLastEventAt,
    selectedDialogueKey,
    selectedDialogue,
    selectedDialogueLoading,
    selectedDialoguePending,
    selectedDialogueError,
    pendingHumanRequests,
    selectedHumanRequests,
    selectedAppServerConnected,
    selectedAppServerSession,
    selectedRecoveryCwdOptions,
    selectedRecoveryCwd,
    selectedRecoveryYolo,
    modelCatalogHost,
    modelCatalogSessionId,
    modelCatalogConnectionKey,
    modelCatalogKey,
  };
}
