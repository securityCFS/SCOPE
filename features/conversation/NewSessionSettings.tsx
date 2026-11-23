"use client";
import { useEffect, useState } from "react";
import { ChoiceMenu } from "@/components/choice-menu";
import { bridgeUrl } from "@/features/workspace/shared";
import type { ModelOption } from "@/features/workspace/types";
import type { WorkspaceController } from "@/features/workspace/use-workspace-controller";

export function NewSessionSettings({
  workspace: w,
}: {
  workspace: WorkspaceController;
}) {
  const [catalog, setCatalog] = useState<{
    host: string;
    models: ModelOption[];
    error: string;
  } | null>(null);
  const { host, model, effort, yolo } = w.newTaskDraft;
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!host) return;
    const controller = new AbortController();
    fetch(bridgeUrl(`/api/models?host=${encodeURIComponent(host)}`), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "无法读取模型");
        setCatalog({ host, models: result.models || [], error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setCatalog({ host, models: [], error: error.message });
      });
    return () => controller.abort();
  }, [host, reload]);
  const models = catalog?.host === host ? catalog.models : [];
  const selected = models.find((option) => option.id === model);
  const labels: Record<string, string> = {
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "极高",
    max: "最高",
  };
  return (
    <div className="new-session-settings">
      <div className="new-conversation-grid">
        <ChoiceMenu
          label="模型"
          fieldLabel="模型"
          searchable
          searchPlaceholder="搜索模型…"
          value={model}
          options={[
            { value: "", label: "主机默认" },
            ...models.map((option) => ({
              value: option.id,
              label: option.displayName || option.id,
            })),
          ]}
          onChange={(nextModel) => {
            const option = models.find((item) => item.id === nextModel);
            w.setNewTaskDraft((value) => ({
              ...value,
              model: nextModel,
              effort: option?.defaultReasoningEffort || "",
            }));
          }}
        />
        <ChoiceMenu
          label="推理强度"
          fieldLabel="推理强度"
          value={effort}
          disabled={!selected?.supportedReasoningEfforts.length}
          options={[
            { value: "", label: "默认" },
            ...(selected?.supportedReasoningEfforts || []).map((value) => ({
              value,
              label: labels[value] || value,
            })),
          ]}
          onChange={(nextEffort) =>
            w.setNewTaskDraft((value) => ({
              ...value,
              effort: nextEffort,
            }))
          }
        />
      </div>
      {catalog?.host === host && catalog.error && (
        <p className="form-error" role="alert">
          <span>{catalog.error}</span>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            重试
          </button>
        </p>
      )}
      <ChoiceMenu
        label="权限"
        fieldLabel="权限"
        value={yolo ? "full" : "workspace"}
        options={[
          {
            value: "workspace",
            label: "工作区权限",
            description: "越界操作按需审批",
          },
          {
            value: "full",
            label: "完全访问",
            description: "不请求工具审批",
          },
        ]}
        onChange={(next) =>
          w.setNewTaskDraft((value) => ({
            ...value,
            yolo: next === "full",
          }))
        }
      />
    </div>
  );
}
