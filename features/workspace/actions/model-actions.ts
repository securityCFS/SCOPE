import {
  MIN_INSPECTOR_WIDTH,
  clampInspectorWidth,
  managementKey,
  rolloutUsesYolo,
  sessionModelCatalogKey,
} from "@/features/workspace/shared";
import type { Agent, ModelOption, Snapshot } from "@/features/workspace/types";
import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  SetStateAction,
} from "react";
export function toggleUiTheme({
  setUiTheme,
}: {
  setUiTheme: Dispatch<SetStateAction<"dark" | "light">>;
}) {
  setUiTheme((current) => {
    const next = current === "dark" ? "light" : "dark";
    window.localStorage.setItem("scope:ui-theme", next);
    return next;
  });
}

export function toggleHostSidebar({
  setHostSidebarCollapsed,
}: {
  setHostSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
}) {
  setHostSidebarCollapsed((current) => {
    const next = !current;
    window.localStorage.setItem(
      "scope:host-sidebar-collapsed",
      next ? "1" : "0",
    );
    return next;
  });
}

export async function changeHostModel(
  {
    hostModelDrafts,
    setBusyAction,
    postJson,
    setHostModelResults,
    setActionNotice,
    setModelDrafts,
    snapshot,
    refresh,
  }: {
    hostModelDrafts: Record<string, string>;
    setBusyAction: Dispatch<SetStateAction<string>>;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    setHostModelResults: Dispatch<
      SetStateAction<
        Record<
          string,
          {
            sessionId: string;
            status: string;
            reason?: string | undefined;
            error?: string | undefined;
          }[]
        >
      >
    >;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    setModelDrafts: Dispatch<SetStateAction<Record<string, string>>>;
    snapshot: Snapshot;
    refresh: () => Promise<void>;
  },
  host: string,
) {
  const model = hostModelDrafts[host];
  if (!model) return;
  setBusyAction(`host-model:${host}`);
  try {
    const result = await postJson<{
      results: {
        sessionId: string;
        status: string;
        reason?: string;
        error?: string;
      }[];
    }>("/api/host/model", { host, model });
    setHostModelResults((current) => ({ ...current, [host]: result.results }));
    const failed = result.results.filter(
      (item) => item.status === "failed",
    ).length;
    setActionNotice({
      kind: failed ? "error" : "success",
      text: `${host}：已应用 ${result.results.filter((item) => item.status === "applied").length}，下一轮生效 ${result.results.filter((item) => item.status === "next-turn").length}，跳过 ${result.results.filter((item) => item.status === "skipped").length}，失败 ${failed}。`,
    });
    setModelDrafts((current) => {
      const next = { ...current };
      for (const agent of snapshot.hosts.find(
        (candidate) => candidate.alias === host,
      )?.agents || []) {
        if (
          result.results.some(
            (item) =>
              item.sessionId === agent.rollout?.id &&
              ["applied", "next-turn"].includes(item.status),
          )
        ) {
          next[managementKey(agent)] = model;
        }
      }
      return next;
    });
    refresh();
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
  } finally {
    setBusyAction("");
  }
}

export function inspectorWidthBounds({
  monitorColumnsRef,
  hostSidebarCollapsed,
}: {
  monitorColumnsRef: RefObject<HTMLDivElement | null>;
  hostSidebarCollapsed: boolean;
}) {
  const containerWidth =
    monitorColumnsRef.current?.clientWidth || window.innerWidth;
  return {
    minimum: MIN_INSPECTOR_WIDTH,
    maximum: clampInspectorWidth(
      Number.MAX_SAFE_INTEGER,
      containerWidth,
      window.innerWidth,
      hostSidebarCollapsed,
    ),
  };
}

