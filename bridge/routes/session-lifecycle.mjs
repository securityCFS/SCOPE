import { LOCAL_HOST } from "../../lib/execution-host.js";
import { APP_SERVER_HANDOFF_PROBE, NEW_SESSION_PREFLIGHT } from "../probes/index.mjs";
import { renderInstructionWithAttachments } from "../session-attachments.mjs";
import {
  buildExactTmuxTerminateCommand,
  normalizeTmuxSessionName,
} from "../tmux-session-control.mjs";

/** Session creation, closing, takeover, recovery, upgrade, and SSE event stream routes. */
export function sessionLifecycleRoutes(context) {
  const takeoverJobs = new Set();
  const appServerJobs = new Set();

  return async (request, response, url) => {
    const {
      TAKEOVER_TIMEOUT_MS,
      appServerAuthRecoveryHosts,
      appServerManager,
      appServerRestoreFailures,
      auditLifecycle,
      cleanSshError,
      clients,
      codexExecutable,
      codexUpgrades,
      detectRemoteSessionWriter,
      findLiveAgent,
      getManagementState,
      getSnapshot,
      historicalSessions,
      hostConfigRestarts,
      hostRuntimeConfig,
      jsonResponse,
      localDirectory,
      newSessionConnectionKey,
      notifyClients,
      persistAppServerSessions,
      persistHistoryIndex,
      persistManagementState,
      persistSnapshotCache,
      publishSnapshotSync,
      readJsonBody,
      recoverAuthenticationFailedSessions,
      recoverHostAppServerSessions,
      recoveryAgent,
      rememberTmuxAgent,
      removeEventClient,
      resolveUploadedAttachments,
      resumeAgentInTmux,
      resumeManagedAppServerSession,
      revealUnarchivedSession,
      runSshCommand,
      saveHostRuntimeConfig,
      scanAll,
      sendTmuxText,
      sessionKey,
      sessionProfileAssignment,
      sessionYolo,
      setSnapshot,
      shellQuote,
      snapshotInvalidationPayload,
      snapshotSyncStore,
      tmuxAgentForDelivery,
      writeEventClient,
    } = context();

    if (url.pathname === "/api/session/create" && request.method === "POST") {
      try {
        const snapshot = getSnapshot();
        const body = await readJsonBody(request);
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === body.host,
        );
        if (!host?.reachable) {
          jsonResponse(response, 404, {
            error: `主机 ${body.host || "（未选择）"} 当前不可连接`,
          });
          return true;
        }
        const requestedCwd =
          typeof body.cwd === "string" ? body.cwd.trim().slice(0, 4_000) : "";
        const prompt =
          typeof body.prompt === "string"
            ? body.prompt.trim().slice(0, 20_000)
            : "";
        const attachments = resolveUploadedAttachments(
          body.attachments,
          host.alias,
          { scope: "new-session" },
        );
        if (!requestedCwd || (!prompt && !attachments.length)) {
          jsonResponse(response, 400, {
            error: "新任务需要远端工作目录和初始 instruction 或附件",
          });
          return true;
        }
        if (host.alias === LOCAL_HOST && (body.transport === "tmux" || body.preLaunchCommand?.trim())) throw new Error("本机 Codex 使用原生 App Server，不支持远端 tmux 或启动脚本");
        const preflight = host.alias === LOCAL_HOST
          ? { code: 0, stdout: JSON.stringify({ cwd: await localDirectory(requestedCwd) }) }
          : await runSshCommand(
          host.alias,
          `python3 - ${shellQuote(requestedCwd)}`,
          NEW_SESSION_PREFLIGHT,
          15_000,
        );
        if (preflight.code !== 0) {
          throw new Error(cleanSshError(preflight.stderr || preflight.stdout));
        }
        const resolved = JSON.parse(preflight.stdout.trim());
        const executable =
          host.agents
            .map((agent) => agent.executable)
            .find(
              (candidate) =>
                typeof candidate === "string" &&
                (candidate === "codex" || candidate.endsWith("/codex")),
            ) || "codex";
        const transport = body.transport === "tmux" ? "tmux" : "app-server";
        const runtime = await saveHostRuntimeConfig(host.alias, {
          preLaunchCommand: body.preLaunchCommand,
          yolo: body.yolo,
        });
        const sessionOptions = {
          host: host.alias,
          cwd: resolved.cwd,
          model:
            typeof body.model === "string" && body.model.trim()
              ? body.model.trim().slice(0, 200)
              : null,
          effort:
            typeof body.effort === "string" && body.effort.trim()
              ? body.effort.trim().slice(0, 40)
              : null,
          yolo: runtime.yolo,
          executable,
        };
        const session =
          transport === "tmux"
            ? await appServerManager.createDetachedSession(sessionOptions)
            : await appServerManager.createSession({
                ...sessionOptions,
                connectionKey: await newSessionConnectionKey(host.alias),
                prompt,
                attachments,
              });
        if (transport === "tmux") {
          const agent = {
            host: host.alias,
            cwd: session.cwd,
            executable,
            rollout: {
              id: session.sessionId,
              path: session.path,
              model: session.model,
            },
          };
          let resumed = null;
          try {
            resumed = await resumeAgentInTmux(
              agent,
              0,
              session.model || "",
              runtime,
            );
            rememberTmuxAgent(agent, resumed);
            const delivery = await sendTmuxText(
              tmuxAgentForDelivery(agent, resumed),
              renderInstructionWithAttachments(prompt, attachments),
            );
            jsonResponse(response, 201, {
              ok: true,
              transport: "tmux",
              session: { ...session, status: "working" },
              tmux: resumed,
              delivery,
            });
            setTimeout(() => scanAll({ hosts: [host.alias] }).catch(() => {}), 700);
            return true;
          } catch (error) {
            // A delivery/verification failure does not prove that the pane is
            // disposable. Keep it alive for inspection and an idempotent retry.
            if (!appServerManager.isManaged(host.alias, session.sessionId)) {
              try {
                await resumeManagedAppServerSession({
                  host: host.alias,
                  sessionId: session.sessionId,
                  path: session.path,
                  cwd: session.cwd,
                  model: session.model || null,
                  effort: session.effort || null,
                  yolo: session.yolo !== false,
                  executable,
                  connectionKey: session.connectionKey,
                });
              } catch (rollbackError) {
                throw new Error(
                  `${error.message}；回滚 app-server 也失败：${rollbackError.message}`,
                );
              }
            }
            throw error;
          }
        }
        jsonResponse(response, 201, {
          ok: true,
          transport: "app-server",
          session,
        });
        setTimeout(() => scanAll({ hosts: [host.alias] }).catch(() => {}), 700);
      } catch (error) {
        jsonResponse(response, 502, {
          error: `新建任务失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/session/close" && request.method === "POST") {
      try {
        const managementState = getManagementState();
        const body = await readJsonBody(request);
        const host = typeof body.host === "string" ? body.host.trim() : "";
        const sessionId =
          typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (!host || !sessionId) {
          jsonResponse(response, 400, { error: "缺少主机或 Session ID" });
          return true;
        }
        if (body.confirmation !== `${host}:${sessionId}`) {
          jsonResponse(response, 400, { error: "关闭确认信息不匹配" });
          return true;
        }
        if (!appServerManager.isManaged(host, sessionId)) {
          jsonResponse(response, 409, {
            error:
              "只允许安全关闭 SCOPE 托管的 app-server Session；不会终止活动 tmux、CLI 或 VS Code 进程",
          });
          return true;
        }

        const originalWriter = await detectRemoteSessionWriter(host, sessionId);
        const closed = await appServerManager.stopSession(host, sessionId);
        const recoveryRecord = managementState.sessions[sessionKey(host, sessionId)]?.closedSession;
        if (recoveryRecord && originalWriter) recoveryRecord.connectionKey = originalWriter.connectionKey;
        await persistManagementState();
        await persistAppServerSessions();
        await auditLifecycle("app-server-session-stopped", {
          host,
          sessionId,
          interrupted: closed.interrupted,
          rolloutPreserved: true,
          remoteSessionSignalSent: false,
          sharedTransportClosed: false,
        });
        notifyClients();
        jsonResponse(response, 200, {
          ok: true,
          host,
          sessionId,
          stopped: closed.stopped,
          interrupted: closed.interrupted,
          rolloutPreserved: true,
        });
      } catch (error) {
        jsonResponse(response, 409, {
          error: `关闭 Session 失败：${error.message}`,
        });
      }
      return true;
    }

    if (
      url.pathname === "/api/tmux/session/terminate" &&
      request.method === "POST"
    ) {
      try {
        const snapshot = getSnapshot();
        const body = await readJsonBody(request);
        const hostAlias = typeof body.host === "string" ? body.host.trim() : "";
        const tmuxSession = normalizeTmuxSessionName(body.tmuxSession);
        if (!hostAlias) {
          jsonResponse(response, 400, { error: "缺少 SSH 主机" });
          return true;
        }
        if (body.confirmation !== `${hostAlias}:${tmuxSession}`) {
          jsonResponse(response, 400, { error: "终止确认信息不匹配" });
          return true;
        }

        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === hostAlias,
        );
        if (!host?.reachable) {
          jsonResponse(response, 409, { error: "所选 SSH 主机当前不可连接" });
          return true;
        }
        const matchingPanes = host.panes.filter(
          (pane) => pane.session === tmuxSession,
        );
        if (matchingPanes.length === 0) {
          jsonResponse(response, 409, {
            error: "当前扫描结果中没有这个 tmux Session；请刷新后重试",
          });
          return true;
        }

        const result = await runSshCommand(
          hostAlias,
          buildExactTmuxTerminateCommand(tmuxSession),
          "",
          15_000,
          100_000,
        );
        if (result.code !== 0) {
          const missing = result.code === 44 ||
            /SCOPE_TMUX_SESSION_MISSING/.test(result.stderr || result.stdout);
          jsonResponse(response, missing ? 409 : 502, {
            error: missing
              ? "该 tmux Session 已经不存在；请刷新列表"
              : `终止 tmux 失败：${cleanSshError(result.stderr || result.stdout)}`,
          });
          return true;
        }

        const terminatedSessionIds = host.agents
          .filter((agent) => agent.pane?.session === tmuxSession)
          .map((agent) => agent.rollout?.id)
          .filter(Boolean);
        host.panes = host.panes.filter((pane) => pane.session !== tmuxSession);
        host.agents = host.agents.filter(
          (agent) => agent.pane?.session !== tmuxSession,
        );
        setSnapshot({
          ...snapshot,
          generatedAt: new Date().toISOString(),
          summary: {
            ...snapshot.summary,
            codex: snapshot.hosts.reduce(
              (total, candidate) => total + candidate.agents.length,
              0,
            ),
            tmux: snapshot.hosts.reduce(
              (total, candidate) => total + candidate.panes.length,
              0,
            ),
          },
        });
        await auditLifecycle("tmux-session-terminated", {
          host: hostAlias,
          tmuxSession,
          paneCount: matchingPanes.length,
          sessionIds: terminatedSessionIds,
          rolloutPreserved: true,
          exactTarget: true,
        });
        persistSnapshotCache().catch(() => {});
        notifyClients();
        jsonResponse(response, 200, {
          ok: true,
          host: hostAlias,
          tmuxSession,
          paneCount: matchingPanes.length,
          sessionIds: terminatedSessionIds,
          rolloutPreserved: true,
        });
        setTimeout(() => scanAll({ hosts: [hostAlias] }).catch(() => {}), 700);
      } catch (error) {
        jsonResponse(response, 400, {
          error: `终止 tmux 失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/session/unarchive" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const host = typeof body.host === "string" ? body.host.trim() : "";
        const sessionId =
          typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        if (!host || !sessionId) {
          jsonResponse(response, 400, { error: "缺少主机或 Session ID" });
          return true;
        }
        if (body.confirmation !== `${host}:${sessionId}`) {
          jsonResponse(response, 400, { error: "恢复确认信息不匹配" });
          return true;
        }
        const agent = historicalSessions.get(sessionKey(host, sessionId));
        if (!agent?.rollout?.archived) {
          jsonResponse(response, 409, { error: "该 Session 不在归档日志中" });
          return true;
        }
        const thread = await appServerManager.unarchiveSession(
          host,
          sessionId,
          agent.executable || "codex",
        );
        revealUnarchivedSession(host, sessionId, thread);
        await persistHistoryIndex();
        await auditLifecycle("app-server-session-unarchived", {
          host,
          sessionId,
          rolloutPreserved: true,
          remoteSessionSignalSent: false,
        });
        notifyClients();
        jsonResponse(response, 200, {
          ok: true,
          host,
          sessionId,
          path: thread?.path || null,
        });
      } catch (error) {
        jsonResponse(response, 409, {
          error: `恢复 Session 日志失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/session/takeover" && request.method === "POST") {
      let jobKey = "";
      let releasedAppServerSession = null;
      try {
        const body = await readJsonBody(request);
        const activeAgent = findLiveAgent(body.host, body.sessionId);
        const historicalAgentRecord = historicalSessions.get(
          sessionKey(body.host, body.sessionId),
        );
        const agent = activeAgent || historicalAgentRecord;
        if (!agent?.rollout?.id || !agent.rollout.path) {
          jsonResponse(response, 404, {
            error: "未找到可接管的活动或历史 Session",
          });
          return true;
        }
        if (activeAgent && !activeAgent.appServerManaged) {
          jsonResponse(response, 409, {
            error:
              "安全策略禁止终止或接管活动 CLI/VS Code Session；请先让原 Session 正常退出，再从 Inactive 恢复",
          });
          return true;
        }
        if (activeAgent?.pane) {
          jsonResponse(response, 409, {
            error: `该 Session 已在 tmux ${activeAgent.pane.session} 中运行`,
          });
          return true;
        }
        if (
          activeAgent &&
          !activeAgent.appServerManaged &&
          activeAgent.mapping?.rollout !== "open-fd"
        ) {
          jsonResponse(response, 409, {
            error: "当前进程没有精确匹配 rollout FD，拒绝终止",
          });
          return true;
        }
        const requestedPid = Number(body.pid) || 0;
        if (
          activeAgent &&
          !activeAgent.appServerManaged &&
          requestedPid !== activeAgent.pid
        ) {
          jsonResponse(response, 409, {
            error: `页面 PID 已过期：请求 ${requestedPid}，当前 ${activeAgent.pid}`,
          });
          return true;
        }
        const resumedAgent = await recoveryAgent(agent, activeAgent, body.cwd);
        const requestedRuntime = hostRuntimeConfig(agent.host, {
          yolo:
            typeof body.yolo === "boolean"
              ? body.yolo
              : sessionYolo(
                  agent.rollout,
                  hostRuntimeConfig(agent.host).yolo,
                ),
        });

        jobKey = sessionKey(agent.host, agent.rollout.id);
        if (takeoverJobs.has(jobKey)) {
          jsonResponse(response, 409, { error: "该 Session 正在接管中" });
          return true;
        }
        takeoverJobs.add(jobKey);

        const wasAppServerManaged = appServerManager.isManaged(
          agent.host,
          agent.rollout.id,
        );
        if (wasAppServerManaged) {
          releasedAppServerSession = await appServerManager.releaseSession(
            agent.host,
            agent.rollout.id,
          );
        }
        let takeover;
        try {
          takeover = await resumeAgentInTmux(
            resumedAgent,
            0,
            releasedAppServerSession?.model || agent.rollout.model || "",
            {
              ...requestedRuntime,
              yolo:
                typeof body.yolo === "boolean"
                  ? body.yolo
                  : releasedAppServerSession?.yolo !== false &&
                      requestedRuntime.yolo,
            },
          );
        } catch (error) {
          if (releasedAppServerSession) {
            try {
              await resumeManagedAppServerSession({
                host: agent.host,
                sessionId: agent.rollout.id,
                path: agent.rollout.path,
                cwd: resumedAgent.cwd,
                model:
                  releasedAppServerSession.model || agent.rollout.model || null,
                effort:
                  releasedAppServerSession.effort ||
                  agent.rollout.reasoningEffort ||
                  null,
                yolo: releasedAppServerSession.yolo !== false,
                executable: agent.executable || "codex",
                connectionKey: releasedAppServerSession.connectionKey,
              });
              releasedAppServerSession = null;
            } catch (rollbackError) {
              throw new Error(
                `${error.message}；回滚 app-server 也失败：${rollbackError.message}`,
              );
            }
          }
          throw error;
        }
        rememberTmuxAgent(resumedAgent, takeover);
        jsonResponse(response, 200, {
          ...takeover,
          host: agent.host,
          transport: "tmux",
          switchedFrom: wasAppServerManaged ? "app-server" : "cli",
          mode: activeAgent ? "active" : "history",
          cwd: resumedAgent.cwd,
        });
        setTimeout(() => scanAll({ hosts: [agent.host] }).catch(() => {}), 700);
      } catch (error) {
        jsonResponse(response, error.statusCode || 502, {
          error: `一键接管失败：${error.message}`,
        });
      } finally {
        if (jobKey) takeoverJobs.delete(jobKey);
      }
      return true;
    }

    if (url.pathname === "/api/codex/upgrade" && ["GET", "POST"].includes(request.method)) {
      try {
        const snapshot = getSnapshot();
        const body = request.method === "POST" ? await readJsonBody(request) : null;
        const host = body?.host || url.searchParams.get("host");
        if (!host || !snapshot.hosts.some((h) => h.alias === host)) throw new Error("未知 SSH 主机");
        if (body) {
          if (!snapshot.hosts.some((h) => h.alias === host && h.reachable)) throw new Error("主机不可连接");
          if (body.action === "upgrade" && body.confirmation !== "upgrade:" + host) throw new Error("必须确认升级的目标主机");
          if (hostConfigRestarts.view(host)?.status === "running" || appServerAuthRecoveryHosts.has(host)) throw new Error("主机正在恢复或迁移账号");
          codexUpgrades.start(host, body.action);
        }
        jsonResponse(response, body ? 202 : 200, codexUpgrades.view(host));
      } catch (error) { jsonResponse(response, 409, { error: error.message }); }
      return true;
    }

    if (url.pathname === "/api/app-server/restart-host" && ["GET", "POST"].includes(request.method)) {
      try {
        const snapshot = getSnapshot();
        const body = request.method === "POST" ? await readJsonBody(request) : null;
        const host = body?.host || url.searchParams.get("host");
        if (!host || !snapshot.hosts.some((h) => h.alias === host)) throw new Error("未知 SSH 主机");
        if (body) {
          if (body.confirmation !== `restart:${host}`) throw new Error("必须确认目标主机以及当前回合影响");
          if (codexUpgrades.view(host)?.status === "running") throw new Error("Codex 升级正在进行，请在主机设置查看进度");
          hostConfigRestarts.start(host);
        }
        jsonResponse(response, body ? 202 : 200, hostConfigRestarts.view(host));
      } catch (error) { jsonResponse(response, 409, { error: error.message }); }
      return true;
    }

    if (
      url.pathname === "/api/app-server/recover-host" &&
      request.method === "POST"
    ) {
      try {
        const body = await readJsonBody(request);
        if (sessionProfileAssignment(body.host, body.sessionId)?.desiredProfile) {
          throw new Error("此会话已固定 Profile，请使用 App Server 恢复；tmux 尚不支持会话级账号隔离");
        }
        const host = typeof body.host === "string" ? body.host.trim() : "";
        if (!host || body.confirmation !== host) {
          jsonResponse(response, 400, {
            error: "必须明确确认目标主机名后才能恢复主机 Session",
          });
          return true;
        }
        const result = await recoverHostAppServerSessions(host);
        jsonResponse(response, result.ok ? 200 : 207, result);
      } catch (error) {
        jsonResponse(response, error.statusCode || 502, {
          error: `恢复主机 Session 失败：${error.message}`,
        });
      }
      return true;
    }

    if (
      url.pathname === "/api/app-server/recover-auth-failures" &&
      request.method === "POST"
    ) {
      try {
        const body = await readJsonBody(request);
        const host = typeof body.host === "string" ? body.host.trim() : "";
        if (!host || body.confirmation !== host) {
          jsonResponse(response, 400, {
            error: "必须明确确认目标主机名后才能恢复认证中断的 Session",
          });
          return true;
        }
        const sessionIds = Array.isArray(body.sessionIds)
          ? body.sessionIds.slice(0, 100)
          : [];
        if (!sessionIds.length) {
          jsonResponse(response, 400, { error: "没有指定需要恢复的 Session" });
          return true;
        }
        const result = await recoverAuthenticationFailedSessions(host, { sessionIds });
        jsonResponse(response, result.ok ? 200 : 207, result);
      } catch (error) {
        jsonResponse(response, error.statusCode || 502, {
          error: `恢复认证中断的 Session 失败：${error.message}`,
        });
      }
      return true;
    }

    if (
      url.pathname === "/api/app-server/connect" &&
      request.method === "POST"
    ) {
      let jobKey = "";
      try {
        const managementState = getManagementState();
        const body = await readJsonBody(request);
        const activeAgent = findLiveAgent(body.host, body.sessionId);
        const historicalAgentRecord = historicalSessions.get(
          sessionKey(body.host, body.sessionId),
        );
        const closedRecord = managementState.sessions[sessionKey(body.host, body.sessionId)]?.closedSession;
        const agent = activeAgent || historicalAgentRecord || (closedRecord && {
          host: closedRecord.host, cwd: closedRecord.cwd, executable: closedRecord.executable,
          appServerManaged: true, rollout: { id: closedRecord.sessionId, path: closedRecord.path,
            model: closedRecord.model, reasoningEffort: closedRecord.effort },
        });
        if (!agent?.rollout?.id || !agent.rollout.path) {
          jsonResponse(response, 404, {
            error: "未找到可接入 app-server 的活动或历史 Session",
          });
          return true;
        }
        if (activeAgent && !activeAgent.appServerManaged) {
          jsonResponse(response, 409, {
            error:
              "安全策略禁止终止或接管活动 CLI/VS Code Session；请先让原 Session 正常退出，再从 Inactive 恢复",
          });
          return true;
        }
        if (appServerManager.isConnected(agent.host, agent.rollout.id)) {
          jsonResponse(response, 200, {
            ok: true,
            alreadyConnected: true,
            host: agent.host,
            sessionId: agent.rollout.id,
          });
          return true;
        }
        if (
          activeAgent &&
          !activeAgent.appServerManaged &&
          activeAgent.mapping?.rollout !== "open-fd"
        ) {
          jsonResponse(response, 409, {
            error: "当前进程没有精确匹配 rollout FD，拒绝终止",
          });
          return true;
        }
        const requestedPid = Number(body.pid) || 0;
        if (
          activeAgent &&
          !activeAgent.appServerManaged &&
          requestedPid !== activeAgent.pid
        ) {
          jsonResponse(response, 409, {
            error: `页面 PID 已过期：请求 ${requestedPid}，当前 ${activeAgent.pid}`,
          });
          return true;
        }
        const resumedAgent = await recoveryAgent(agent, activeAgent, body.cwd);
        const requestedYolo =
          typeof body.yolo === "boolean"
            ? body.yolo
            : sessionYolo(
                agent.rollout,
                hostRuntimeConfig(agent.host).yolo,
              );

        jobKey = sessionKey(agent.host, agent.rollout.id);
        if (appServerJobs.has(jobKey)) {
          jsonResponse(response, 409, {
            error: "该 Session 正在切换到 app-server",
          });
          return true;
        }
        appServerJobs.add(jobKey);

        const originalWriter = closedRecord?.connectionKey
          ? { connectionKey: closedRecord.connectionKey }
          : await detectRemoteSessionWriter(agent.host, agent.rollout.id);
        const recoveryConnectionKey = originalWriter?.connectionKey || await newSessionConnectionKey(agent.host);
        // Reconnect the original SCOPE writer without killing it or scanning every FD.
        await appServerManager.prepareHost(
          resumedAgent.host,
          codexExecutable(resumedAgent.executable),
          recoveryConnectionKey,
        );

        let handoff = { killedPid: null, forced: false };
        if (!agent.appServerManaged && !originalWriter) {
          const pid = 0;
          const command = [
            "python3 -",
            shellQuote(String(pid)),
            shellQuote(resumedAgent.rollout.path),
            shellQuote(resumedAgent.cwd || "."),
          ].join(" ");
          const result = await runSshCommand(
            agent.host,
            command,
            APP_SERVER_HANDOFF_PROBE,
            TAKEOVER_TIMEOUT_MS,
            1_000_000,
          );
          if (result.code !== 0) {
            throw new Error(cleanSshError(result.stderr || result.stdout));
          }
          try {
            handoff = JSON.parse(result.stdout.trim());
          } catch {
            throw new Error("远端 app-server 接管校验结果无法解析");
          }
        }

        const session = await resumeManagedAppServerSession({
          host: resumedAgent.host,
          connectionKey: recoveryConnectionKey,
          sessionId: resumedAgent.rollout.id,
          path: resumedAgent.rollout.path,
          cwd: resumedAgent.cwd,
          model: resumedAgent.rollout.model || null,
          effort: resumedAgent.rollout.reasoningEffort || null,
          yolo: requestedYolo,
          executable: codexExecutable(resumedAgent.executable),
        });
        appServerRestoreFailures.delete(jobKey);
        jsonResponse(response, 200, {
          ok: true,
          alreadyConnected: false,
          ...handoff,
          session,
          mode: activeAgent ? "active" : "history",
          cwd: resumedAgent.cwd,
        });
        setTimeout(() => scanAll({ hosts: [agent.host] }).catch(() => {}), 700);
      } catch (error) {
        jsonResponse(response, error.statusCode || 502, {
          error: `切换到 app-server 失败：${error.message}`,
        });
      } finally {
        if (jobKey) appServerJobs.delete(jobKey);
      }
      return true;
    }

    if (
      url.pathname === "/api/app-server/respond" &&
      request.method === "POST"
    ) {
      try {
        const body = await readJsonBody(request);
        if (typeof body.key !== "string" || !body.key) {
          jsonResponse(response, 400, { error: "缺少待回答问题 key" });
          return true;
        }
        const result = await appServerManager.answerHumanRequest(
          body.key,
          body.response || { answers: body.answers },
        );
        jsonResponse(response, 200, { ok: true, ...result });
      } catch (error) {
        jsonResponse(response, 409, { error: error.message });
      }
      return true;
    }

    if (url.pathname === "/api/events" && request.method === "GET") {
      if (snapshotSyncStore.info().revision === 0) publishSnapshotSync();
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      const client = {
        response,
        blocked: false,
        pending: null,
        onDrain: null,
      };
      clients.set(response, client);
      writeEventClient(client, snapshotInvalidationPayload());
      request.once("close", () => removeEventClient(response));
      return true;
    }

    return false;
  };
}
