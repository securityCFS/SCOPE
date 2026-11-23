"use client";
import { hostLabel, LOCAL_HOST } from "@/lib/execution-host";
import type { ProjectEntry } from "@/components/project-sidebar";
import { ChoiceMenu } from "@/components/choice-menu";
import type { Host } from "@/features/workspace/types";
import { PROVIDERS } from "@/lib/workbench-config";
import { ArrowUpRight, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  ComposerAttachmentButton,
  ComposerAttachmentInput,
  ComposerAttachmentList,
  useComposerAttachments,
} from "@/features/conversation/use-composer-attachments";
import { useLocale } from "@/lib/i18n";
import type { TaskDraft, WorkbenchState } from "./types";
import type { WorkbenchClient } from "./use-workbench";

export function TaskComposer({
  initial,
  hosts,
  projects,
  state,
  busy,
  mutate,
  onClose,
}: Pick<WorkbenchClient, "busy" | "mutate"> & {
  initial: TaskDraft;
  hosts: Host[];
  projects: ProjectEntry[];
  state: WorkbenchState;
  onClose: () => void;
}) {
  const { tr } = useLocale();
  const [draft, setDraft] = useState(initial);
  const [attachError, setAttachError] = useState("");
  const attach = useComposerAttachments({
    host: draft.host,
    scope: "task",
    onError: setAttachError,
  });
  const attempt = useRef({ signature: "", id: "" });
  async function submit() {
    if (busy || attach.hasUnready) return;
    const signature = JSON.stringify({ draft, attachments: attach.readyTokens });
    if (attempt.current.signature !== signature)
      attempt.current = { signature, id: crypto.randomUUID() };
    setAttachError("");
    try {
      await mutate("tasks", {
        ...draft,
        ...(attach.readyTokens.length ? { attachments: attach.readyTokens } : {}),
        requestId: attempt.current.id,
      });
      attach.clear();
      onClose();
    } catch {
      /* shared error region */
    }
  }
  return (
    <form
      className="task-composer center-card"
      onDragOver={attach.onDragOver}
      onDrop={(event) => {
        setAttachError("");
        attach.onDrop(event);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <header>
        <div>
          <h2>派发一个任务</h2>
          <p>任务会按资源与并发设置执行。</p>
        </div>
        <button
          type="button"
          className="center-icon-button"
          onClick={onClose}
          aria-label="关闭任务编辑"
        >
          <X size={18} />
        </button>
      </header>
      <div className="settings-field" style={{ marginBottom: 16 }}>
        <span className="settings-field-label">{tr("从已有项目开始", "Start from project")}</span>
        <ChoiceMenu
          label={tr("从已有项目开始", "Start from project")}
          searchable
          searchPlaceholder={tr("搜索项目…", "Search projects…")}
          value={
            projects.find((p) => p.host === draft.host && p.cwd === draft.cwd)?.key || ""
          }
          options={[
            { value: "", label: tr("自定义工作目录", "Custom working directory") },
            ...projects.map((p) => ({
              value: p.key,
              label: p.name || p.cwd,
              description: `${hostLabel(p.host)} · ${p.cwd}`,
            })),
          ]}
          onChange={(nextKey) => {
            const p = projects.find((item) => item.key === nextKey);
            if (p) setDraft({ ...draft, host: p.host, cwd: p.cwd });
          }}
        />
      </div>
      <div className="center-form-grid">
        <div className="settings-field">
          <span className="settings-field-label">Agent</span>
          <ChoiceMenu
            label="Agent"
            value={draft.provider}
            options={Object.entries(PROVIDERS).map(([id, p]) => ({
              value: id,
              label: p.name,
              description: !state.config.providers[id as TaskDraft["provider"]].enabled
                ? tr("未启用", "Disabled")
                : undefined,
              disabled:
                !state.config.providers[id as TaskDraft["provider"]].enabled ||
                (draft.host === LOCAL_HOST && id !== "codex"),
            }))}
            onChange={(nextProvider) =>
              setDraft({
                ...draft,
                provider: nextProvider as TaskDraft["provider"],
                gpuCount: 0,
              })
            }
          />
        </div>
        <div className="settings-field">
          <span className="settings-field-label">{tr("执行主机", "Execution host")}</span>
          <ChoiceMenu
            label={tr("执行主机", "Execution host")}
            value={draft.host}
            options={[
              { value: "", label: tr("选择主机", "Select host") },
              ...hosts.map((h) => ({
                value: h.alias,
                label: hostLabel(h.alias),
                description: h.reachable ? tr("在线", "Online") : tr("离线", "Offline"),
              })),
            ]}
            onChange={(nextHost) =>
              setDraft({
                ...draft,
                host: nextHost,
                cwd: hosts.find((h) => h.alias === nextHost)?.defaultCwd || "",
                provider: nextHost === LOCAL_HOST ? "codex" : draft.provider,
              })
            }
          />
        </div>
      </div>
      <label>
        工作目录
        <input
          required
          placeholder="/workspace/my-project"
          value={draft.cwd}
          onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
        />
      </label>
      <label>
        {tr("要完成什么", "Task prompt")}
        <textarea
          autoFocus
          required={attach.attachments.length === 0}
          rows={4}
          maxLength={16000}
          value={draft.prompt}
          placeholder={tr(
            "描述目标、完成标准和需要注意的约束。（支持拖拽或粘贴附件）",
            "Describe the goal and constraints. (Drop or paste files)",
          )}
          onPaste={(event) => {
            setAttachError("");
            attach.onPaste(event);
          }}
          onChange={(event) =>
            setDraft({ ...draft, prompt: event.target.value })
          }
        />
      </label>
      <ComposerAttachmentList
        attachments={attach.attachments}
        onRemove={attach.remove}
      />
      <ComposerAttachmentInput
        inputRef={attach.inputRef}
        onFiles={(files) => {
          setAttachError("");
          return attach.uploadFiles(files);
        }}
      />
      <div className="composer-attach-bar">
        <ComposerAttachmentButton
          uploading={attach.uploading}
          disabled={!draft.host}
          onClick={() => {
            setAttachError("");
            attach.openPicker();
          }}
        />
        <small>
          {tr("支持点击、拖拽或粘贴附件上传至目标主机", "Attach files for the target host via click, drop, or paste")}
        </small>
      </div>
      {attachError && (
        <p className="form-error" role="alert">
          {attachError}
        </p>
      )}
      <details>
        <summary>GPU 需求</summary>
        {draft.provider === "codex" ? (
          <p>
            Codex 复用远端 app-server，当前可通过资源视图查看
            GPU；队列中的逐任务 GPU 环境分配支持 Claude、Antigravity 和 DSH。
          </p>
        ) : (
          <div className="center-form-grid">
            <label>
              GPU 数量
              <input
                type="number"
                min={0}
                max={16}
                value={draft.gpuCount}
                onChange={(e) =>
                  setDraft({ ...draft, gpuCount: Number(e.target.value) })
                }
              />
            </label>
            <label>
              每张卡至少空闲显存（MiB）
              <input
                type="number"
                min={0}
                max={1000000}
                value={draft.minMemoryMiB}
                onChange={(e) =>
                  setDraft({ ...draft, minMemoryMiB: Number(e.target.value) })
                }
              />
            </label>
          </div>
        )}
        <p>
          分配控制本工作台内的并发，并设置
          CUDA_VISIBLE_DEVICES；远端其他进程仍可能使用同一张卡。
        </p>
      </details>
      {["claude", "antigravity"].includes(draft.provider) && (
        <p className="provider-note">
          先执行代理初始化，再启动 Agent。需要交互授权的工具调用会由远端 CLI
          拒绝，结果会显示在任务详情中。
        </p>
      )}
      {draft.provider === "dsh" && (
        <p className="provider-note">
          使用远端 headless profile 的模型和权限配置，每项任务创建独立会话。
        </p>
      )}
      <footer>
        <button type="button" className="center-secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="center-primary"
          disabled={
            busy ||
            attach.hasUnready ||
            !draft.host ||
            !draft.cwd ||
            (!draft.prompt.trim() && attach.attachments.length === 0) ||
            !state.config.providers[draft.provider].enabled
          }
        >
          加入队列 <ArrowUpRight size={15} />
        </button>
      </footer>
    </form>
  );
}
