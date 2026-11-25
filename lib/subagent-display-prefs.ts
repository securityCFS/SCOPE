"use client";
import { useSyncExternalStore } from "react";

export type SubagentDisplayPrefs = {
  showInlineCards: boolean;
  showInteractions: boolean;
  showHeaderBadge: boolean;
  autoExpandInteractions: boolean;
};

export const DEFAULT_SUBAGENT_DISPLAY_PREFS: SubagentDisplayPrefs = {
  showInlineCards: true,
  showInteractions: true,
  showHeaderBadge: true,
  autoExpandInteractions: false,
};

const STORAGE_KEY = "scope:subagent-display";
const PREFS_EVENT = "scope:subagent-display-change";

let cachedRaw: string | null = null;
let cachedSnapshot: SubagentDisplayPrefs = DEFAULT_SUBAGENT_DISPLAY_PREFS;

export function normalizeSubagentDisplayPrefs(
  raw: unknown,
): SubagentDisplayPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_SUBAGENT_DISPLAY_PREFS;
  const obj = raw as Record<string, unknown>;
  return {
    showInlineCards:
      typeof obj.showInlineCards === "boolean"
        ? obj.showInlineCards
        : DEFAULT_SUBAGENT_DISPLAY_PREFS.showInlineCards,
    showInteractions:
      typeof obj.showInteractions === "boolean"
        ? obj.showInteractions
        : DEFAULT_SUBAGENT_DISPLAY_PREFS.showInteractions,
    showHeaderBadge:
      typeof obj.showHeaderBadge === "boolean"
        ? obj.showHeaderBadge
        : DEFAULT_SUBAGENT_DISPLAY_PREFS.showHeaderBadge,
    autoExpandInteractions:
      typeof obj.autoExpandInteractions === "boolean"
        ? obj.autoExpandInteractions
        : DEFAULT_SUBAGENT_DISPLAY_PREFS.autoExpandInteractions,
  };
}

function readPrefs(): SubagentDisplayPrefs {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === cachedRaw) return cachedSnapshot;
    cachedRaw = saved;
    cachedSnapshot = saved
      ? normalizeSubagentDisplayPrefs(JSON.parse(saved))
      : DEFAULT_SUBAGENT_DISPLAY_PREFS;
    return cachedSnapshot;
  } catch {
    return DEFAULT_SUBAGENT_DISPLAY_PREFS;
  }
}

function subscribePrefs(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(PREFS_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(PREFS_EVENT, notify);
  };
}

export function setSubagentDisplayPrefs(
  patch: Partial<SubagentDisplayPrefs>,
): SubagentDisplayPrefs {
  const next: SubagentDisplayPrefs = {
    ...readPrefs(),
    ...patch,
  };
  const serialized = JSON.stringify(next);
  cachedRaw = serialized;
  cachedSnapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    /* ignore storage errors */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PREFS_EVENT));
  }
  return next;
}

export function resetSubagentDisplayPrefs(): SubagentDisplayPrefs {
  cachedRaw = null;
  cachedSnapshot = DEFAULT_SUBAGENT_DISPLAY_PREFS;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore storage errors */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PREFS_EVENT));
  }
  return DEFAULT_SUBAGENT_DISPLAY_PREFS;
}

export function isDefaultSubagentDisplayPrefs(
  prefs: SubagentDisplayPrefs,
): boolean {
  return (
    prefs.showInlineCards === DEFAULT_SUBAGENT_DISPLAY_PREFS.showInlineCards &&
    prefs.showInteractions === DEFAULT_SUBAGENT_DISPLAY_PREFS.showInteractions &&
    prefs.showHeaderBadge === DEFAULT_SUBAGENT_DISPLAY_PREFS.showHeaderBadge &&
    prefs.autoExpandInteractions ===
      DEFAULT_SUBAGENT_DISPLAY_PREFS.autoExpandInteractions
  );
}

export function useSubagentDisplayPrefs() {
  const prefs = useSyncExternalStore<SubagentDisplayPrefs>(
    subscribePrefs,
    readPrefs,
    () => DEFAULT_SUBAGENT_DISPLAY_PREFS,
  );
  return {
    prefs,
    updatePrefs: setSubagentDisplayPrefs,
    resetPrefs: resetSubagentDisplayPrefs,
  };
}
