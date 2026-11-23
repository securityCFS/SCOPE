import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { LOCAL_HOST } from "../../lib/execution-host.js";
import { attachmentHttpError } from "../attachment-store.mjs";
import {
  attachmentKind,
  renderInstructionWithAttachments,
  safeAttachmentFilename,
  streamAttachmentToLocal,
} from "../session-attachments.mjs";

/** Attachment upload, turn delivery, compact, and resource prompt sync routes. */
export function sessionDeliveryRoutes(context) {
  return async (request, response, url) => {
    const {
      ATTACHMENT_TTL_MS,
      appServerManager,
      auditLifecycle,
      cancelTmuxCapacityRecovery,
      findAgent,
      getManagementState,
      getSnapshot,
      jsonResponse,
      localCodex,
      notifyClients,
      persistManagementState,
      readJsonBody,
      recoverHostAppServerSessions,
      renderResourcePrompt,
      resolveUploadedAttachments,
      sendTmuxText,
      sessionKey,
      setManagementState,
      shellQuote,
      storeUploadedAttachment,
      streamAttachmentToHost,
    } = context();

    if (url.pathname === "/api/session/attachment" && request.method === "POST") {
      try {
        const snapshot = getSnapshot();
        const host = (url.searchParams.get("host") || "").trim();
        const sessionId = (url.searchParams.get("sessionId") || "").trim();
        const scope = (url.searchParams.get("scope") || "").trim().slice(0, 160);
        const originalName = (url.searchParams.get("name") || "attachment")
          .replace(/[\u0000-\u001f\u007f]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240) || "attachment";
        const mimeType = (url.searchParams.get("mimeType") || "application/octet-stream")
          .trim()
          .toLowerCase()
          .slice(0, 200) || "application/octet-stream";
        if (scope && !sessionId) {
          const hostEntry =
            snapshot.hosts.find((candidate) => candidate.alias === host) ||
            (host === LOCAL_HOST ? localCodex.host() : null);
          if (!hostEntry?.reachable) {
            throw attachmentHttpError("主机当前不可连接", 404);
          }
        } else {
          const agent = findAgent(host, sessionId);
          if (!agent?.rollout) {
            throw attachmentHttpError("未找到对应的活动 Session", 404);
          }
          if (!appServerManager.isConnected(host, sessionId) && !agent.pane) {
            throw attachmentHttpError("当前 Session 尚未接入 App Server 或 tmux", 409);
          }
        }
        const sessionSegment = (sessionId || scope)
          .replace(/[^a-zA-Z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80);
        if (!sessionSegment) throw attachmentHttpError("Session ID 无效");
        const uploadId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
        const filename = safeAttachmentFilename(originalName, randomUUID().slice(0, 8));
        const relativeDirectory = `.codex/scope-attachments/${sessionSegment}/${uploadId}`;
        const command = [
          "umask 077;",
          `scope_root="$HOME"/${shellQuote(".codex/scope-attachments")};`,
          'if [ -d "$scope_root" ]; then find "$scope_root" -type f -mtime +7 -delete 2>/dev/null || true; fi;',
          `scope_dir="$HOME"/${shellQuote(relativeDirectory)};`,
          'mkdir -p "$scope_dir" || exit $?;',
          `scope_file="$scope_dir"/${shellQuote(filename)};`,
          'cat > "$scope_file" || exit $?;',
          "printf 'SCOPE_UPLOAD_PATH=%s\\n' \"$scope_file\"",
        ].join(" ");
        const uploaded =
          host === LOCAL_HOST
            ? await streamAttachmentToLocal(request, {
                baseDir: path.join(os.homedir(), ".codex", "scope-attachments"),
                scopeSegment: sessionSegment,
                uploadId,
                filename,
              })
            : await streamAttachmentToHost(host, request, command);
        const token = randomUUID();
        const record = {
          token,
          host,
          sessionId,
          scope,
          name: originalName,
          mimeType,
          kind: attachmentKind(mimeType),
          size: uploaded.size,
          sha256: uploaded.sha256,
          remotePath: uploaded.remotePath,
          createdAt: Date.now(),
        };
        storeUploadedAttachment(record);
        auditLifecycle("session-attachment-uploaded", {
          host,
          sessionId,
          name: originalName,
          mimeType,
          kind: record.kind,
          size: record.size,
          sha256: record.sha256,
          remotePath: record.remotePath,
        });
        jsonResponse(response, 201, {
          ok: true,
          attachment: {
            token,
            name: record.name,
            mimeType: record.mimeType,
            kind: record.kind,
            size: record.size,
            sha256: record.sha256,
            remotePath: record.remotePath,
            expiresAt: new Date(record.createdAt + ATTACHMENT_TTL_MS).toISOString(),
          },
        });
      } catch (error) {
        jsonResponse(response, error.statusCode || 502, {
          error: `附件上传失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/session/instruct" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const prompt =
          typeof body.prompt === "string"
            ? body.prompt.trim().slice(0, 20_000)
            : "";
        const attachments = resolveUploadedAttachments(
          body.attachments,
          body.host,
          body.sessionId,
        );
        if (!prompt && !attachments.length) {
          jsonResponse(response, 400, { error: "instruction 和附件不能同时为空" });
          return true;
        }
        const agent = findAgent(body.host, body.sessionId);
        if (!agent?.rollout) {
          jsonResponse(response, 404, { error: "未找到对应的活动 Session" });
          return true;
        }
        const managedRecord = appServerManager
          .sessionRecords()
          .find(
            (session) =>
              session.host === body.host && session.sessionId === body.sessionId,
          );
        // An idle SSH/WebSocket proxy can be collected by the route between UI
        // actions. Recover every SCOPE-owned Session on that host first, then
        // deliver the original instruction through the newly established stream.
        if (managedRecord && !appServerManager.isConnected(body.host, body.sessionId)) {
          const recovered = await recoverHostAppServerSessions(body.host);
          if (!recovered.ok || !appServerManager.isConnected(body.host, body.sessionId)) {
            throw new Error(
              `app-server 自动重连失败：${recovered.results
                ?.find((result) => result.sessionId === body.sessionId)?.error || "远端流尚未恢复"}`,
            );
          }
        }
        if (appServerManager.isConnected(body.host, body.sessionId)) {
          const managedSession = appServerManager
            .sessionRecords()
            .find(
              (session) =>
                session.host === body.host && session.sessionId === body.sessionId,
            );
          const deliveryMode = managedSession?.status === "working" ? "steer" : "turn";
          try {
            if (deliveryMode === "steer") {
              await appServerManager.steerTurn(body.host, body.sessionId, prompt, {
                attachments,
              });
            } else {
              await appServerManager.startTurn(body.host, body.sessionId, prompt, {
                attachments,
              });
            }
          } catch (deliveryError) {
            const message =
              deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
            // Older Bridge children reported a dropped SSH tunnel as a remote
            // app-server exit (usually code 255 / client_loop Connection reset).
            // Treat both wordings as the same recoverable transport failure.
            if (!/SSH\/WebSocket 代理已断开|app-server transport 已关闭|该 Session 尚未连接 app-server|远端 app-server 已退出[\s\S]*(?:code 255|connection reset)|client_loop:\s*send disconnect:\s*connection reset/i.test(message)) {
              throw deliveryError;
            }
            const recovered = await recoverHostAppServerSessions(body.host);
            if (!recovered.ok || !appServerManager.isConnected(body.host, body.sessionId)) {
              throw deliveryError;
            }
            // The first RPC may have reached Codex before the proxy vanished.
            // Continue is safe; replaying the original instruction could submit
            // duplicate commands or jobs.
            await appServerManager.startTurn(body.host, body.sessionId, "继续", {
              automaticRecovery: true,
              attachments: [],
            });
            jsonResponse(response, 202, {
              ok: true,
              transport: "app-server",
              deliveryMode: "recovered-continue",
              sessionId: body.sessionId,
              attachments: attachments.length,
            });
            return true;
          }
          jsonResponse(response, 202, {
            ok: true,
            transport: "app-server",
            deliveryMode,
            sessionId: body.sessionId,
            attachments: attachments.length,
          });
          return true;
        }
        cancelTmuxCapacityRecovery(body.host, body.sessionId);
        const delivery = await sendTmuxText(
          agent,
          renderInstructionWithAttachments(prompt, attachments),
          body.deliveryId,
        );
        jsonResponse(response, 202, {
          ok: true,
          transport: "tmux",
          ...delivery,
          sessionId: body.sessionId,
          attachments: attachments.length,
        });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `发送 instruction 失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/session/compact" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const agent = findAgent(body.host, body.sessionId);
        if (!agent?.rollout) {
          jsonResponse(response, 404, { error: "未找到对应的活动 Session" });
          return true;
        }
        if (appServerManager.isConnected(body.host, body.sessionId)) {
          await appServerManager.compactSession(body.host, body.sessionId);
          jsonResponse(response, 202, {
            ok: true,
            transport: "app-server",
            sessionId: body.sessionId,
          });
          return true;
        }
        const delivery = await sendTmuxText(agent, "/compact");
        jsonResponse(response, 202, {
          ok: true,
          transport: "tmux",
          ...delivery,
          sessionId: body.sessionId,
        });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `压缩上下文失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/prompt/sync" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const agent = findAgent(body.host, body.sessionId);
        if (!agent?.rollout || !agent.pane) {
          jsonResponse(response, 409, {
            error: "该会话未精确匹配 tmux，不能安全注入 prompt",
          });
          return true;
        }
        const prompt = renderResourcePrompt(agent);
        const delivery = await sendTmuxText(agent, prompt);
        const managementState = getManagementState();
        const key = sessionKey(body.host, body.sessionId);
        const current = managementState.sessions[key] || {};
        setManagementState({
          ...managementState,
          sessions: {
            ...managementState.sessions,
            [key]: {
              ...current,
              lastPromptSyncedAt: new Date().toISOString(),
            },
          },
        });
        await persistManagementState();
        notifyClients();
        jsonResponse(response, 200, { ok: true, prompt, ...delivery });
      } catch (error) {
        jsonResponse(response, 502, { error: `同步失败：${error.message}` });
      }
      return true;
    }

    return false;
  };
}
