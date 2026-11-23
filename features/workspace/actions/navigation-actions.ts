import { type SshTerminalTarget } from "@/app/components/ssh-terminal";
import {
  type ProjectEntry,
  type ProjectSession,
} from "@/components/project-sidebar";
import { gpuKey, parseGpuKey } from "@/features/workspace/shared";
import type {
  Agent,
  DlcCall,
  GpuUsageEpisode,
  HistoryResult,
  ManagementState,
  ModelOption,
  Snapshot,
  SubmissionItem,
} from "@/features/workspace/types";
import type {
  Dispatch,
  FormEvent as ReactFormEvent,
  SetStateAction,
} from "react";
import type { Experiment } from "../types";

export function reloadModelsForHost(
  {
    setModelsByHost,
    setModelRefresh,
  }: {
    setModelsByHost: Dispatch<SetStateAction<Record<string, ModelOption[]>>>;
    setModelRefresh: Dispatch<SetStateAction<number>>;
  },
  host: string,
) {
  if (!host) return;
  setModelsByHost((current) => {
    const next = { ...current };
    for (const key of Object.keys(next)) {
      if (key === host || key.startsWith(`${host}::`)) delete next[key];
    }
    return next;
  });
  setModelRefresh((current) => current + 1);
}

export async function refreshSubmissions(
  {
    submissionWindowDays,
    setSubmissionTrackerOpen,
    setActionNotice,
    postJson,
  }: {
    submissionWindowDays: number;
    setSubmissionTrackerOpen: Dispatch<SetStateAction<boolean>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
  },
  days = submissionWindowDays,
) {
  setSubmissionTrackerOpen(true);
  setActionNotice(null);
  try {
    await postJson("/api/submissions/scan", { limit: 120, days });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  }
}

export function selectAgentAndReveal(
  {
    setSelectedAgentId,
  }: {
    setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
  },
  agentId: string,
) {
  setSelectedAgentId(agentId);
  if (window.innerWidth <= 720) {
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(".inspector")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }
}

export function chooseHost(
  {
    setConversationFocus,
    setHostFilter,
    setCwdFilter,
    viewMode,
    loadHistoryCache,
    selectedGpu,
    setGpuFilter,
    setMobileHostsOpen,
  }: {
    setConversationFocus: Dispatch<SetStateAction<boolean>>;
    setHostFilter: Dispatch<SetStateAction<string>>;
    setCwdFilter: Dispatch<SetStateAction<string>>;
    viewMode: "agents" | "history" | "experiments";
    loadHistoryCache: (
      orderOverride?: "recent" | "oldest" | undefined,
      hostOverride?: string | undefined,
      limitOverride?: number | undefined,
    ) => Promise<(HistoryResult & { error?: string | undefined }) | null>;
    selectedGpu: { host: string; index: number } | null;
    setGpuFilter: Dispatch<SetStateAction<string>>;
    setMobileHostsOpen: Dispatch<SetStateAction<boolean>>;
  },
  host: string,
) {
  setConversationFocus(false);
  setHostFilter(host);
  setCwdFilter("all");
  if (viewMode === "history") {
    void loadHistoryCache(undefined, host);
  }
  if (selectedGpu && (host === "all" || selectedGpu.host !== host)) {
    setGpuFilter("all");
  }
  setMobileHostsOpen(false);
}

export function chooseProject(
  {
    setConversationFocus,
    setHostFilter,
    setCwdFilter,
    setGpuFilter,
    setStatusFilter,
    setCategoryFilter,
    setQuery,
    setViewMode,
    setMobileHostsOpen,
  }: {
    setConversationFocus: Dispatch<SetStateAction<boolean>>;
    setHostFilter: Dispatch<SetStateAction<string>>;
    setCwdFilter: Dispatch<SetStateAction<string>>;
    setGpuFilter: Dispatch<SetStateAction<string>>;
    setStatusFilter: Dispatch<
      SetStateAction<"all" | "working" | "idle" | "attention">
    >;
    setCategoryFilter: Dispatch<
      SetStateAction<
        "all" | "research" | "training" | "evaluation" | "engineering" | "other"
      >
    >;
    setQuery: Dispatch<SetStateAction<string>>;
    setViewMode: Dispatch<SetStateAction<"agents" | "history" | "experiments">>;
    setMobileHostsOpen: Dispatch<SetStateAction<boolean>>;
  },
  project: ProjectEntry,
  mode: "agents" | "history" = "agents",
) {
  setConversationFocus(false);
  setHostFilter(project.host);
  setCwdFilter(project.cwd);
  setGpuFilter("all");
  setStatusFilter("all");
  setCategoryFilter("all");
  setQuery("");
  setViewMode(mode);
  setMobileHostsOpen(false);
}

