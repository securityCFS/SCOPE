"use client";
import { useEffect, useState } from "react";
import { List, Pencil, RefreshCw, Save, Sliders, User } from "lucide-react";
import { ChoiceMenu } from "@/components/choice-menu";
import type { WorkbenchConfig, WorkbenchState } from "@/features/command-center/types";
import type { Host, ModelOption } from "@/features/workspace/types";
import { bridgeUrl } from "@/features/workspace/shared";
import { LOCAL_HOST, hostLabel } from "@/lib/execution-host";
import { EFFORT_LABELS } from "@/lib/model-effort";
import { useLocale } from "@/lib/i18n";

export function GeneralSettingsTab({
  draft,
  update,
  state,
  hosts,
  operatorName,
  onSaveOperatorName,
}: {
  draft: WorkbenchConfig;
  update: (value: WorkbenchConfig) => void;
  state: WorkbenchState;
  hosts: Host[];
  operatorName: string;
  onSaveOperatorName?: (name: string) => Promise<void>;
}) {
  const { tr } = useLocale();
  const [nameDraft, setNameDraft] = useState(operatorName);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [customModelMode, setCustomModelMode] = useState(false);

  const selectedHost = hosts.find((h) => h.alias === draft.manager.host);
  const taskQueueEnabled = state.features?.taskQueue !== false;

  async function loadModels(hostAlias: string, refresh = false) {
    if (!hostAlias) {
      setModels([]);
      setModelsError("");
      return;
    }
    setModelsLoading(true);
    setModelsError("");
    try {
      const response = await fetch(
        bridgeUrl(
          `/api/models?host=${encodeURIComponent(hostAlias)}${refresh ? "&refresh=1" : ""}`,
        ),
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tr("无法读取模型目录", "Failed to load models"));
      setModels(Array.isArray(data.models) ? data.models : []);
    } catch (error) {
      setModelsError((error as Error).message);
    } finally {
      setModelsLoading(false);
    }
  }

  useEffect(() => {
    const hostAlias = draft.manager.host;
    if (!hostAlias || !hosts.find((h) => h.alias === hostAlias)?.reachable) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    fetch(bridgeUrl(`/api/models?host=${encodeURIComponent(hostAlias)}`), {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load models");
        if (!cancelled) {
          setModels(Array.isArray(data.models) ? data.models : []);
          setModelsError("");
        }
      })
      .catch((error) => {
        if (!cancelled && !controller.signal.aborted) {
          setModelsError((error as Error).message);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [draft.manager.host, hosts]);

  const activeModel = models.find(
    (m) => (m.model || m.id) === draft.manager.model,
  );
  const effortChoices = activeModel?.supportedReasoningEfforts?.length
    ? activeModel.supportedReasoningEfforts
    : Object.keys(EFFORT_LABELS);

  async function saveName() {
    if (!onSaveOperatorName || !nameDraft.trim()) return;
    setNameSaving(true);
    setNameSaved("");
    try {
      await onSaveOperatorName(nameDraft.trim());
      setNameSaved(tr("已更新显示名称", "Display name updated"));
    } finally {
      setNameSaving(false);
    }
  }

  return (
    <div className="settings-hub-body">
      <div className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>
              <User size={16} />
              {tr("操作者信息", "Operator Identity")}
            </h2>
            <p>
              {tr(
                "用于界面显示与邮件通知称呼，仅保存在本机 .scope/state.json。",
                "Shown in the topbar and notification titles. Stored locally in .scope/state.json.",
              )}
            </p>
          </div>
        </div>
        <div className="settings-inline-row">
          <label className="settings-field">
            <span className="settings-field-label">{tr("显示名称", "Display name")}</span>
            <input
              maxLength={40}
              value={nameDraft}
              onChange={(e) => {
                setNameDraft(e.target.value);
                setNameSaved("");
              }}
            />
          </label>
          {onSaveOperatorName && (
            <button
              type="button"
              className="center-secondary"
              disabled={nameSaving || !nameDraft.trim()}
              onClick={() => void saveName()}
            >
              <Save size={14} />
              {tr("保存名称", "Save name")}
            </button>
          )}
          {nameSaved && <span className="settings-badge ok">{nameSaved}</span>}
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>
              <Sliders size={16} />
              {tr("总调度（Coordinator）", "Cross-Project Coordinator")}
            </h2>
            <p>
              {tr(
                "跨项目只读对话持续保存。切换模型或推理强度沿用当前会话；更改设备或目录会开启新会话。",
                "Read-only cross-project workspace advisor. Changing model or effort keeps the current thread; changing host or directory starts a fresh one.",
              )}
            </p>
          </div>
        </div>
        <div className="center-form-grid">
          <div className="settings-field">
            <span className="settings-field-label">{tr("运行主机", "Execution host")}</span>
            <ChoiceMenu
              label={tr("运行主机", "Execution host")}
              value={draft.manager.host}
              options={[
                { value: "", label: tr("暂不配置", "Not configured") },
                ...hosts.map((h) => ({
                  value: h.alias,
                  label: hostLabel(h.alias),
                  description: h.reachable ? tr("在线", "Online") : tr("离线", "Offline"),
                })),
              ]}
              onChange={(alias) =>
                update({
                  ...draft,
                  manager: {
                    ...draft.manager,
                    host: alias,
                    cwd: hosts.find((h) => h.alias === alias)?.defaultCwd || "",
                  },
                })
              }
            />
          </div>

          <div className="settings-field">
            <span className="settings-field-label">{tr("模型", "Model")}</span>
            <div className="settings-control-row">
              {customModelMode ? (
                <input
                  aria-label={tr("模型", "Model")}
                  value={draft.manager.model}
                  placeholder={tr("留空使用主机默认模型", "Leave empty for host default")}
                  onChange={(e) =>
                    update({
                      ...draft,
                      manager: { ...draft.manager, model: e.target.value },
                    })
                  }
                />
              ) : (
                <ChoiceMenu
                  label={tr("模型", "Model")}
                  searchable
                  searchPlaceholder={tr("搜索模型…", "Search models…")}
                  value={draft.manager.model}
                  options={[
                    { value: "", label: tr("使用主机默认模型", "Use host default model") },
                    ...(draft.manager.model &&
                    !models.some((m) => (m.model || m.id) === draft.manager.model)
                      ? [{ value: draft.manager.model, label: draft.manager.model }]
                      : []),
                    ...models.map((m) => {
                      const id = m.model || m.id;
                      return { value: id, label: m.displayName || id };
                    }),
                  ]}
                  onChange={(value) =>
                    update({
                      ...draft,
                      manager: { ...draft.manager, model: value },
                    })
                  }
                />
              )}
              {selectedHost?.reachable && (
                <button
                  type="button"
                  className="settings-icon-btn"
                  disabled={modelsLoading}
                  title={tr("刷新模型目录", "Refresh model catalog")}
                  aria-label={tr("刷新模型目录", "Refresh model catalog")}
                  onClick={() => void loadModels(selectedHost.alias, true)}
                >
                  <RefreshCw size={14} className={modelsLoading ? "is-spinning" : ""} />
                </button>
              )}
              <button
                type="button"
                className="settings-icon-btn"
                title={customModelMode ? tr("切回列表选择", "Choose from catalog") : tr("手动输入模型名", "Enter custom model ID")}
                aria-label={customModelMode ? tr("切回列表选择", "Choose from catalog") : tr("手动输入模型名", "Enter custom model ID")}
                onClick={() => setCustomModelMode((current) => !current)}
              >
                {customModelMode ? <List size={14} /> : <Pencil size={14} />}
              </button>
            </div>
          </div>

          <div className="settings-field">
            <span className="settings-field-label">{tr("推理强度", "Reasoning effort")}</span>
            <ChoiceMenu
              label={tr("推理强度", "Reasoning effort")}
              value={draft.manager.effort}
              options={[
                { value: "", label: tr("模型默认", "Model default") },
                ...effortChoices.map((level) => ({
                  value: level,
                  label: EFFORT_LABELS[level as keyof typeof EFFORT_LABELS] || level,
                })),
              ]}
              onChange={(value) =>
                update({
                  ...draft,
                  manager: { ...draft.manager, effort: value },
                })
              }
            />
          </div>

          <label className="settings-field">
            <span className="settings-field-label">{tr("工作目录", "Working directory")}</span>
            <input
              placeholder={
                draft.manager.host === LOCAL_HOST
                  ? "C:/projects"
                  : "/workspace"
              }
              value={draft.manager.cwd}
              onChange={(e) =>
                update({
                  ...draft,
                  manager: { ...draft.manager, cwd: e.target.value },
                })
              }
            />
          </label>
        </div>
        {modelsError && (
          <p className="settings-status-banner error">{modelsError}</p>
        )}
      </div>

      <div className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>{tr("并发与资源调度", "Concurrency & Resident Pool")}</h2>
            <p>
              {taskQueueEnabled
                ? tr(
                    "设置任务队列并发上限与单设备常驻会话池：池内非超时或已保留会话长期常驻，超出池上限后按最久未活动顺序释放。",
                    "Configures queued task concurrency and per-host resident session pools (older overflow non-reserved sessions detach first).",
                  )
                : tr(
                    "控制单设备常驻会话池大小（<= 池上限时永久常驻，超出后按时间顺序清理非保留会话）；可在主机设置中按设备覆盖。",
                    "Controls the per-host resident session pool (sessions within the limit stay alive; overflow non-reserved idle sessions close oldest-first).",
                  )}
            </p>
          </div>
          <span className={`settings-badge ${taskQueueEnabled ? "ok" : ""}`}>
            {taskQueueEnabled ? tr("队列已启用", "Queue enabled") : tr("队列默认关闭", "Queue disabled")}
          </span>
        </div>
        <div className="center-form-grid">
          {(
            [
              ["maxRunning", tr("全局同时运行", "Max running globally"), 1, 32],
              ["maxPerHost", tr("每台主机同时运行", "Max per host"), 1, 32],
              ["maxPerProject", tr("同一目录同时运行", "Max per project directory"), 1, 32],
              ["inventoryMaxAgeSeconds", tr("GPU 采样有效时间（秒）", "GPU telemetry TTL (seconds)"), 1, 300],
              ["residentSessionsPerHost", tr("单设备常驻会话池（0 = 不常驻）", "Resident sessions per host (0 = no floor)"), 0, 64],
              ["sessionIdleGraceMinutes", tr("超池闲置回收缓冲（分钟）", "Overflow idle grace (minutes)"), 1, 1440],
            ] as const
          ).map(([key, label, min, max]) => (
            <label className="settings-field" key={key}>
              <span className="settings-field-label">{label}</span>
              <input
                type="number"
                min={min}
                max={max}
                value={
                  draft.scheduler[
                    key as keyof typeof draft.scheduler
                  ] as number
                }
                onChange={(e) =>
                  update({
                    ...draft,
                    scheduler: {
                      ...draft.scheduler,
                      [key]: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <label className="settings-checkbox" style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={draft.scheduler.paused}
            onChange={(e) =>
              update({
                ...draft,
                scheduler: { ...draft.scheduler, paused: e.target.checked },
              })
            }
          />
          {tr("暂停派发新的队列任务", "Pause new queued task dispatches")}
        </label>
      </div>
    </div>
  );
}
