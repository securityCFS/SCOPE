"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import "./message-copy-button.css";

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to legacy textarea copy (e.g. non-HTTPS LAN access) */
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function MessageCopyButton({
  text,
  title,
  align = "start",
}: {
  text: string;
  title?: string;
  align?: "start" | "end";
}) {
  const { tr } = useLocale();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!text) return null;

  return (
    <div
      className={`message-copy-actions${align === "end" ? " is-end" : ""}`}
    >
      <button
        type="button"
        className={`message-copy-btn${copied ? " is-copied" : ""}`}
        aria-label={tr("复制消息", "Copy message")}
        title={title || tr("复制消息", "Copy message")}
        onClick={async () => {
          const ok = await copyTextToClipboard(text);
          if (ok) {
            setCopied(true);
            setCopyError(false);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setCopied(false), 1800);
          } else {
            setCopyError(true);
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied && <span>{tr("已复制", "Copied")}</span>}
      </button>
      {copyError && (
        <small className="message-copy-error" role="status">
          {tr("复制失败，请选中文本复制", "Copy failed; select text manually")}
        </small>
      )}
    </div>
  );
}
