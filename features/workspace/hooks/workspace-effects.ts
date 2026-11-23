"use client";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import type {
  Agent,
  ModelOption,
  ResearchAssistantMessage,
  Snapshot,
} from "../types";

import {
  DEFAULT_INSPECTOR_WIDTH,
  INSPECTOR_WIDTH_KEY,
  SESSION_RENDER_BATCH,
  bridgeUrl,
  clampInspectorWidth,
} from "@/features/workspace/shared";

export function useWorkspacePreferences({
  setUiTheme,
  setHostSidebarCollapsed,
}: {
  setUiTheme: Dispatch<SetStateAction<"dark" | "light">>;
  setHostSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    const savedTheme = window.localStorage.getItem("scope:ui-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setUiTheme(savedTheme);
    } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      setUiTheme("dark");
    }
    setHostSidebarCollapsed(
      window.localStorage.getItem("scope:host-sidebar-collapsed") === "1",
    );
  }, [setHostSidebarCollapsed, setUiTheme]);
}

export function useResearchScroll({
  researchAssistantOpen,
  researchAssistantMessagesRef,
  researchAssistantBusy,
  researchAssistantMessages,
}: {
  researchAssistantOpen: boolean;
  researchAssistantMessagesRef: RefObject<HTMLDivElement | null>;
  researchAssistantBusy: boolean;
  researchAssistantMessages: ResearchAssistantMessage[];
}) {
  useEffect(() => {
    if (!researchAssistantOpen) return;
    const messages = researchAssistantMessagesRef.current;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }, [
    researchAssistantBusy,
    researchAssistantMessages,
    researchAssistantMessagesRef,
    researchAssistantOpen,
  ]);
}

export function useWorkspaceClock({
  snapshot,
  setClockNow,
}: {
  snapshot: Snapshot;
  setClockNow: Dispatch<SetStateAction<number>>;
}) {
  useEffect(() => {
    if (
      !(snapshot.appServer?.pendingRequests || []).some(
        (input) => input.expiresAt,
      )
    ) {
      return;
    }
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [setClockNow, snapshot.appServer?.pendingRequests]);
}

export function useWorkspaceWidth({
  monitorColumnsRef,
  setInspectorWidth,
  hostSidebarCollapsed,
}: {
  monitorColumnsRef: RefObject<HTMLDivElement | null>;
  setInspectorWidth: Dispatch<SetStateAction<number>>;
  hostSidebarCollapsed: boolean;
}) {
  useEffect(() => {
    const restoreFrame = window.requestAnimationFrame(() => {
      let storedWidth = Number.NaN;
      try {
        storedWidth = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
      } catch {
        // Use the default when browser storage is unavailable.
      }
      const requestedWidth =
        Number.isFinite(storedWidth) && storedWidth > 0
          ? storedWidth
          : DEFAULT_INSPECTOR_WIDTH;
      const containerWidth =
        monitorColumnsRef.current?.clientWidth || window.innerWidth;
      setInspectorWidth(
        clampInspectorWidth(
          requestedWidth,
          containerWidth,
          window.innerWidth,
          hostSidebarCollapsed,
        ),
      );
    });

    function fitInspectorToViewport() {
      const containerWidth =
        monitorColumnsRef.current?.clientWidth || window.innerWidth;
      setInspectorWidth((currentWidth) =>
        clampInspectorWidth(
          currentWidth,
          containerWidth,
          window.innerWidth,
          hostSidebarCollapsed,
        ),
      );
    }

    window.addEventListener("resize", fitInspectorToViewport);
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      window.removeEventListener("resize", fitInspectorToViewport);
    };
  }, [hostSidebarCollapsed, monitorColumnsRef, setInspectorWidth]);
}

export function useSessionOrder({
  viewMode,
  filteredAgents,
  setConversationFocus,
}: {
  viewMode: "agents" | "history" | "experiments";
  filteredAgents: Agent[];
  setConversationFocus: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    if (viewMode === "experiments" || filteredAgents.length === 0)
      setConversationFocus(false);
  }, [viewMode, filteredAgents.length, setConversationFocus]);
}

