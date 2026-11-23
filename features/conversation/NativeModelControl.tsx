"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ChoiceMenu } from "@/components/choice-menu";
import { conversationRequest } from "./use-session-catalog";
import { NativeModelMenu } from "./NativeModelMenu";
export function NativeModelControl({
  host,
  provider,
  value,
  onChange,
  disabled = false,
  compact = false,
  effort = "",
  onEffortChange,
  onAutoSupportChange,
}: {
  host: string;
  provider: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  effort?: string;
  onEffortChange?: (value: string) => void;
  onAutoSupportChange?: (value: boolean | null) => void;
}) {
  const [result, setResult] = useState<{
    key: string;
    models: { id: string; label: string; resolvedModel?: string; efforts?: string[]; effortModels?: Record<string, string>; currentEffort?: string; supportsAutoMode?: boolean }[];
    error: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const canRead =
    ["antigravity", "claude"].includes(provider) && Boolean(host) && host !== "@local";
  const requestKey = JSON.stringify([host, provider, revision]);
  const current = result?.key === requestKey ? result : null;
  const loading = canRead && !current;
  const models = current?.models || [];
  const error = current?.error || "";
  useEffect(() => {
    if (!canRead) return;
    let active = true;
    conversationRequest<{ models: { id: string; label: string; resolvedModel?: string; efforts?: string[]; effortModels?: Record<string, string>; currentEffort?: string; supportsAutoMode?: boolean }[] }>(
      `/api/cli-conversations/models?host=${encodeURIComponent(host)}&provider=${provider}${revision ? "&refresh=1" : ""}`,
    )
      .then((value) => {
        if (active)
          setResult({ key: requestKey, models: value.models, error: "" });
      })
      .catch((cause) => {
        if (active)
          setResult({ key: requestKey, models: [], error: cause.message });
      });
    return () => {
      active = false;
    };
  }, [host, provider, canRead, revision, requestKey]);
  const selected = models.find(m => m.id === (value || "default") || m.resolvedModel === value);
  const autoSupport = provider === "antigravity" ? models[0]?.supportsAutoMode : selected?.supportsAutoMode;
  useEffect(() => { onAutoSupportChange?.(autoSupport ?? null); }, [autoSupport, onAutoSupportChange]);
  const efforts = selected?.efforts || [];
  const effortLabels: Record<string, string> = { low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" };
  const controls = (
    <div className="native-model-control">
      {["antigravity", "claude"].includes(provider) ? (
        <ChoiceMenu
          label="下一轮模型"
          fieldLabel="模型"
          value={value}
          onChange={(next) => { onChange(next); onEffortChange?.(""); }}
          disabled={disabled || loading}
          searchable
          options={[
            { value: "", label: loading ? "读取模型…" : "主机默认" },
            ...(value && !models.some((model) => model.id === value)
              ? [{ value, label: `${value}（待核验）` }]
              : []),
            ...models.filter(model => model.id !== "default").map((model) => ({ value: model.id, label: model.label })),
          ]}
        />
      ) : (
        <label className="native-model-field">
          <span>模型</span>
          <input
            aria-label="下一轮模型"
            placeholder="默认"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )}
      {["claude", "antigravity"].includes(provider) && onEffortChange && (
        <ChoiceMenu label="推理强度" fieldLabel="推理强度" value={provider === "antigravity" ? effort || selected?.currentEffort || "" : effort}
          onChange={(level) => { onEffortChange(level); if (provider === "antigravity" && selected?.effortModels?.[level]) onChange(selected.effortModels[level]); }} disabled={disabled || loading || !efforts.length}
          options={[{ value: "", label: !loading && selected && !efforts.length ? "不支持强度" : provider === "antigravity" && !value ? "先选择模型" : "默认强度" },
            ...efforts.map(level => ({ value: level, label: effortLabels[level] || level }))]} />
      )}
      {["antigravity", "claude"].includes(provider) && (
        <button
          type="button"
          className="native-model-refresh"
          aria-label="刷新模型能力"
          disabled={loading || disabled || !host || host === "@local"}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={12} />
        </button>
      )}
      {error && (
        <small className="native-model-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
  return compact ? <NativeModelMenu label={loading ? "读取模型…" : selected?.label || value || "主机默认"} effort={effortLabels[effort || selected?.currentEffort || ""] || "默认"} disabled={disabled}>{controls}</NativeModelMenu> : controls;
}
