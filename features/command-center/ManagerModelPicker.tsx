"use client";
import "./manager-model.css";
import { Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bridgeUrl } from "@/features/workspace/shared";
import type { WorkbenchState } from "./types";
import type { WorkbenchClient } from "./use-workbench";
import { EFFORT_LABELS, compatibleEffort } from "@/lib/model-effort";
import { hostLabel } from "@/lib/execution-host";

export function ManagerModelPicker({
  state,
  busy,
  mutate,
  hosts,
  pending,
}: Pick<WorkbenchClient, "busy" | "mutate"> & {
  state: WorkbenchState;
  hosts: { alias: string; reachable: boolean }[];
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState(state.config.manager.host);
  const [models, setModels] = useState<
    {
      id: string;
      model?: string;
      displayName?: string;
      supportedReasoningEfforts?: string[];
      defaultReasoningEffort?: string;
    }[]
  >([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !host) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ host });
    if (state.managerSession?.sessionId)
      params.set("sessionId", state.managerSession.sessionId);
    void fetch(bridgeUrl(`/api/models?${params}`), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "模型目录读取失败");
        if (!controller.signal.aborted) setModels(data.models || []);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, host, state.managerSession?.sessionId]);
  const selected = models.find(
    (m) => (m.model || m.id) === state.config.manager.model,
  );
  async function select(model: string, effort: string) {
    try {
      await mutate("config", {
        revision: state.configRevision,
        config: {
          ...state.config,
          manager: { ...state.config.manager, host, model, effort },
        },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="manager-model-picker" ref={root}>
      <button
        type="button"
        className="composer-model"
        ref={trigger}
        aria-label="切换总调度模型"
        aria-expanded={open}
        onClick={() => {
          setHost(state.config.manager.host);
          setModels([]);
          setError("");
          setLoading(!!state.config.manager.host);
          setOpen((value) => !value);
        }}
      >
        <span>{state.config.manager.model}</span>
        <span className="manager-effort-label">
          {EFFORT_LABELS[
            state.config.manager.effort as keyof typeof EFFORT_LABELS
          ] || "默认"}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <section
          className="composer-popover manager-model-menu"
          role="dialog"
          aria-label="总调度模型"
        >
          <header>
            <strong>模型</strong>
            <button
              type="button"
              aria-label="关闭模型菜单"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </header>
          {!state.config.manager.host && (
            <label>
              运行设备
              <select
                aria-label="模型所在设备"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setModels([]);
                  setError("");
                  setLoading(!!e.target.value);
                }}
              >
                <option value="">选择设备</option>
                {hosts.map((h) => (
                  <option key={h.alias} value={h.alias} disabled={!h.reachable}>
                    {hostLabel(h.alias)}
                    {h.reachable ? "" : " · 离线"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {pending && <p>当前回复结束后可切换模型。</p>}
          {loading && (
            <p>
              <LoaderCircle size={14} className="is-spinning" />{" "}
              正在读取可用模型…
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="manager-model-options">
            {models.map((m) => (
              <button
                type="button"
                key={m.id}
                disabled={busy || pending}
                onClick={() =>
                  void select(
                    m.model || m.id,
                    compatibleEffort(m, state.config.manager.effort),
                  )
                }
                aria-pressed={(m.model || m.id) === state.config.manager.model}
              >
                <span>{m.displayName || m.model || m.id}</span>
                {(m.model || m.id) === state.config.manager.model && (
                  <Check size={14} />
                )}
              </button>
            ))}
          </div>
          {!!selected?.supportedReasoningEfforts?.length && (
            <label className="manager-effort-control">
              推理强度
              <select
                aria-label="总调度推理强度"
                value={state.config.manager.effort || ""}
                disabled={busy || pending}
                onChange={(e) =>
                  void select(state.config.manager.model, e.target.value)
                }
              >
                <option value="">
                  模型默认
                  {selected.defaultReasoningEffort
                    ? ` · ${EFFORT_LABELS[selected.defaultReasoningEffort as keyof typeof EFFORT_LABELS] || selected.defaultReasoningEffort}`
                    : ""}
                </option>
                {selected.supportedReasoningEfforts.map((effort) => (
                  <option key={effort} value={effort}>
                    {EFFORT_LABELS[effort as keyof typeof EFFORT_LABELS] ||
                      effort}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!loading && host && !models.length && !error && (
            <p>这台设备暂未返回可用模型。</p>
          )}
        </section>
      )}
    </div>
  );
}
