import type { Agent, PendingHumanRequest } from "@/features/workspace/types";
import type { Dispatch, SetStateAction } from "react";

export function focusHumanRequest(
  {
    allAgents,
    setViewMode,
    setHostFilter,
    setCwdFilter,
    setStatusFilter,
    setCategoryFilter,
    setQuery,
    selectAgentAndReveal,
  }: {
    allAgents: Agent[];
    setViewMode: Dispatch<SetStateAction<"agents" | "history" | "experiments">>;
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
    selectAgentAndReveal: (agentId: string) => void;
  },
  input: PendingHumanRequest,
) {
  const agent = allAgents.find(
    (candidate) =>
      candidate.host === input.host && candidate.rollout?.id === input.threadId,
  );
  setViewMode("agents");
  setHostFilter(input.host);
  setCwdFilter("all");
  setStatusFilter("all");
  setCategoryFilter("all");
  setQuery("");
  if (agent) selectAgentAndReveal(agent.id);
}

export async function respondToHumanRequest(
  {
    setBusyAction,
    setActionNotice,
    postJson,
  }: {
    setBusyAction: Dispatch<SetStateAction<string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
  },
  input: PendingHumanRequest,
  response: unknown,
  successText = "处理结果已按原始 request ID 回传，Codex 将继续当前 Turn。",
) {
  const action = `human-response:${input.key}`;
  setBusyAction(action);
  setActionNotice(null);
  try {
    await postJson("/api/app-server/respond", {
      key: input.key,
      response,
    });
    setActionNotice({ kind: "success", text: successText });
    return true;
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
    return false;
  } finally {
    setBusyAction("");
  }
}

export async function answerPlanInput(
  {
    planInputDrafts,
    setActionNotice,
    respondToHumanRequest,
    setPlanInputDrafts,
  }: {
    planInputDrafts: Record<string, Record<string, string>>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    respondToHumanRequest: (
      input: PendingHumanRequest,
      response: unknown,
      successText?: string,
    ) => Promise<boolean>;
    setPlanInputDrafts: Dispatch<
      SetStateAction<Record<string, Record<string, string>>>
    >;
  },
  input: PendingHumanRequest,
) {
  if (!input.questions) return;
  const draft = planInputDrafts[input.key] || {};
  const answers: Record<string, { answers: string[] }> = {};
  for (const question of input.questions) {
    const value = draft[question.id]?.trim();
    if (!value) {
      setActionNotice({
        kind: "error",
        text: `请先回答“${question.header}”。`,
      });
      return;
    }
    answers[question.id] = { answers: [value] };
  }

  const answered = await respondToHumanRequest(
    input,
    { answers },
    "答案已按原始 request ID 回传，Codex 将继续当前 Plan Turn。",
  );
  if (answered) {
    setPlanInputDrafts((current) => {
      const next = { ...current };
      delete next[input.key];
      return next;
    });
  }
}

export async function answerElicitation(
  {
    elicitationDrafts,
    respondToHumanRequest,
    setElicitationDrafts,
  }: {
    elicitationDrafts: Record<
      string,
      Record<string, string | boolean | string[]>
    >;
    respondToHumanRequest: (
      input: PendingHumanRequest,
      response: unknown,
      successText?: string,
    ) => Promise<boolean>;
    setElicitationDrafts: Dispatch<
      SetStateAction<
        Record<string, Record<string, string | boolean | string[]>>
      >
    >;
  },
  input: PendingHumanRequest,
  action: "accept" | "decline" | "cancel",
) {
  const content: Record<string, string | boolean | string[]> = {};
  if (
    action === "accept" &&
    ["form", "openai/form"].includes(input.mode || "")
  ) {
    for (const field of input.fields || []) {
      const value =
        elicitationDrafts[input.key]?.[field.name] ??
        (field.default as string | boolean | string[] | null);
      if (value !== null && value !== undefined && value !== "") {
        content[field.name] = value;
      }
    }
  }
  const answered = await respondToHumanRequest(input, {
    action,
    content: action === "accept" ? content : null,
    _meta: null,
  });
  if (answered) {
    setElicitationDrafts((current) => {
      const next = { ...current };
      delete next[input.key];
      return next;
    });
  }
}
