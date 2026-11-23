"use client";
import { useState, useSyncExternalStore } from "react";
import { SlidersHorizontal, RotateCcw } from "lucide-react";
import { ChoiceMenu } from "./choice-menu";
import { useLocale } from "@/lib/i18n";
import {
  DEFAULT_PROJECT_FILTERS,
  normalizeProjectFilters,
  PROJECT_FILTER_OPTIONS,
} from "@/lib/project-view";

const PROJECT_FILTER_OPTIONS_EN: Record<
  keyof typeof PROJECT_FILTER_OPTIONS,
  Record<string, string>
> = {
  order: { recent: "Recent", oldest: "Oldest" },
  category: {
    all: "All tasks",
    research: "Research",
    training: "Training",
    evaluation: "Eval",
    engineering: "Engineering",
    other: "Uncategorized",
  },
  provider: {
    all: "All agents",
    codex: "Codex",
    claude: "Claude",
    antigravity: "Antigravity",
  },
  status: {
    all: "All statuses",
    working: "Running",
    attention: "Attention",
    idle: "Idle / Done",
  },
};
export type ProjectFilters = typeof DEFAULT_PROJECT_FILTERS;
const storageKey = "scope.project-filters.v1";
const preferenceEvent = "scope:project-filters";
const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener(preferenceEvent, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(preferenceEvent, notify);
  };
};
let fallbackValue: string | null = null;
const readPreference = () => {
  try {
    return localStorage.getItem(storageKey) ?? fallbackValue;
  } catch {
    return fallbackValue;
  }
};
export function useProjectFilters() {
  const raw = useSyncExternalStore(subscribe, readPreference, () => null);
  let filters = DEFAULT_PROJECT_FILTERS;
  try {
    filters = normalizeProjectFilters(
      JSON.parse(raw || "null"),
    ) as ProjectFilters;
  } catch {
    /* Invalid saved preference uses defaults. */
  }
  function setFilters(value: ProjectFilters) {
    fallbackValue = JSON.stringify(normalizeProjectFilters(value));
    try {
      localStorage.setItem(storageKey, fallbackValue);
    } catch {
      /* Browser storage may be unavailable. */
    }
    window.dispatchEvent(new Event(preferenceEvent));
  }
  return [filters, setFilters] as const;
}
export function ProjectFilterBar({
  value,
  onChange,
}: {
  value: ProjectFilters;
  onChange: (value: ProjectFilters) => void;
}) {
  const { locale, tr } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const changed = Object.keys(value).some(
    (key) =>
      value[key as keyof ProjectFilters] !==
      DEFAULT_PROJECT_FILTERS[key as keyof ProjectFilters],
  );
  function select(key: keyof ProjectFilters, label: string) {
    return (
      <ChoiceMenu
        label={label}
        value={value[key]}
        compact
        onChange={(next) => onChange({ ...value, [key]: next })}
        options={Object.entries(PROJECT_FILTER_OPTIONS[key]).map(
          ([id, title]) => ({
            value: id,
            label:
              locale === "en"
                ? PROJECT_FILTER_OPTIONS_EN[key]?.[id] || (title as string)
                : (title as string),
          }),
        )}
      />
    );
  }
  return (
    <div className="project-filter-bar">
      <div>
        {select("order", tr("会话时间排序", "Sort by activity"))}
        {select("category", tr("任务类型", "Category"))}
        <button
          type="button"
          className={
            value.provider !== "all" || value.status !== "all" ? "active" : ""
          }
          aria-label={tr("更多会话筛选", "More filters")}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <SlidersHorizontal size={13} />
        </button>
      </div>
      {expanded && (
        <div>
          {select("provider", tr("Agent 类型", "Agent"))}
          {select("status", tr("会话状态", "Status"))}
        </div>
      )}
      {changed && (
        <button
          type="button"
          className="project-filter-reset"
          onClick={() => onChange({ ...DEFAULT_PROJECT_FILTERS })}
        >
          <RotateCcw size={11} />
          {tr("重置筛选", "Reset")}
        </button>
      )}
    </div>
  );
}
