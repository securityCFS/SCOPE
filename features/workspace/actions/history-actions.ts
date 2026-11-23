import type {
  Agent,
  HistoryResult,
  ResearchAssistantCandidate,
  ResearchAssistantMessage,
} from "@/features/workspace/types";
import type { Dispatch, SetStateAction } from "react";

export async function askResearchAssistant({
  researchAssistantDraft,
  researchAssistantBusy,
  setResearchAssistantMessages,
  setResearchAssistantDraft,
  setResearchAssistantBusy,
  postJson,
}: {
  researchAssistantDraft: string;
  researchAssistantBusy: boolean;
  setResearchAssistantMessages: Dispatch<
    SetStateAction<ResearchAssistantMessage[]>
  >;
  setResearchAssistantDraft: Dispatch<SetStateAction<string>>;
  setResearchAssistantBusy: Dispatch<SetStateAction<boolean>>;
  postJson: <T>(
    path: string,
    body: unknown,
  ) => Promise<T & { error?: string | undefined }>;
}) {
  const question = researchAssistantDraft.trim();
  if (!question || researchAssistantBusy) return;
  const userMessage: ResearchAssistantMessage = {
    id: `user:${Date.now()}`,
    role: "user",
    text: question,
  };
  setResearchAssistantMessages((current) => [...current, userMessage]);
  setResearchAssistantDraft("");
  setResearchAssistantBusy(true);
  try {
    const result = await postJson<{
      answer: string;
      candidates: ResearchAssistantCandidate[];
      model: "codex" | "retrieval-only";
      warning: string | null;
      scans?: ResearchAssistantMessage["scans"];
    }>("/api/assistant/query", { question });
    setResearchAssistantMessages((current) => [
      ...current,
      {
        id: `assistant:${Date.now()}`,
        role: "assistant",
        text: result.answer,
        candidates: result.candidates,
        model: result.model,
        warning: result.warning,
        scans: result.scans,
      },
    ]);
  } catch (error) {
    setResearchAssistantMessages((current) => [
      ...current,
      {
        id: `assistant:error:${Date.now()}`,
        role: "assistant",
        text: (error as Error).message,
      },
    ]);
  } finally {
    setResearchAssistantBusy(false);
  }
}

export function openResearchAssistantCandidate(
  {
    setHostFilter,
    setCwdFilter,
    setStatusFilter,
    setCategoryFilter,
    setQuery,
    allAgents,
    setViewMode,
    selectAgentAndReveal,
    setResearchAssistantOpen,
    setActionNotice,
    setHistoryState,
    setSelectedAgentId,
  }: {
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
    setQuery: Dispatch<SetStateAction<string>>;
    allAgents: Agent[];
    setViewMode: Dispatch<SetStateAction<"agents" | "history" | "experiments">>;
    selectAgentAndReveal: (agentId: string) => void;
    setResearchAssistantOpen: Dispatch<SetStateAction<boolean>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    setHistoryState: Dispatch<
      SetStateAction<{
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
      }>
    >;
    setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
  },
  candidate: ResearchAssistantCandidate,
) {
  setHostFilter(candidate.host);
  setCwdFilter("all");
  setStatusFilter("all");
  setCategoryFilter("all");
  setQuery("");
  const activeAgent = allAgents.find(
    (agent) =>
      agent.host === candidate.host &&
      agent.rollout?.id === candidate.sessionId,
  );
  if (activeAgent) {
    setViewMode("agents");
    selectAgentAndReveal(activeAgent.id);
    setResearchAssistantOpen(false);
    setActionNotice({
      kind: "success",
      text: `已打开检索命中的活动 Session：${candidate.theme}`,
    });
    return;
  }
  if (candidate.agent) {
    setHistoryState((current) => ({
      ...current,
      sessions: [
        candidate.agent as Agent,
        ...current.sessions.filter(
          (agent) =>
            !(
              agent.host === candidate.host &&
              agent.rollout?.id === candidate.agent?.rollout?.id
            ),
        ),
      ],
      scope: "assistant",
      loading: false,
      error: "",
    }));
    setViewMode("history");
    setSelectedAgentId(candidate.agent.id);
    setResearchAssistantOpen(false);
    setActionNotice({
      kind: "success",
      text: `已打开检索命中的历史 Session：${candidate.theme}`,
    });
    return;
  }
  setViewMode("history");
  setQuery(candidate.sessionId);
  setResearchAssistantOpen(false);
  setActionNotice({
    kind: "success",
    text: "已切到 History 并填入 Session ID；扫描历史后可查看完整对话。",
  });
}