export async function toggleProjectPin(
  {
    setProjectBusyKey,
    postJson,
    setSnapshot,
    setActionNotice,
  }: {
    setProjectBusyKey: Dispatch<SetStateAction<string>>;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    setSnapshot: Dispatch<SetStateAction<Snapshot>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
  },
  project: ProjectEntry,
) {
  setProjectBusyKey(project.key);
  try {
    const result = await postJson<{
      projects: NonNullable<ManagementState["projects"]>;
    }>("/api/projects", {
      host: project.host,
      cwd: project.cwd,
      action: project.pinned ? "unpin" : "pin",
    });
    setSnapshot((current) => ({
      ...current,
      management: { ...current.management, projects: result.projects },
    }));
  } catch (error) {
    setActionNotice({
      kind: "error",
      text: `保存项目失败：${(error as Error).message}`,
    });
  } finally {
    setProjectBusyKey("");
  }
}

export function selectProjectSession(
  {
    chooseProject,
    selectAgentAndReveal,
    setConversationFocus,
  }: {
    chooseProject: (project: ProjectEntry, mode?: "agents" | "history") => void;
    selectAgentAndReveal: (agentId: string) => void;
    setConversationFocus: Dispatch<SetStateAction<boolean>>;
  },
  project: ProjectEntry,
  session: ProjectSession,
) {
  chooseProject(project, session.historical ? "history" : "agents");
  selectAgentAndReveal(session.id);
  setConversationFocus(true);
}

export function chooseGpu(
  {
    setGpuFilter,
    setCwdFilter,
    setHostFilter,
  }: {
    setGpuFilter: Dispatch<SetStateAction<string>>;
    setCwdFilter: Dispatch<SetStateAction<string>>;
    setHostFilter: Dispatch<SetStateAction<string>>;
  },
  value: string,
) {
  setGpuFilter(value);
  setCwdFilter("all");
  const gpu = value === "all" ? null : parseGpuKey(value);
  if (gpu) setHostFilter(gpu.host);
}

export function openGpuEpisode(
  {
    setHostFilter,
    setCwdFilter,
    setGpuFilter,
    allAgents,
    setViewMode,
    selectAgentAndReveal,
    historyState,
    setQuery,
    setActionNotice,
    allExperiments,
    setSelectedExperimentId,
  }: {
    setHostFilter: Dispatch<SetStateAction<string>>;
    setCwdFilter: Dispatch<SetStateAction<string>>;
    setGpuFilter: Dispatch<SetStateAction<string>>;
    allAgents: Agent[];
    setViewMode: Dispatch<SetStateAction<"agents" | "history" | "experiments">>;
    selectAgentAndReveal: (agentId: string) => void;
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
    setQuery: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    allExperiments: Experiment[];
    setSelectedExperimentId: Dispatch<SetStateAction<string | null>>;
  },
  episode: GpuUsageEpisode,
) {
  setHostFilter(episode.host);
  setCwdFilter("all");
  setGpuFilter(gpuKey(episode.host, episode.gpuIndex));
  if (episode.ownerSessionId) {
    const activeAgent = allAgents.find(
      (agent) =>
        agent.host === episode.host &&
        agent.rollout?.id === episode.ownerSessionId,
    );
    if (activeAgent) {
      setViewMode("agents");
      selectAgentAndReveal(activeAgent.id);
      return;
    }
    const historical = historyState.sessions.find(
      (agent) =>
        agent.host === episode.host &&
        agent.rollout?.id === episode.ownerSessionId,
    );
    if (historical) {
      setViewMode("history");
      selectAgentAndReveal(historical.id);
      return;
    }
    setViewMode("history");
    setQuery(episode.ownerSessionId);
    setActionNotice({
      kind: "success",
      text: "该 GPU 记录属于已结束 Session；已填入 ID，扫描历史后可打开完整记录。",
    });
    return;
  }
  if (episode.paneSession) {
    const experiment = allExperiments.find(
      (candidate) =>
        candidate.host === episode.host &&
        candidate.session === episode.paneSession &&
        (!episode.pane || candidate.pane === episode.pane),
    );
    if (experiment) {
      setViewMode("experiments");
      setSelectedExperimentId(experiment.id);
      return;
    }
  }
  setQuery(String(episode.pid));
  setActionNotice({
    kind: "error",
    text: `GPU 进程 PID ${episode.pid} 暂未可靠归属到 Codex Session。`,
  });
}

