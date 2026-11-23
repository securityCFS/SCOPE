"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, LoaderCircle, Paperclip, X } from "lucide-react";
import { bridgeUrl, formatAttachmentSize } from "@/features/workspace/shared";
import { useLocale } from "@/lib/i18n";

export const MAX_COMPOSER_ATTACHMENTS = 8;
export const MAX_COMPOSER_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_COMPOSER_TOTAL_BYTES = 100 * 1024 * 1024;

export type ComposerAttachment = {
  localId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "file";
  status: "uploading" | "ready" | "error";
  token: string;
  remotePath: string;
  previewUrl: string;
  error: string;
};

export function useComposerAttachments({
  host,
  scope,
  onError,
}: {
  host: string;
  scope: string;
  onError?: (message: string) => void;
}) {
  const { tr } = useLocale();
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  attachmentsRef.current = attachments;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ownerKey = `${host}::${scope}`;
  const ownerRef = useRef(ownerKey);

  useEffect(() => {
    ownerRef.current = ownerKey;
    setAttachments((current) => {
      for (const item of current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
    if (inputRef.current) inputRef.current.value = "";
  }, [ownerKey]);

  useEffect(() => {
    return () => {
      for (const item of attachmentsRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  function remove(localId: string) {
    setAttachments((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.localId !== localId);
    });
  }

  function clear() {
    setAttachments((current) => {
      for (const item of current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function uploadFiles(selectedFiles: File[]) {
    if (!selectedFiles.length) return;
    if (!host) {
      onError?.(
        tr(
          "请先选择运行主机后再添加附件。",
          "Select a target host before attaching files.",
        ),
      );
      return;
    }
    if (attachments.some((item) => item.status === "uploading")) {
      onError?.(
        tr(
          "上一批附件仍在上传，请稍候。",
          "Previous attachments are still uploading.",
        ),
      );
      return;
    }

    const activeOwner = ownerKey;
    ownerRef.current = activeOwner;
    let totalBytes = attachments.reduce((sum, item) => sum + item.size, 0);
    let remainingSlots = Math.max(0, MAX_COMPOSER_ATTACHMENTS - attachments.length);
    const accepted: Array<{ file: File; attachment: ComposerAttachment }> = [];
    const rejected: string[] = [];

    for (const file of selectedFiles) {
      if (!remainingSlots) {
        rejected.push(
          tr(
            `${file.name}：每条消息最多 ${MAX_COMPOSER_ATTACHMENTS} 个附件`,
            `${file.name}: up to ${MAX_COMPOSER_ATTACHMENTS} attachments per message`,
          ),
        );
        continue;
      }
      if (file.size > MAX_COMPOSER_ATTACHMENT_BYTES) {
        rejected.push(
          tr(
            `${file.name}：单个文件不能超过 50 MiB`,
            `${file.name}: exceeds 50 MiB file limit`,
          ),
        );
        continue;
      }
      if (totalBytes + file.size > MAX_COMPOSER_TOTAL_BYTES) {
        rejected.push(
          tr(
            `${file.name}：附件总大小不能超过 100 MiB`,
            `${file.name}: exceeds 100 MiB total limit`,
          ),
        );
        continue;
      }
      const localId =
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : "";
      const attachment: ComposerAttachment = {
        localId,
        name: file.name || "attachment",
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        kind: file.type.startsWith("image/") ? "image" : "file",
        status: "uploading",
        token: "",
        remotePath: "",
        previewUrl,
        error: "",
      };
      accepted.push({ file, attachment });
      totalBytes += file.size;
      remainingSlots -= 1;
    }

    if (accepted.length) {
      setAttachments((current) => [
        ...current,
        ...accepted.map(({ attachment }) => attachment),
      ]);
    }
    if (rejected.length) {
      onError?.(rejected.join("；"));
    }

    for (const { file, attachment } of accepted) {
      try {
        const parameters = new URLSearchParams({
          host,
          scope,
          name: file.name || "attachment",
          mimeType: file.type || "application/octet-stream",
        });
        const response = await fetch(
          bridgeUrl(`/api/session/attachment?${parameters.toString()}`),
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: file,
          },
        );
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
          attachment?: {
            token: string;
            name: string;
            mimeType: string;
            kind: "image" | "file";
            size: number;
            remotePath: string;
          };
        };
        if (!response.ok || !result.attachment) {
          throw new Error(result.error || `HTTP ${response.status}`);
        }
        if (ownerRef.current !== activeOwner) continue;
        setAttachments((current) =>
          current.map((item) =>
            item.localId === attachment.localId
              ? {
                  ...item,
                  ...result.attachment!,
                  status: "ready",
                  error: "",
                }
              : item,
          ),
        );
      } catch (error) {
        if (ownerRef.current !== activeOwner) continue;
        setAttachments((current) =>
          current.map((item) =>
            item.localId === attachment.localId
              ? { ...item, status: "error", error: (error as Error).message }
              : item,
          ),
        );
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function onPaste(event: React.ClipboardEvent) {
    if (!event.clipboardData.files.length) return;
    void uploadFiles(Array.from(event.clipboardData.files));
  }

  function onDragOver(event: React.DragEvent) {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function onDrop(event: React.DragEvent) {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    void uploadFiles(Array.from(event.dataTransfer.files));
  }

  function openPicker() {
    inputRef.current?.click();
  }

  const uploading = attachments.some((item) => item.status === "uploading");
  const hasUnready = attachments.some((item) => item.status !== "ready");
  const readyTokens = attachments
    .filter((item) => item.status === "ready" && item.token)
    .map((item) => ({ token: item.token }));

  return {
    attachments,
    inputRef,
    uploadFiles,
    remove,
    clear,
    openPicker,
    onPaste,
    onDragOver,
    onDrop,
    uploading,
    hasUnready,
    readyTokens,
  };
}

export function ComposerAttachmentList({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  onRemove: (localId: string) => void;
}) {
  const { tr } = useLocale();
  if (!attachments.length) return null;
  return (
    <ul className="instruction-attachment-list">
      {attachments.map((attachment) => (
        <li
          className={`instruction-attachment is-${attachment.status}`}
          key={attachment.localId}
          title={attachment.error || attachment.remotePath || attachment.name}
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
              onClick={() => onRemove(attachment.localId)}
            >
              <X size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ComposerAttachmentInput({
  inputRef,
  onFiles,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: File[]) => void | Promise<void>;
}) {
  return (
    <input
      ref={inputRef}
      className="visually-hidden"
      type="file"
      multiple
      hidden
      style={{ display: "none" }}
      onChange={(event) => {
        const files = Array.from(event.target.files || []);
        if (files.length) void onFiles(files);
      }}
    />
  );
}

export function ComposerAttachmentButton({
  uploading,
  disabled,
  compact = false,
  onClick,
}: {
  uploading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const { tr } = useLocale();
  return (
    <button
      type="button"
      className={
        compact
          ? "secondary-action attachment-picker is-compact"
          : "secondary-action attachment-picker"
      }
      disabled={disabled || uploading}
      onClick={onClick}
      aria-label={tr("添加附件", "Attach files")}
      title={tr(
        "添加附件（支持拖拽与粘贴，单文件 ≤ 50 MiB）",
        "Attach files (drag & drop or paste supported, ≤ 50 MiB each)",
      )}
    >
      <Paperclip size={14} />
      {compact ? null : <span>{tr("附件", "Attach")}</span>}
    </button>
  );
}
