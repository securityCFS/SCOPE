"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { ChoiceMenu } from "@/components/choice-menu";
import { hostRuntimeConfig } from "@/features/workspace/shared";
import type { WorkspaceController } from "@/features/workspace/use-workspace-controller";
import { DirectoryPicker } from "./DirectoryPicker";
import { NewSessionSettings } from "./NewSessionSettings";
import { LOCAL_HOST, hostLabel } from "@/lib/execution-host";

import { NativeModelControl } from "./NativeModelControl";
import { NativePermissionControl, type NativePermission } from "./NativePermissionControl";
import { NewAgentChoice, type NewAgent } from "./NewAgentChoice";
import { conversationRequest, type CatalogEntry } from "./use-session-catalog";
import {
  ComposerAttachmentButton,
  ComposerAttachmentInput,
  ComposerAttachmentList,
  useComposerAttachments,
} from "./use-composer-attachments";
import { useLocale } from "@/lib/i18n";
type Props = WorkspaceController & { onNativeCreated?: (entry: CatalogEntry) => void };

export function NewConversationDialog(w: Props) {
  return w.newTaskOpen ? (
    <Dialog workspace={w} />
  ) : null;
}
function Dialog({ workspace: w }: { workspace: Props }) {
  const { tr } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [provider, setProvider] = useState<NewAgent>("codex");
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeModel, setNativeModel] = useState("");
  const [nativeEffort, setNativeEffort] = useState("");
  const [autoSupported, setAutoSupported] = useState<boolean | null>(null);
  const [permissionMode, setPermissionMode] = useState<NativePermission>("default");
  const attach = useComposerAttachments({
    host: w.newTaskDraft.host,
    scope: "new-session",
    onError: (text) => w.setActionNotice({ kind: "error", text }),
  });
  const busy = w.busyAction === "create-task" || nativeBusy;
  async function create() {
    if (attach.hasUnready) return;
    if (provider === "codex") {
      const ok = await w.createTask(attach.readyTokens);
      if (ok) attach.clear();
      return;
    }
    setNativeBusy(true); w.setActionNotice(null);
    try {
      const entry = await conversationRequest<CatalogEntry>("/api/cli-conversations/send", {
        host: w.newTaskDraft.host,
        cwd: w.newTaskDraft.cwd,
        prompt: w.newTaskDraft.prompt,
        attachments: attach.readyTokens,
        attachmentScope: "new-session",
        provider,
        model: nativeModel,
        effort: nativeEffort,
        permissionMode,
      });
      attach.clear();
      w.onNativeCreated?.(entry); w.setNewTaskOpen(false);
    } catch (cause) { w.setActionNotice({ kind: "error", text: (cause as Error).message }); }
    finally { setNativeBusy(false); }
  }
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function close() {
    if (!busy) w.setNewTaskOpen(false);
  }
  return (
    <dialog
      ref={dialog}
      className="new-conversation-dialog"
      aria-labelledby="new-conversation-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <form
        onDragOver={attach.onDragOver}
        onDrop={(e) => {
          if (provider !== "codex" && w.newTaskDraft.host === LOCAL_HOST) return;
          attach.onDrop(e);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void create();
        }}
      >
        <header>
          <h2 id="new-conversation-title">新建会话</h2>
          <button
            type="button"
            aria-label="关闭新建会话"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <fieldset disabled={busy} className="new-conversation-fields">
          <NewAgentChoice value={provider} onChange={(next) => { setProvider(next); setNativeModel(""); setNativeEffort(""); setPermissionMode(next === "claude" ? "auto" : "default"); }} />
          <ChoiceMenu
            label={tr("设备", "Device")}
            fieldLabel={tr("设备", "Device")}
            value={w.newTaskDraft.host}
            options={[
              { value: "", label: tr("选择设备", "Select host") },
              ...w.snapshot.hosts.map((host) => ({
                value: host.alias,
                label: hostLabel(host.alias),
                description: host.reachable ? tr("在线", "Online") : tr("离线", "Offline"),
                disabled: !host.reachable || (provider !== "codex" && host.alias === LOCAL_HOST),
              })),
            ]}
            onChange={(nextHost) => {
              const host = w.snapshot.hosts.find((item) => item.alias === nextHost);
              const runtime = hostRuntimeConfig(w.snapshot.management, nextHost);
              w.setNewTaskDraft((value) => ({
                ...value,
                host: nextHost,
                cwd: host?.defaultCwd || host?.agents.find((a) => a.cwd)?.cwd || "",
                transport: "app-server",
                model: "",
                effort: "",
                preLaunchCommand: runtime.preLaunchCommand,
                yolo: runtime.yolo,
              }));
              w.setNewTaskDirectoryBrowser({
                open: false,
                loading: false,
                error: "",
                listing: null,
              });
            }}
          />
          <DirectoryPicker workspace={w} />
          {provider === "codex" ? (
            <NewSessionSettings workspace={w} />
          ) : (
            <div className="new-session-cli-settings">
              <NativeModelControl onAutoSupportChange={setAutoSupported} host={w.newTaskDraft.host} provider={provider} value={nativeModel} onChange={setNativeModel} effort={nativeEffort} onEffortChange={setNativeEffort} />
              <NativePermissionControl autoSupported={autoSupported} provider={provider} value={permissionMode} onChange={setPermissionMode} />
              <p className="native-note">
                {permissionMode === "auto" ? "自动评估工具权限" : permissionMode === "plan" ? "先调查并生成计划" : permissionMode === "workspace" ? "允许工作区编辑；其他操作按 CLI 策略处理" : "沿用 CLI 默认权限"} · 实时流式输出与交互审批 ·{" "}
                {hostRuntimeConfig(w.snapshot.management, w.newTaskDraft.host).preLaunchCommand
                  ? "已配置主机启动前命令"
                  : "直连启动（可在「设置 → 远程主机」自定义启动前命令）"}
              </p>
              {w.newTaskDraft.host === LOCAL_HOST && (
                <p className="form-error" role="alert">
                  请选择远程设备运行{" "}
                  {provider === "claude" ? "Claude" : "Antigravity"}。
                </p>
              )}
            </div>
          )}
          <label>
            {tr("开始聊什么？", "What do you want to work on?")}
            <textarea
              required={attach.attachments.length === 0}
              rows={3}
              placeholder={tr("描述你想完成的工作…（支持拖拽或粘贴附件）", "Describe the task… (drop or paste files)")}
              value={w.newTaskDraft.prompt}
              onPaste={(e) => {
                if (provider !== "codex" && w.newTaskDraft.host === LOCAL_HOST) return;
                attach.onPaste(e);
              }}
              onChange={(e) =>
                w.setNewTaskDraft((value) => ({
                  ...value,
                  prompt: e.target.value,
                }))
              }
            />
          </label>
          <ComposerAttachmentList
            attachments={attach.attachments}
            onRemove={attach.remove}
          />
          <ComposerAttachmentInput
            inputRef={attach.inputRef}
            onFiles={attach.uploadFiles}
          />
          <div className="composer-attach-bar">
            <ComposerAttachmentButton
              uploading={attach.uploading}
              disabled={
                !w.newTaskDraft.host ||
                (provider !== "codex" && w.newTaskDraft.host === LOCAL_HOST)
              }
              onClick={attach.openPicker}
            />
            <small>
              {tr("支持点击选择、拖拽或 Ctrl+V 粘贴图片/文件", "Click, drag & drop, or paste images/files")}
            </small>
          </div>
          {provider === "codex" && w.newTaskDraft.host !== LOCAL_HOST && <details className="new-conversation-advanced">
            <summary>{tr("高级设置", "Advanced settings")}</summary>
            <ChoiceMenu
              label={tr("运行方式", "Transport")}
              fieldLabel={tr("运行方式", "Transport")}
              value={w.newTaskDraft.transport}
              options={[
                { value: "app-server", label: tr("网页会话", "Web session (App Server)") },
                { value: "tmux", label: tr("终端会话（tmux）", "Terminal session (tmux)") },
              ]}
              onChange={(next) =>
                w.setNewTaskDraft((value) => ({
                  ...value,
                  transport: next as "app-server" | "tmux",
                }))
              }
            />
            <label>
              启动前命令
              <textarea
                rows={2}
                value={w.newTaskDraft.preLaunchCommand}
                onChange={(e) =>
                  w.setNewTaskDraft((value) => ({
                    ...value,
                    preLaunchCommand: e.target.value,
                  }))
                }
              />
            </label>
            <small>启动新连接时执行；不会自动重启已有连接。</small>
            <button
              type="button"
              disabled={!w.newTaskDraft.host || Boolean(w.busyAction)}
              onClick={() => void w.saveNewTaskRuntimeConfig()}
            >
              保存为设备默认
            </button>
          </details>}
        </fieldset>
        {w.actionNotice && (
          <p className="form-error" role="status">
            {w.actionNotice.text}
          </p>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button
            type="submit"
            className="new-conversation-submit"
            disabled={
              busy ||
              attach.hasUnready ||
              (provider !== "codex" && w.newTaskDraft.host === LOCAL_HOST) ||
              !w.newTaskDraft.host ||
              !w.newTaskDraft.cwd.trim() ||
              (!w.newTaskDraft.prompt.trim() && attach.attachments.length === 0)
            }
          >
            {busy ? <LoaderCircle size={15} className="is-spinning" /> : null}
            {busy ? "正在创建…" : "开始会话"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