export function resizeWithKeyboard(
  {
    inspectorWidthBounds,
    inspectorWidth,
    updateInspectorWidth,
  }: {
    inspectorWidthBounds: () => { minimum: number; maximum: number };
    inspectorWidth: number;
    updateInspectorWidth: (requestedWidth: number) => void;
  },
  event: ReactKeyboardEvent<HTMLButtonElement>,
) {
  const { minimum, maximum } = inspectorWidthBounds();
  const keyboardWidths: Record<string, number> = {
    ArrowLeft: inspectorWidth + 24,
    ArrowRight: inspectorWidth - 24,
    Home: minimum,
    End: maximum,
  };
  const nextWidth = keyboardWidths[event.key];
  if (nextWidth === undefined) return;
  event.preventDefault();
  updateInspectorWidth(nextWidth);
}

export async function changeSessionModel(
  {
    modelDrafts,
    snapshot,
    modelsByHost,
    effortDrafts,
    yoloDrafts,
    setBusyAction,
    postJson,
    setActionNotice,
    refresh,
  }: {
    modelDrafts: Record<string, string>;
    snapshot: Snapshot;
    modelsByHost: Record<string, ModelOption[]>;
    effortDrafts: Record<string, string>;
    yoloDrafts: Record<string, boolean>;
    setBusyAction: Dispatch<SetStateAction<string>>;
    postJson: <T>(
      path: string,
      body: unknown,
    ) => Promise<T & { error?: string | undefined }>;
    setActionNotice: Dispatch<
      SetStateAction<{ kind: "success" | "error"; text: string } | null>
    >;
    refresh: () => Promise<void>;
  },
  agent: Agent,
  selection?: { model: string; effort: string; yolo: boolean },
) {
  if (!agent.rollout && !agent.pane) return;
  const key = managementKey(agent);
  const model = selection?.model || modelDrafts[key] || agent.rollout?.model || "";
  const catalogConnectionKey = snapshot.appServer?.sessions.find(
    (session) =>
      session.host === agent.host && session.sessionId === agent.rollout?.id,
  )?.connectionKey;
  const selectedModel = modelsByHost[
    agent.rollout ? sessionModelCatalogKey(agent.host, agent.rollout.id, catalogConnectionKey) : agent.host
  ]?.find((candidate) => candidate.id === model);
  const effort =
    selection?.effort ??
    (effortDrafts[key] ||
      (selectedModel?.supportedReasoningEfforts.includes(
        agent.rollout?.reasoningEffort || "",
      )
        ? agent.rollout?.reasoningEffort || ""
        : selectedModel?.defaultReasoningEffort ||
          selectedModel?.supportedReasoningEfforts[0] ||
          ""));
  if (!model) return;
  const appServerSession = snapshot.appServer?.sessions.find(
    (session) =>
      session.host === agent.host &&
      session.sessionId === agent.rollout?.id &&
      session.status !== "offline",
  );
  const yolo =
    selection?.yolo ??
    yoloDrafts[key] ??
    appServerSession?.yolo ??
    rolloutUsesYolo(agent, snapshot.management);
  setBusyAction(`model:${key}`);
  try {
    const result = await postJson<{
      transport: "app-server" | "tmux";
      model: string;
      deferred?: boolean;
      yolo?: boolean;
      target?: string;
    }>("/api/session/model", {
      host: agent.host,
      sessionId: agent.rollout?.id,
      agentId: agent.id,
      model,
      effort,
      ...(agent.rollout ? { yolo } : {}),
    });
    setActionNotice({
      kind: "success",
      text:
        result.transport === "app-server"
          ? `该 Session ${result.deferred ? "下一轮将使用" : "已切换到"} ${result.model} · ${effort || "默认强度"} · ${result.yolo === false ? "受控" : "YOLO"}。`
          : `已在 tmux ${result.target} 完成 /model 与 ${effort || "默认"} 推理强度选择，并发送 /status 验证。`,
    });
    window.setTimeout(() => refresh(), 900);
    return true;
  } catch (error) {
    setActionNotice({ kind: "error", text: (error as Error).message });
    return false;
  } finally {
    setBusyAction("");
  }
}
