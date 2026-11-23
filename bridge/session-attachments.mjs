import { createHash } from "node:crypto";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TURN = 8;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 100 * 1024 * 1024;
const LOCAL_RETENTION_MS = 7 * 24 * 60 * 60_000;

const STRUCTURED_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function cleanString(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function safeAttachmentFilename(value, uniqueSuffix = "") {
  const original = path.posix.basename(String(value || "attachment").replaceAll("\\", "/"));
  const extensionMatch = original.match(/(\.[a-zA-Z0-9]{1,12})$/);
  const extension = extensionMatch?.[1]?.toLowerCase() || "";
  const stem = original
    .slice(0, Math.max(0, original.length - extension.length))
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 72) || "attachment";
  const suffix = String(uniqueSuffix || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "")
    .slice(0, 32);
  return `${stem}${suffix ? `-${suffix}` : ""}${extension}`;
}

export function attachmentKind(mimeType) {
  return STRUCTURED_IMAGE_MIME_TYPES.has(cleanString(mimeType, 200).toLowerCase())
    ? "image"
    : "file";
}

export function isValidAttachmentPath(value) {
  return typeof value === "string" && (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value));
}

export function normalizeTurnAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ATTACHMENTS_PER_TURN)
    .map((attachment) => ({
      name: cleanString(attachment?.name, 240) || "attachment",
      mimeType: cleanString(attachment?.mimeType, 200) || "application/octet-stream",
      size: Math.max(0, Math.floor(Number(attachment?.size) || 0)),
      remotePath: cleanString(attachment?.remotePath, 4_000),
      kind: attachment?.kind === "image" ? "image" : "file",
    }))
    .filter((attachment) => isValidAttachmentPath(attachment.remotePath));
}

export function formatUserPromptPreview(prompt, attachments = []) {
  const normalized = normalizeTurnAttachments(attachments);
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!normalized.length) return text;
  const names = normalized.map((item) => item.name).join(", ");
  return text ? `${text}\n\n[附件: ${names}]` : `[附件: ${names}]`;
}

export function renderInstructionWithAttachments(prompt, attachments = []) {
  const normalized = normalizeTurnAttachments(attachments);
  // Callers validate their own prompt limits; formatting must not discard instructions.
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!normalized.length) return text;
  const manifest = normalized.map(
    (attachment) =>
      `- ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes): ${attachment.remotePath}`,
  );
  return [
    text || "请查看并处理本条消息附带的文件。",
    "",
    "[SCOPE 网页附件：文件已安全上传到当前目标主机，请按以下绝对路径读取]",
    ...manifest,
  ].join("\n");
}

async function pruneOldLocalAttachments(dir, cutoffMs, depth = 0) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < 2) {
        await pruneOldLocalAttachments(entryPath, cutoffMs, depth + 1);
      }
      const remaining = await readdir(entryPath).catch(() => ["keep"]);
      if (!remaining.length) await rm(entryPath, { recursive: true, force: true }).catch(() => {});
    } else if (entry.isFile()) {
      const info = await stat(entryPath).catch(() => null);
      if (info && info.mtimeMs < cutoffMs) {
        await rm(entryPath, { force: true }).catch(() => {});
      }
    }
  }
}

export async function streamAttachmentToLocal(request, { baseDir, scopeSegment, uploadId, filename }) {
  const declaredLength = Number(request.headers?.["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES) {
    request.resume?.();
    throw Object.assign(new Error("单个附件不能超过 50 MiB"), { statusCode: 413 });
  }
  await pruneOldLocalAttachments(baseDir, Date.now() - LOCAL_RETENTION_MS).catch(() => {});
  const targetDir = path.join(baseDir, scopeSegment, uploadId);
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const targetFile = path.join(targetDir, filename);
  // Open exclusively before consuming the request. FileHandle failures are caught
  // promises, rather than an early unhandled WriteStream error event.
  const writer = await open(targetFile, "wx", 0o600);
  let size = 0;
  const hash = createHash("sha256");
  try {
    for await (const rawChunk of request) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      size += chunk.length;
      if (size > MAX_ATTACHMENT_BYTES) {
        request.resume?.();
        throw Object.assign(new Error("单个附件不能超过 50 MiB"), { statusCode: 413 });
      }
      hash.update(chunk);
      await writer.writeFile(chunk);
    }
    await writer.close();
  } catch (error) {
    await writer.close().catch(() => {});
    await rm(targetFile, { force: true }).catch(() => {});
    throw error;
  }
  return { remotePath: targetFile, size, sha256: hash.digest("hex") };
}

export function appServerTurnInput(prompt, attachments = []) {
  const normalized = normalizeTurnAttachments(attachments);
  const text = renderInstructionWithAttachments(prompt, normalized);
  const input = text ? [{ type: "text", text, text_elements: [] }] : [];
  for (const attachment of normalized) {
    if (attachment.kind === "image") {
      input.push({ type: "localImage", path: attachment.remotePath });
    }
  }
  return input;
}