export async function loadHistoryCache(
  {
    historyOrder,
    hostFilter,
    historyLimit,
    getJson,
    sortedHistorySessions,
    setHistoryState,
  }: {
    historyOrder: "recent" | "oldest";
    hostFilter: string;
    historyLimit: number;
    getJson: <T>(path: string) => Promise<T & { error?: string | undefined }>;
    sortedHistorySessions: (
      sessions: Agent[],
      requestedOrder: "recent" | "oldest",
    ) => Agent[];
    setHistoryState: Dispatch<
      SetStateAction<{
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
      }>
    >;
    setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
  },
  orderOverride?: "recent" | "oldest",
  hostOverride?: string,
  limitOverride?: number,
) {
  const requestedOrder = orderOverride || historyOrder;
  const requestedHost = hostOverride || hostFilter;
  const requestedLimit = limitOverride || historyLimit;
  try {
    const result = await getJson<HistoryResult>(
      `/api/history/cache?host=${encodeURIComponent(requestedHost)}&limit=${requestedLimit}&order=${requestedOrder}`,
    );
    const sessions = sortedHistorySessions(result.sessions, requestedOrder);
    setHistoryState({
      sessions,
      scannedAt: result.scannedAt,
      scope: result.scope,
      hosts: result.hosts,
      loading: false,
      error: "",
    });
    // Loading the sidebar history must not replace the currently open chat.
    return result.cached ? result : null;
  } catch {
    return null;
  }
}

export async function scanHistory(
  {
    historyOrder,
    setHistoryState,
    setActionNotice,
    loadHistoryCache,
    postJson,
    hostFilter,
    historyLimit,
    sortedHistorySessions,
    setSelectedAgentId,
  }: {
    historyOrder: "recent" | "oldest";
    setHistoryState: Dispatch<
      SetStateAction<{
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
      }>
    >;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    loadHistoryCache: (
      orderOverride?: "recent" | "oldest" | undefined,
      hostOverride?: string | undefined,
      limitOverride?: number | undefined,
    ) => Promise<(HistoryResult & { error?: string | undefined }) | null>;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    hostFilter: string;
    historyLimit: number;
    sortedHistorySessions: (
      sessions: Agent[],
      requestedOrder: "recent" | "oldest",
    ) => Agent[];
    setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
  },
  orderOverride?: "recent" | "oldest",
) {
  const requestedOrder = orderOverride || historyOrder;
  setHistoryState((current) => ({
    ...current,
    loading: true,
    error: "",
  }));
  setActionNotice(null);
  const cached = await loadHistoryCache(requestedOrder);
  setHistoryState((current) => ({ ...current, loading: true }));
  if (cached) {
    setActionNotice({
      kind: "success",
      text: `已立即显示 ${cached.sessions.length} 条本地缓存，正在后台刷新。`,
    });
  }
  try {
    const result = await postJson<HistoryResult>("/api/history/scan", {
      host: hostFilter,
      limit: historyLimit,
      order: requestedOrder,
    });
    const sessions = sortedHistorySessions(result.sessions, requestedOrder);
    setHistoryState({
      sessions,
      scannedAt: result.scannedAt,
      scope: result.scope,
      hosts: result.hosts,
      loading: false,
      error: "",
    });
    setSelectedAgentId(sessions[0]?.id || null);
    setActionNotice({
      kind: "success",
      text: `历史扫描完成：找到 ${result.sessions.length} 条已结束 Session。`,
    });
  } catch (error) {
    setHistoryState((current) => ({
      ...current,
      loading: false,
      error: (error as Error).message,
    }));
    setActionNotice({ kind: "error", text: (error as Error).message });
  }
}