export function locateSubmission(
  {
    allAgents,
    setHostFilter,
    setCwdFilter,
    setStatusFilter,
    setCategoryFilter,
    setSubmissionTrackerOpen,
    setViewMode,
    setQuery,
    selectAgentAndReveal,
    setActionNotice,
  }: {
    allAgents: Agent[];
    setHostFilter: Dispatch<SetStateAction<string>>;
    setCwdFilter: Dispatch<SetStateAction<string>>;
    setStatusFilter: Dispatch<
      SetStateAction<"all" | "working" | "idle" | "attention">
    >;
    setCategoryFilter: Dispatch<
      SetStateAction<
        "all" | "research" | "training" | "evaluation" | "engineering" | "other"
      >
    >;
    setSubmissionTrackerOpen: Dispatch<SetStateAction<boolean>>;
    setViewMode: Dispatch<SetStateAction<"agents" | "history" | "experiments">>;
    setQuery: Dispatch<SetStateAction<string>>;
    selectAgentAndReveal: (agentId: string) => void;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
  },
  item: Pick<
    SubmissionItem | DlcCall,
    "host" | "sessionId" | "sessionTheme" | "cwd" | "active"
  > & { parentThreadId?: string },
) {
  const activeAgent = allAgents.find(
    (agent) =>
      agent.host === item.host &&
      (agent.rollout?.id === item.sessionId ||
        agent.rollout?.id === item.parentThreadId),
  );
  setHostFilter(item.host);
  setCwdFilter("all");
  setStatusFilter("all");
  setCategoryFilter("all");
  setSubmissionTrackerOpen(false);

  if (activeAgent) {
    setViewMode("agents");
    setQuery("");
    selectAgentAndReveal(activeAgent.id);
    setActionNotice({
      kind: "success",
      text: `已定位 DLC 调用对应的活动 Session：${item.sessionTheme}`,
    });
    return;
  }

  setViewMode("history");
  setQuery(item.sessionId);
  setActionNotice({
    kind: "success",
    text: `已切到 ${item.host} 的历史视图并填入 Session ID；点击“扫描历史”即可加载完整对话。`,
  });
}

export function openWebTerminal({
  selectedAgent,
  hostFilter,
  snapshot,
  setActionNotice,
  setSshTerminalTarget,
}: {
  selectedAgent: Agent | null;
  hostFilter: string;
  snapshot: Snapshot;
  setActionNotice: Dispatch<
    SetStateAction<{ kind: "success" | "error"; text: string } | null>
  >;
  setSshTerminalTarget: Dispatch<SetStateAction<SshTerminalTarget | null>>;
}) {
  const preferredHost =
    selectedAgent?.host ||
    (hostFilter !== "all" ? hostFilter : "") ||
    snapshot.hosts.find((host) => host.reachable)?.alias ||
    "";
  if (!preferredHost) {
    setActionNotice({ kind: "error", text: "当前没有可连接的 SSH 主机。" });
    return;
  }
  setSshTerminalTarget({
    host: preferredHost,
    cwd: selectedAgent?.cwd || selectedAgent?.rollout?.cwd || "",
    tmuxSession: selectedAgent?.pane?.session || "",
  });
}

export async function saveOperatorName(
  {
    operatorNameDraft,
    setBusyAction,
    postJson,
    setOperatorEditorOpen,
    setActionNotice,
  }: {
    operatorNameDraft: string;
    setBusyAction: Dispatch<SetStateAction<string>>;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    setOperatorEditorOpen: Dispatch<SetStateAction<boolean>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
  },
  event: ReactFormEvent<HTMLFormElement>,
) {
  event.preventDefault();
  const requestedName = operatorNameDraft.trim();
  if (!requestedName) return;
  setBusyAction("operator-name");
  try {
    await postJson<{ operatorName: string }>("/api/operator", {
      name: requestedName,
    });
    setOperatorEditorOpen(false);
    setActionNotice({ kind: "success", text: "显示名称已保存。" });
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}
