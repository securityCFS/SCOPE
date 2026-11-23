"use client";
import { type ProjectEntry } from "@/components/project-sidebar";
import { projectIdentity, projectList } from "@/lib/projects.js";
import {
  collectCwdOptions,
  excludeActiveSessions,
} from "@/lib/session-filters";
import { retainStableOrder } from "@/lib/stable-order";
import { useMemo } from "react";
import type { Agent, GpuUsageEpisode, Pane, Snapshot } from "../types";

import {
  emptySnapshot,
  gpuKey,
  managementKey,
  managementRecord,
  parseGpuKey,
  pathName,
  priorityRank,
  resolvedSummary,
  summarizePane,
} from "@/features/workspace/shared";

export function useResourceOverview({
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
}: {
  snapshot: Snapshot;
  gpuFilter: string;
  gpuWindow: "active" | "1h" | "6h" | "24h" | "168h";
  historyState: {
    sessions: Agent[];
    scannedAt: string | null;
    scope: string;
    hosts: {
      host: string;
      totalFiles: number;
      truncated: boolean;
      returned: number;
      error: string | null;
    }[];
    loading: boolean;
    error: string;
  };
  hostFilter: string;
  cwdFilter: string;
  viewMode: "agents" | "history" | "experiments";
  query: string;
  statusFilter: "all" | "working" | "idle" | "attention";
  categoryFilter:
    "all" | "research" | "training" | "evaluation" | "engineering" | "other";
  historyOrder: "recent" | "oldest";
  agentOrderRevision: number;
  activeAgentOrder: { scope: string; keys: string[] };
}) {
  const allAgents = useMemo(
    () => snapshot.hosts.flatMap((host) => host.agents),
    [snapshot.hosts],
  );
  const operatorName = snapshot.management.operatorName?.trim() || "Operator";
  const gpuUsage = snapshot.gpuUsage || emptySnapshot.gpuUsage;
  const gpuOptions = useMemo(() => {
    const options = new Map<
      string,
      { key: string; host: string; index: number; name: string }
    >();
    for (const host of snapshot.hosts) {
      for (const gpu of host.gpus) {
        const key = gpuKey(host.alias, gpu.index);
        options.set(key, {
          key,
          host: host.alias,
          index: gpu.index,
          name: gpu.name,
        });
      }
    }
    for (const episode of gpuUsage.episodes) {
      const key = gpuKey(episode.host, episode.gpuIndex);
      if (!options.has(key)) {
        options.set(key, {
          key,
          host: episode.host,
          index: episode.gpuIndex,
          name: episode.gpuName,
        });
      }
    }
    return [...options.values()].sort(
      (left, right) =>
        left.host.localeCompare(right.host) || left.index - right.index,
    );
  }, [gpuUsage.episodes, snapshot.hosts]);
  const selectedGpu = gpuFilter === "all" ? null : parseGpuKey(gpuFilter);
  const selectedGpuHost = selectedGpu?.host || "";
  const selectedGpuIndex = selectedGpu?.index ?? -1;
  const gpuWindowMs =
    gpuWindow === "active"
      ? 0
      : Number(gpuWindow.replace("h", "")) * 60 * 60 * 1_000;
  const gpuActivityEpisodes = useMemo(() => {
    const cutoff = (Date.parse(snapshot.generatedAt || "") || 0) - gpuWindowMs;
    return gpuUsage.episodes
      .filter(
        (episode) =>
          !selectedGpuHost ||
          (episode.host === selectedGpuHost &&
            episode.gpuIndex === selectedGpuIndex),
      )
      .filter((episode) =>
        gpuWindow === "active"
          ? episode.active
          : episode.active || Date.parse(episode.lastSeenAt) >= cutoff,
      )
      .sort(
        (left, right) =>
          Number(right.active) - Number(left.active) ||
          Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt),
      );
  }, [
    gpuUsage.episodes,
    gpuWindow,
    gpuWindowMs,
    selectedGpuHost,
    selectedGpuIndex,
    snapshot.generatedAt,
  ]);
  const gpuSessionIds = useMemo(
    () =>
      new Set(
        gpuActivityEpisodes
          .map((episode) => episode.ownerSessionId)
          .filter((value): value is string => Boolean(value)),
      ),
    [gpuActivityEpisodes],
  );
  const gpuEpisodesBySession = useMemo(() => {
    const result = new Map<string, GpuUsageEpisode[]>();
    for (const episode of gpuUsage.episodes) {
      if (!episode.ownerSessionId) continue;
      const key = `${episode.host}:${episode.ownerSessionId}`;
      const current = result.get(key) || [];
      current.push(episode);
      result.set(key, current);
    }
    for (const episodes of result.values()) {
      episodes.sort(
        (left, right) =>
          Number(right.active) - Number(left.active) ||
          Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt),
      );
    }
    return result;
  }, [gpuUsage.episodes]);
  const snapshotSubmissionTracker =
    snapshot.submissionTracker || emptySnapshot.submissionTracker;
  const submissionTracker = {
    ...emptySnapshot.submissionTracker,
    ...snapshotSubmissionTracker,
    items: snapshotSubmissionTracker.items || [],
    calls: snapshotSubmissionTracker.calls || [],
    launches: snapshotSubmissionTracker.launches || [],
    alerts: snapshotSubmissionTracker.alerts || [],
    hosts: snapshotSubmissionTracker.hosts || [],
  };
  const submissionHostFailures = submissionTracker.hosts.filter((host) =>
    Boolean(host.error),
  );
  const submissionWindowLabel = submissionTracker.windowDays
    ? `最近 ${submissionTracker.windowDays} 天`
    : "全部历史";
  const submissionCounts = useMemo(
    () => ({
      failed: submissionTracker.items.filter((item) =>
        /fail|fault|stopp|cancel|kill/i.test(item.status || ""),
      ).length,
      queued: submissionTracker.items.filter((item) =>
        /queu|enqueued|pending/i.test(item.status || ""),
      ).length,
      running: submissionTracker.items.filter((item) =>
        /running/i.test(item.status || ""),
      ).length,
    }),
    [submissionTracker.items],
  );
  const auditedDlcCalls = useMemo(() => {
    const confirmed = submissionTracker.calls.filter(
      (call) =>
        !call.inspection &&
        !call.dryRun &&
        call.invocationKind !== "output-only" &&
        (call.invocationKind !== "submit-script" ||
          call.jobIds.length > 0 ||
          call.jobNames.length > 0),
    );
    const confirmedIds = new Set(confirmed.map((call) => call.id));
    const unconfirmed = submissionTracker.calls.filter(
      (call) => !confirmedIds.has(call.id),
    );
    return {
      confirmed,
      explicitAttempts: unconfirmed.filter(
        (call) =>
          call.invocationKind !== "output-only" &&
          call.explicitSubmit &&
          !call.inspection &&
          !call.dryRun,
      ),
      candidates: unconfirmed,
    };
  }, [submissionTracker.calls]);
  const dlcCallCounts = useMemo(
    () => ({
      actual: auditedDlcCalls.confirmed.length,
      candidates: auditedDlcCalls.candidates.length,
    }),
    [auditedDlcCalls],
  );
  const allExperiments = useMemo(
    () =>
      snapshot.hosts.flatMap((host) => {
        const codexPaneKeys = new Set(
          host.agents
            .map((agent) => agent.pane)
            .filter((pane): pane is Pane => Boolean(pane))
            .map((pane) => `${pane.session}:${pane.pane}`),
        );
        return host.panes
          .filter((pane) => {
            if (pane.dead) return false;
            if (codexPaneKeys.has(`${pane.session}:${pane.pane}`)) return false;
            const hasLiveWorkload = (host.workloads || []).some(
              (workload) =>
                workload.pane?.session === pane.session &&
                workload.pane?.pane === pane.pane,
            );
            if (hasLiveWorkload) return true;
            return !/^(?:ba|z|c|fi)?sh$|^tmux(?:: server)?$/i.test(
              pane.command.trim(),
            );
          })
          .map((pane) => summarizePane(host, pane));
      }),
    [snapshot.hosts],
  );
  const usageFrequency = useMemo(() => {
    const now = Date.parse(snapshot.generatedAt || "") || 0;
    const day = 24 * 60 * 60 * 1_000;
    const roots = snapshot.hosts.flatMap((host) =>
      host.sessions
        .filter((session) => !session.isSubagent)
        .map((session) => ({ host: host.alias, session })),
    );
    const started24h = roots.filter(({ session }) => {
      const started = Date.parse(session.startedAt);
      return Number.isFinite(started) && now - started <= day;
    }).length;
    const active7d = roots.filter(
      ({ session }) => now - session.mtimeMs <= 7 * day,
    );
    const activeCwds = new Set(
      active7d.map(({ session }) => session.cwd).filter(Boolean),
    ).size;
    const hostCounts = new Map<string, number>();
    active7d.forEach(({ host }) =>
      hostCounts.set(host, (hostCounts.get(host) || 0) + 1),
    );
    const busiest =
      Array.from(hostCounts.entries()).sort((a, b) => b[1] - a[1])[0] || null;
    return {
      started24h,
      active7d: active7d.length,
      activeCwds,
      dailyAverage: (active7d.length / 7).toFixed(1),
      busiestHost: busiest?.[0] || "—",
      busiestCount: busiest?.[1] || 0,
    };
  }, [snapshot.hosts, snapshot.generatedAt]);
  const inactiveAgents = useMemo(
    () => excludeActiveSessions(historyState.sessions, allAgents) as Agent[],
    [allAgents, historyState.sessions],
  );
  const projects = projectList(
    snapshot.management.projects || [],
    [...allAgents, ...inactiveAgents].filter((agent) => {
      const record =
        snapshot.management.sessions[managementKey(agent)]?.archive;
      return record
        ? !["archived", "restoring"].includes(record.phase)
        : !agent.rollout?.archived;
    }),
  ).map((project) => ({
    ...project,
    sessions: (project.sessions as Agent[]).map((agent) => ({
      id: agent.id,
      sessionId: agent.rollout?.id || "",
      title:
        resolvedSummary(agent, snapshot.management).theme ||
        agent.title ||
        pathName(agent.cwd),
      status: agent.status,
      category: resolvedSummary(agent, snapshot.management).category || "other",
      historical: Boolean(agent.historical),
      lastActivityAt: agent.lastActivityAt || agent.rollout?.mtimeMs || agent.pane?.activityAt || null,
      externalTerminal: !agent.historical && !agent.appServerManaged && !agent.pane && agent.pid > 0,
      reserved: Boolean(snapshot.management.sessions[managementKey(agent)]?.reserved),
    })),
  })) as ProjectEntry[];
  const selectedProjectKey =
    hostFilter !== "all" && cwdFilter !== "all"
      ? projectIdentity(hostFilter, cwdFilter)?.key || null
      : null;
  const selectedProject = projects.find(
    (project) => project.key === selectedProjectKey,
  );
  const sourceAgents = viewMode === "history" ? inactiveAgents : allAgents;
  const cwdOptions = useMemo(
    () =>
      collectCwdOptions([...allAgents, ...historyState.sessions], hostFilter),
    [allAgents, historyState.sessions, hostFilter],
  );
  const sortedMatchingAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sourceAgents
      .filter((agent) => hostFilter === "all" || agent.host === hostFilter)
      .filter(
        (agent) =>
          gpuFilter === "all" ||
          Boolean(agent.rollout?.id && gpuSessionIds.has(agent.rollout.id)),
      )
      .filter(
        (agent) =>
          cwdFilter === "all" ||
          projectIdentity(agent.host, agent.cwd)?.key ===
            projectIdentity(agent.host, cwdFilter)?.key,
      )
      .filter(
        (agent) => statusFilter === "all" || agent.status === statusFilter,
      )
      .filter(
        (agent) =>
          categoryFilter === "all" ||
          resolvedSummary(agent, snapshot.management).category ===
            categoryFilter,
      )
      .filter((agent) => {
        if (!normalized) return true;
        const summary = resolvedSummary(agent, snapshot.management);
        return [
          agent.host,
          agent.hostname,
          agent.cwd,
          agent.title,
          agent.rollout?.lastAction,
          agent.pane?.session,
          summary.theme,
          summary.objective,
          summary.progress,
          summary.result,
          ...(agent.relatedPanes || []).flatMap((pane) => [
            pane.session,
            pane.command,
            pane.cwd,
          ]),
          ...(agent.localWorkloads || []).flatMap((workload) => [
            workload.cmdline,
            workload.cwd,
            String(workload.pid),
          ]),
          ...(agent.remoteJobs || []).flatMap((job) => [
            job.name,
            job.jobId,
            job.status,
          ]),
        ].some((value) => value?.toLowerCase().includes(normalized));
      })
      .sort((a, b) => {
        if (viewMode === "history") {
          const difference = (b.lastActivityAt || 0) - (a.lastActivityAt || 0);
          return historyOrder === "recent" ? difference : -difference;
        }
        const aPriority =
          managementRecord(a, snapshot.management).priority || "P2";
        const bPriority =
          managementRecord(b, snapshot.management).priority || "P2";
        if (priorityRank[aPriority] !== priorityRank[bPriority]) {
          return priorityRank[aPriority] - priorityRank[bPriority];
        }
        const priority = { attention: 0, working: 1, idle: 2 };
        if (priority[a.status] !== priority[b.status]) {
          return priority[a.status] - priority[b.status];
        }
        return (b.lastActivityAt || 0) - (a.lastActivityAt || 0);
      });
  }, [
    categoryFilter,
    cwdFilter,
    gpuFilter,
    gpuSessionIds,
    historyOrder,
    hostFilter,
    query,
    snapshot.management,
    sourceAgents,
    statusFilter,
    viewMode,
  ]);
  const activeAgentOrderScope = useMemo(
    () =>
      JSON.stringify([
        viewMode,
        hostFilter,
        cwdFilter,
        gpuFilter,
        statusFilter,
        categoryFilter,
        query.trim().toLowerCase(),
        agentOrderRevision,
      ]),
    [
      agentOrderRevision,
      categoryFilter,
      cwdFilter,
      gpuFilter,
      hostFilter,
      query,
      statusFilter,
      viewMode,
    ],
  );
  const stableAgentOrder = useMemo(() => {
    if (viewMode !== "agents") {
      return {
        items: sortedMatchingAgents,
        keys: sortedMatchingAgents.map(managementKey),
      };
    }
    return retainStableOrder(
      sortedMatchingAgents,
      activeAgentOrder.scope === activeAgentOrderScope
        ? activeAgentOrder.keys
        : [],
      managementKey,
    );
  }, [activeAgentOrder, activeAgentOrderScope, sortedMatchingAgents, viewMode]);
  const filteredAgents = stableAgentOrder.items;
  return {
    allAgents,
    operatorName,
    gpuUsage,
    gpuOptions,
    selectedGpu,
    selectedGpuHost,
    selectedGpuIndex,
    gpuWindowMs,
    gpuActivityEpisodes,
    gpuSessionIds,
    gpuEpisodesBySession,
    snapshotSubmissionTracker,
    submissionTracker,
    submissionHostFailures,
    submissionWindowLabel,
    submissionCounts,
    auditedDlcCalls,
    dlcCallCounts,
    allExperiments,
    usageFrequency,
    inactiveAgents,
    projects,
    selectedProjectKey,
    selectedProject,
    sourceAgents,
    cwdOptions,
    sortedMatchingAgents,
    activeAgentOrderScope,
    stableAgentOrder,
    filteredAgents,
  };
}
