"use client";
import {
  formatAttachmentSize,
  InspectorModule,
  managementKey,
  relativeTime,
  temporaryRemoteCwd,
} from "@/features/workspace/shared";
import {
  FileText,
  ImageIcon,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Send,
  SquareTerminal,
  X,
} from "lucide-react";
import type { WorkspaceController } from "./use-workspace-controller";
import type { ComponentProps, ReactNode } from "react";
import { useRef } from "react";
import { useSlashCommands } from "@/features/conversation/use-slash-commands";
import { useLocale } from "@/lib/i18n";

function ComposerFrame({
  children,
  className,
}: ComponentProps<typeof InspectorModule>) {
  return (
    <div className={`chat-compose-surface ${className || ""}`}>{children}</div>
  );
}

export function SessionComposer({
  conversation = false,
  controls,
  onCommand,
  selectedInspectorKey,
  pendingInstruction,
  selectedAgent,
  selectedAppServerSession,
  selectedAgentIsExternalTerminal,
  sendInstruction,
  uploadInstructionFiles,
  instructionAttachments,
  removeInstructionAttachment,
  instructionDraft,
  setInstructionDraft,
  busyAction,
  instructionFileInputRef,
  unarchiveSession,
  selectedRecoveryCwd,
  setRecoveryCwdDrafts,
  selectedRecoveryCwdOptions,
  selectedRecoveryYolo,
  setRecoveryYoloDrafts,
  connectAppServer,
  takeoverSession,
}: Pick<
  WorkspaceController,
  | "selectedInspectorKey"
  | "pendingInstruction"
  | "selectedAgent"
  | "selectedAppServerSession"
  | "selectedAgentIsExternalTerminal"
  | "sendInstruction"
  | "uploadInstructionFiles"
  | "instructionAttachments"
  | "removeInstructionAttachment"
  | "instructionDraft"
  | "setInstructionDraft"
  | "busyAction"
  | "instructionFileInputRef"
  | "unarchiveSession"
  | "selectedRecoveryCwd"
  | "setRecoveryCwdDrafts"
  | "selectedRecoveryCwdOptions"
  | "selectedRecoveryYolo"
  | "setRecoveryYoloDrafts"
  | "connectAppServer"
  | "takeoverSession"
> & { conversation?: boolean; controls?: ReactNode; onCommand?: (name:string)=>void }) {
  const { tr } = useLocale();
  const composer = useRef<HTMLFormElement>(null);
  const slash = useSlashCommands({provider:"codex",host:selectedAgent?.host || "",cwd:selectedAgent?.cwd || "",sessionId:selectedAgent?.rollout?.id,
    draft:instructionDraft,setDraft:setInstructionDraft,disabled:!conversation || !selectedAppServerSession,
    onLocal:name => {
      if (name === "compact" || name === "stop") {onCommand?.(name);return;}
      composer.current?.querySelector<HTMLButtonElement>(name === "permissions" ? '.composer-permission' : '.composer-model')?.click();
    }});
  function submit() { if (selectedAgent && !slash.handleLocal()) sendInstruction(selectedAgent); }
  if (!selectedAgent) return null;
  const Frame = conversation ? ComposerFrame : InspectorModule;
  return (
    <Frame
      key={`${selectedInspectorKey}:reply`}
      title="继续对话"
      defaultOpen
      meta={
        pendingInstruction?.key === managementKey(selectedAgent)
          ? `等待回复 · ${relativeTime(pendingInstruction.sentAt)}`
          : selectedAppServerSession
            ? "app-server"
            : selectedAgent.pane
              ? `tmux:${selectedAgent.pane.session}`
              : selectedAgentIsExternalTerminal
                ? `外部终端:${selectedAgent.tty || "unknown"}`
                : "尚未接管"
      }
      className={`session-reply-section ${
        selectedAppServerSession || selectedAgent.pane ? "is-live" : ""
      }`}
    >
      {selectedAppServerSession || selectedAgent.pane ? (
        <form
          ref={composer}
          className="session-reply-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.files.length) return;
            event.preventDefault();
            void uploadInstructionFiles(
              selectedAgent,
              Array.from(event.dataTransfer.files),
            );
          }}
        >
          {instructionAttachments.length > 0 && (
            <div className="instruction-attachment-list">
              {instructionAttachments.map((attachment) => (
                <div
                  className={`instruction-attachment is-${attachment.status}`}
                  key={attachment.localId}
                  title={
                    attachment.error || attachment.remotePath || attachment.name
                  }
                >
                  {attachment.previewUrl ? (
                    // Blob previews are local-only and never exposed by the Bridge.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={attachment.previewUrl} alt="" />
                  ) : attachment.kind === "image" ? (
                    <ImageIcon size={17} />
                  ) : (
                    <FileText size={17} />
                  )}
                  <span>
                    <strong>{attachment.name}</strong>
                    <small>
                      {formatAttachmentSize(attachment.size)} ·{" "}
                      {attachment.status === "uploading"
                        ? tr("正在上传", "Uploading")
                        : attachment.status === "error"
                          ? tr("上传失败", "Failed")
                          : tr("已就绪", "Ready")}
                    </small>
                  </span>
                  {attachment.status === "uploading" ? (
                    <LoaderCircle size={14} className="is-spinning" />
                  ) : (
                    <button
                      type="button"
                      aria-label={tr(`移除附件 ${attachment.name}`, `Remove ${attachment.name}`)}
                      onClick={() =>
                        removeInstructionAttachment(attachment.localId)
                      }
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {slash.panel}
          <textarea
            {...slash.inputProps}
            aria-label="发送消息"
            maxLength={20000}
            rows={3}
            value={instructionDraft}
            placeholder={
              selectedAppServerSession
                ? "继续聊聊，或者交给我一个任务…"
                : "发送消息到当前会话…"
            }
            onChange={(event) => setInstructionDraft(event.target.value)}
            onPaste={(event) => {
              if (!event.clipboardData.files.length) return;
              void uploadInstructionFiles(
                selectedAgent,
                Array.from(event.clipboardData.files),
              );
            }}
            onKeyDown={(event) => {
              if (slash.onKeyDown(event)) return;
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                (conversation
                  ? !event.shiftKey
                  : event.ctrlKey || event.metaKey) &&
                (instructionDraft.trim() ||
                  instructionAttachments.length > 0) &&
                instructionAttachments.every(
                  (attachment) => attachment.status === "ready",
                ) &&
                busyAction !== `instruct:${managementKey(selectedAgent)}`
              ) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="session-reply-actions">
            <button
              type="button"
              className="secondary-action attachment-picker"
              disabled={instructionAttachments.some(
                (attachment) => attachment.status === "uploading",
              )}
              onClick={() => instructionFileInputRef.current?.click()}
            >
              <Paperclip size={15} />
              {tr("附件", "Attach")}
            </button>
            <input
              ref={instructionFileInputRef}
              className="visually-hidden"
              type="file"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                if (files.length) {
                  void uploadInstructionFiles(selectedAgent, files);
                }
              }}
            />
            {controls}
            <button
              type="submit"
              className="primary-action"
              aria-label={tr("发送消息", "Send message")}
              disabled={
                (!instructionDraft.trim() &&
                  instructionAttachments.length === 0) ||
                instructionAttachments.some(
                  (attachment) => attachment.status !== "ready",
                ) ||
                busyAction === `instruct:${managementKey(selectedAgent)}`
              }
            >
              {busyAction === `instruct:${managementKey(selectedAgent)}` ? (
                <LoaderCircle size={15} className="is-spinning" />
              ) : (
                <Send size={15} />
              )}
              {tr("发送", "Send")}
            </button>
          </div>
        </form>
      ) : (
        <div className="session-recovery-panel">
          <p className="session-reply-unavailable">
            {selectedAgentIsExternalTerminal
              ? `该 Codex 仍在外部终端 ${selectedAgent.tty || "unknown"} 中运行。SCOPE 不会终止或劫持它；请回到原 VS Code/SSH terminal 继续。正常退出原 CLI 后，才能在这里恢复同一 Session。`
              : selectedAgent.historical &&
                  temporaryRemoteCwd(selectedAgent.cwd)
                ? `原目录 ${selectedAgent.cwd} 是临时目录；恢复时不会再使用它。`
                : "选择恢复目录和运行通道后，将恢复同一个 Session 与 Dialogue。"}
          </p>
          {selectedAgent.rollout?.archived && (
            <div className="session-archive-recovery">
              <p>
                该 Session
                是被旧版“关闭”按钮错误归档的；日志仍在远端归档目录中。
              </p>
              <button
                type="button"
                className="secondary-action"
                disabled={
                  busyAction === `unarchive:${managementKey(selectedAgent)}`
                }
                onClick={() => unarchiveSession(selectedAgent)}
              >
                {busyAction === `unarchive:${managementKey(selectedAgent)}` ? (
                  <LoaderCircle size={15} className="is-spinning" />
                ) : (
                  <RefreshCw size={15} />
                )}
                恢复 Session 日志
              </button>
            </div>
          )}
          {selectedAgent.historical && (
            <label className="session-recovery-cwd">
              <span>恢复到工作目录</span>
              <input
                required
                list={`scope-recovery-cwds-${selectedAgent.rollout?.id || "session"}`}
                placeholder="/persistent/path/to/project"
                value={selectedRecoveryCwd}
                onChange={(event) =>
                  setRecoveryCwdDrafts((current) => ({
                    ...current,
                    [managementKey(selectedAgent)]: event.target.value,
                  }))
                }
              />
              <datalist
                id={`scope-recovery-cwds-${selectedAgent.rollout?.id || "session"}`}
              >
                {selectedRecoveryCwdOptions.map((cwd) => (
                  <option key={cwd} value={cwd} />
                ))}
              </datalist>
              <small>已优先建议同项目的持久目录；后端会先验证目录存在。</small>
            </label>
          )}
          <label className="session-recovery-cwd">
            <span>恢复执行策略</span>
            <select
              value={selectedRecoveryYolo ? "yolo" : "guarded"}
              onChange={(event) =>
                setRecoveryYoloDrafts((current) => ({
                  ...current,
                  [managementKey(selectedAgent)]: event.target.value === "yolo",
                }))
              }
            >
              <option value="yolo">YOLO（不审批、完整权限）</option>
              <option value="guarded">受控（按需审批、仅工作区可写）</option>
            </select>
          </label>
          <div className="session-recovery-actions">
            <button
              type="button"
              className="primary-action"
              disabled={
                !selectedAgent.rollout ||
                (!selectedAgent.historical &&
                  !selectedAgent.appServerManaged) ||
                (selectedAgent.historical && !selectedRecoveryCwd.trim()) ||
                Boolean(selectedAgent.rollout?.archived) ||
                busyAction === `app-server:${managementKey(selectedAgent)}` ||
                busyAction === `takeover:${managementKey(selectedAgent)}`
              }
              onClick={() => connectAppServer(selectedAgent)}
            >
              {busyAction === `app-server:${managementKey(selectedAgent)}` ? (
                <LoaderCircle size={15} className="is-spinning" />
              ) : (
                <MessageSquareText size={15} />
              )}
              恢复到 App Server
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={
                !selectedAgent.rollout ||
                (!selectedAgent.historical &&
                  !selectedAgent.appServerManaged) ||
                (selectedAgent.historical && !selectedRecoveryCwd.trim()) ||
                Boolean(selectedAgent.rollout?.archived) ||
                busyAction === `app-server:${managementKey(selectedAgent)}` ||
                busyAction === `takeover:${managementKey(selectedAgent)}`
              }
              onClick={() => takeoverSession(selectedAgent)}
            >
              {busyAction === `takeover:${managementKey(selectedAgent)}` ? (
                <LoaderCircle size={15} className="is-spinning" />
              ) : (
                <SquareTerminal size={15} />
              )}
              恢复到 tmux
            </button>
          </div>
        </div>
      )}
    </Frame>
  );
}
