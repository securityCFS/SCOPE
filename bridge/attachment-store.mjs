import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_ATTACHMENTS_TOTAL_BYTES,
} from "./session-attachments.mjs";

export function attachmentHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function createAttachmentStore({
  cleanSshError,
  inventoryOperations,
  sshOperationCounts,
  SSH_TIMEOUT_MS,
  ATTACHMENT_TTL_MS,
  ATTACHMENT_UPLOAD_TIMEOUT_MS,
}) {
  const uploadedAttachments = new Map();

  function purgeExpiredAttachments(now = Date.now()) {
    for (const [token, attachment] of uploadedAttachments) {
      if (now - attachment.createdAt > ATTACHMENT_TTL_MS) {
        uploadedAttachments.delete(token);
      }
    }
  }

  function storeUploadedAttachment(record) {
    purgeExpiredAttachments(record.createdAt);
    uploadedAttachments.set(record.token, record);
  }

  function resolveUploadedAttachments(value, host, expected = "") {
    purgeExpiredAttachments();
    if (!Array.isArray(value)) return [];
    if (value.length > MAX_ATTACHMENTS_PER_TURN) {
      throw attachmentHttpError(`每条消息最多 ${MAX_ATTACHMENTS_PER_TURN} 个附件`);
    }
    const expectedSessionId =
      typeof expected === "string" ? expected : String(expected?.sessionId || "");
    const expectedScope =
      typeof expected === "object" && expected ? String(expected.scope || "") : "";
    const resolved = [];
    const seen = new Set();
    let totalBytes = 0;
    for (const item of value) {
      const token = typeof item?.token === "string" ? item.token.trim() : "";
      if (!token || seen.has(token)) continue;
      seen.add(token);
      const attachment = uploadedAttachments.get(token);
      if (!attachment) {
        throw attachmentHttpError("附件已过期或 Bridge 已重启，请重新上传", 410);
      }
      if (expectedScope) {
        if (attachment.host !== host || attachment.sessionId || attachment.scope !== expectedScope) {
          throw attachmentHttpError("附件不属于当前主机与会话上下文", 403);
        }
      } else if (attachment.host !== host || attachment.sessionId !== expectedSessionId) {
        throw attachmentHttpError("附件不属于当前主机与 Session", 403);
      }
      totalBytes += attachment.size;
      if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
        throw attachmentHttpError("单条消息的附件总大小不能超过 100 MiB", 413);
      }
      resolved.push(attachment);
    }
    return resolved;
  }

  async function streamAttachmentToHost(alias, request, command) {
    const inventory = inventoryOperations.get(alias);
    if (inventory) await inventory.catch(() => {});
    const declaredLength = Number(request.headers["content-length"] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES) {
      request.resume();
      throw attachmentHttpError("单个附件不能超过 50 MiB", 413);
    }

    sshOperationCounts.set(alias, (sshOperationCounts.get(alias) || 0) + 1);
    const child = spawn(
      (typeof process !== "undefined" && process.platform === "win32" ? "ssh.exe" : "ssh"),
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        `ConnectTimeout=${Math.ceil(SSH_TIMEOUT_MS / 1000)}`,
        "--",
        alias,
        command,
      ],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    let size = 0;
    let timedOut = false;
    const hash = createHash("sha256");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 16_000) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 32_000) stderr += chunk.toString("utf8");
    });
    // A remote disconnect can close stdin while the browser is still streaming.
    // `once(..., "drain")` observes this error; this listener prevents an
    // additional unhandled stream error when no backpressure wait is active.
    child.stdin.on("error", () => {});
    const closePromise = new Promise((resolve) => {
      child.on("error", (error) => {
        stderr += `\n${error.message}`;
      });
      child.on("close", (code) => resolve(code ?? 1));
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, ATTACHMENT_UPLOAD_TIMEOUT_MS);

    let uploadError = null;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_ATTACHMENT_BYTES) {
          uploadError = attachmentHttpError("单个附件不能超过 50 MiB", 413);
          request.resume();
          break;
        }
        hash.update(chunk);
        if (!child.stdin.write(chunk)) await once(child.stdin, "drain");
      }
    } catch (error) {
      uploadError = error;
    }
    if (uploadError) {
      child.stdin.destroy();
      child.kill();
    } else {
      child.stdin.end();
    }
    const code = await closePromise;
    clearTimeout(timer);
    const remaining = Math.max(0, (sshOperationCounts.get(alias) || 1) - 1);
    if (remaining) sshOperationCounts.set(alias, remaining);
    else sshOperationCounts.delete(alias);

    if (uploadError) throw uploadError;
    if (timedOut) throw attachmentHttpError("附件上传超过 2 分钟", 504);
    if (code !== 0) {
      throw attachmentHttpError(
        `远端附件写入失败：${cleanSshError(stderr || stdout)}`,
        502,
      );
    }
    const pathLine = stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("SCOPE_UPLOAD_PATH="));
    const remotePath = pathLine?.slice("SCOPE_UPLOAD_PATH=".length).trim() || "";
    if (
      !remotePath.startsWith("/") ||
      !remotePath.includes("/.codex/scope-attachments/")
    ) {
      throw attachmentHttpError("远端没有返回有效的附件路径", 502);
    }
    return { remotePath, size, sha256: hash.digest("hex") };
  }

  return {
    purgeExpiredAttachments,
    storeUploadedAttachment,
    resolveUploadedAttachments,
    streamAttachmentToHost,
  };
}
