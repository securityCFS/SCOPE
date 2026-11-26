"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ChoiceMenu } from "@/components/choice-menu";
import { useLocale } from "@/lib/i18n";
import { conversationRequest } from "./use-session-catalog";
import { NativeModelMenu } from "./NativeModelMenu";
export function NativeModelControl({
  host,
  provider,
  value,
  onChange,
  disabled = false,
  compact = false,
  allowLocal = false,
  agyProfile = "",
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
  allowLocal?: boolean;
  agyProfile?: string;
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
    ["antigravity", "claude"].includes(provider) &&
    Boolean(host) &&
    (host !== "@local" || allowLocal);
  const requestKey = JSON.stringify([host, provider, agyProfile, revision]);
  const current = result?.key === requestKey ? result : null;
  const loading = canRead && !current;
  const models = current?.models || [];
  const error = current?.error || "";
  useEffect(() => {
    if (!canRead) return;
    let active = true;
    const profileQuery =
      provider === "antigravity" && agyProfile
        ? `&agyProfile=${encodeURIComponent(agyProfile)}`
        : "";
    conversationRequest<{ models: { id: string; label: string; resolvedModel?: string; efforts?: string[]; effortModels?: Record<string, string>; currentEffort?: string; supportsAutoMode?: boolean }[] }>(
      `/api/cli-conversations/models?host=${encodeURIComponent(host)}&provider=${provider}${profileQuery}${revision ? "&refresh=1" : ""}`,
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
  }, [host, provider, agyProfile, canRead, revision, requestKey]);
  const { tr } = useLocale();
  const selected = models.find(m => m.id === (value || "default") || m.resolvedModel === value);
  const autoSupport = provider === "antigravity" ? models[0]?.supportsAutoMode : selected?.supportsAutoMode;
  useEffect(() => { onAutoSupportChange?.(autoSupport ?? null); }, [autoSupport, onAutoSupportChange]);
  const efforts = selected?.efforts || [];
  const effortLabels: Record<string, string> = {
    low: tr("低", "Low"),
    medium: tr("中", "Med"),
    high: tr("高", "High"),
    xhigh: tr("极高", "XHigh"),
    max: tr("最高", "Max"),
  };
  const controls = (
    <div className="native-model-control">
      {["antigravity", "claude"].includes(provider) ? (
        <ChoiceMenu
          label={tr("下一轮模型", "Next turn model")}
          fieldLabel={tr("模型", "Model")}
          value={value}
          onChange={(next) => { onChange(next); onEffortChange?.(""); }}
          disabled={disabled || loading}
          searchable
          options={[
            { value: "", label: loading ? tr("读取模型…", "Loading models…") : tr("主机默认", "Host default") },
            ...(value && !models.some((model) => model.id === value)
              ? [{ value, label: tr(`${value}（待核验）`, `${value} (unverified)`) }]
              : []),
            ...models.filter(model => model.id !== "default").map((model) => ({ value: model.id, label: model.label })),
          ]}
        />
      ) : (
        <label className="native-model-field">
          <span>{tr("模型", "Model")}</span>
          <input
            aria-label={tr("下一轮模型", "Next turn model")}
            placeholder={tr("默认", "Default")}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )}
      {["claude", "antigravity"].includes(provider) && onEffortChange && (
        <ChoiceMenu label={tr("推理强度", "Reasoning effort")} fieldLabel={tr("推理强度", "Effort")} value={provider === "antigravity" ? effort || selected?.currentEffort || "" : effort}
          onChange={(level) => { onEffortChange(level); if (provider === "antigravity" && selected?.effortModels?.[level]) onChange(selected.effortModels[level]); }} disabled={disabled || loading || !efforts.length}
          options={[{ value: "", label: !loading && selected && !efforts.length ? tr("不支持强度", "Not supported") : provider === "antigravity" && !value ? tr("先选择模型", "Select model first") : tr("默认强度", "Default effort") },
            ...efforts.map(level => ({ value: level, label: effortLabels[level] || level }))]} />
      )}
      {["antigravity", "claude"].includes(provider) && (
        <button
          type="button"
          className="native-model-refresh"
          aria-label={tr("刷新模型能力", "Refresh models")}
          disabled={loading || disabled || !host || (host === "@local" && !allowLocal)}
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
  return compact ? <NativeModelMenu label={loading ? tr("读取模型…", "Loading…") : selected?.label || value || tr("主机默认", "Host default")} effort={effortLabels[effort || selected?.currentEffort || ""] || tr("默认", "Default")} disabled={disabled}>{controls}</NativeModelMenu> : controls;
}