export function useSessionBatchReset({
  viewMode,
  setActiveAgentOrder,
  activeAgentOrderScope,
  stableAgentOrder,
}: {
  viewMode: "agents" | "history" | "experiments";
  setActiveAgentOrder: Dispatch<
    SetStateAction<{ scope: string; keys: string[] }>
  >;
  activeAgentOrderScope: string;
  stableAgentOrder: { items: Agent[]; keys: string[] };
}) {
  useEffect(() => {
    if (viewMode !== "agents") return;
    setActiveAgentOrder((current) => {
      if (
        current.scope === activeAgentOrderScope &&
        current.keys.length === stableAgentOrder.keys.length &&
        current.keys.every((key, index) => key === stableAgentOrder.keys[index])
      ) {
        return current;
      }
      return { scope: activeAgentOrderScope, keys: stableAgentOrder.keys };
    });
  }, [
    activeAgentOrderScope,
    setActiveAgentOrder,
    stableAgentOrder.keys,
    viewMode,
  ]);
}

export function useSessionBatchProgress({
  setSessionRenderLimit,
  categoryFilter,
  cwdFilter,
  gpuFilter,
  historyOrder,
  hostFilter,
  query,
  statusFilter,
  viewMode,
}: {
  setSessionRenderLimit: Dispatch<SetStateAction<number>>;
  categoryFilter:
    "all" | "research" | "training" | "evaluation" | "engineering" | "other";
  cwdFilter: string;
  gpuFilter: string;
  historyOrder: "recent" | "oldest";
  hostFilter: string;
  query: string;
  statusFilter: "all" | "working" | "idle" | "attention";
  viewMode: "agents" | "history" | "experiments";
}) {
  useEffect(() => {
    setSessionRenderLimit(SESSION_RENDER_BATCH);
  }, [
    categoryFilter,
    cwdFilter,
    gpuFilter,
    historyOrder,
    hostFilter,
    query,
    setSessionRenderLimit,
    statusFilter,
    viewMode,
  ]);
}

export function useSessionSelection({
  viewMode,
  filteredAgents,
  selectedAgentId,
  setSelectedAgentId,
}: {
  viewMode: "agents" | "history" | "experiments";
  filteredAgents: Agent[];
  selectedAgentId: string | null;
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
}) {
  useEffect(() => {
    if (viewMode === "experiments" || !filteredAgents.length) return;
    if (!filteredAgents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(filteredAgents[0].id);
    }
  }, [filteredAgents, selectedAgentId, setSelectedAgentId, viewMode]);
}

export function useModelCatalog({
  modelCatalogHost,
  modelCatalogKey,
  modelCatalogSessionId,
  setModelsByHost,
  setModelErrors,
  modelRefresh,
}: {
  modelCatalogHost: string;
  modelCatalogKey: string;
  modelCatalogSessionId: string;
  setModelsByHost: Dispatch<SetStateAction<Record<string, ModelOption[]>>>;
  setModelErrors: Dispatch<SetStateAction<Record<string, string>>>;
  modelRefresh: number;
}) {
  useEffect(() => {
    if (!modelCatalogHost || !modelCatalogKey) return;
    const host = modelCatalogHost;
    const catalogKey = modelCatalogKey;
    const controller = new AbortController();
    const load = () =>
      fetch(
        bridgeUrl(
          `/api/models?host=${encodeURIComponent(host)}&sessionId=${encodeURIComponent(modelCatalogSessionId)}&refresh=1`,
        ),
        {
          cache: "no-store",
          signal: controller.signal,
        },
      )
        .then(async (response) => {
          const result = (await response.json()) as {
            models?: ModelOption[];
            error?: string;
          };
          if (!response.ok)
            throw new Error(result.error || `HTTP ${response.status}`);
          setModelsByHost((current) => ({
            ...current,
            [catalogKey]: result.models || [],
          }));
          setModelErrors((current) => ({ ...current, [catalogKey]: "" }));
        })
        .catch((error) => {
          if ((error as Error).name !== "AbortError") {
            setModelsByHost((current) => ({ ...current, [catalogKey]: [] }));
            setModelErrors((current) => ({
              ...current,
              [catalogKey]: (error as Error).message,
            }));
          }
        });
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [
    modelCatalogHost,
    modelCatalogKey,
    modelCatalogSessionId,
    modelRefresh,
    setModelErrors,
    setModelsByHost,
  ]);
}
