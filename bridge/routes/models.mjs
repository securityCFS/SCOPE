import { LOCAL_HOST } from "../../lib/execution-host.js";
/** Domain routes. Context is read per request so replaced snapshot state stays current. */
export function modelRoutes(context) {
  return async (request, response, url) => {
    const {
      appServerManager,
      auditLifecycle,
      checkedProfileSlug,
      findAgent,
      hostRuntimeConfig,
      jsonResponse,
      listAuthProfiles,
      persistAppServerSessions,
      readInstalledModels,
      readJsonBody,
      selectTmuxModel,
      sessionProfileAssignment,
      sessionProfiles,
      sessionYolo,
      snapshot,
    } = context();
    if (url.pathname === "/api/models" && request.method === "GET") {
      try {
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === url.searchParams.get("host"),
        );
        if (!host?.reachable) {
          jsonResponse(response, 404, { error: "所选 SSH 主机当前不可连接" });
          return true;
        }
        const managedSession = appServerManager
          .sessionRecords()
          .find(
            (s) =>
              s.host === host.alias &&
              s.sessionId === url.searchParams.get("sessionId"),
          );
        const catalog = await readInstalledModels(
          host,
          url.searchParams.get("refresh") === "1",
          managedSession?.connectionKey || "active",
        );
        jsonResponse(response, 200, { host: host.alias, ...catalog });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `读取模型目录失败：${error.message}`,
        });
      }
      return true;
    }

    if (
      url.pathname === "/api/session/profile" &&
      ["GET", "POST"].includes(request.method)
    ) {
      try {
        const body =
          request.method === "POST"
            ? await readJsonBody(request)
            : Object.fromEntries(url.searchParams);
        const host = snapshot.hosts.find((h) => h.alias === body.host);
        if (!host?.reachable) throw new Error("所选 SSH 主机当前不可连接");
        const session = appServerManager
          .sessionRecords()
          .find((s) => s.host === body.host && s.sessionId === body.sessionId);
        if (!session) throw new Error("请先将这个 Session 恢复到 App Server");
        if (request.method === "POST") {
          if (body.host === LOCAL_HOST) throw new Error("本机会话沿用本机 Codex 登录；远端 Profile 切换不适用于本机");
          const assignment =
            body.action === "cancel"
              ? await sessionProfiles.cancel(body.host, body.sessionId)
              : await sessionProfiles.assign(
                  body.host,
                  body.sessionId,
                  checkedProfileSlug(body.slug),
                );
          await persistAppServerSessions();
          await auditLifecycle("session-profile-assigned", {
            host: body.host,
            sessionId: body.sessionId,
            profile: assignment?.desiredProfile || null,
            status: assignment?.status || "cancelled",
            remoteSessionSignalSent: false,
          });
          jsonResponse(response, 200, { assignment });
        } else {
          const profiles = await listAuthProfiles(body.host);
          let account = null;
          let accountError = null;
          let rateLimits = null;
          if (appServerManager.isConnected(body.host, body.sessionId)) {
            try {
              [{ account }, rateLimits] = await Promise.all([
                appServerManager.getAccount(
                  body.host,
                  session.executable,
                  session.connectionKey,
                ),
                appServerManager
                  .getRateLimits(
                    body.host,
                    session.executable,
                    session.connectionKey,
                  )
                  .catch(() => null),
              ]);
            } catch (error) {
              accountError = error.message;
            }
          }
          jsonResponse(response, 200, {
            profiles: profiles.profiles,
            activeProfile: profiles.activeProfile,
            assignment: sessionProfileAssignment(body.host, body.sessionId),
            account,
            accountError,
            rateLimits,
            connectionKey: session.connectionKey,
          });
        }
      } catch (error) {
        jsonResponse(response, 409, { error: error.message });
      }
      return true;
    }

    if (url.pathname === "/api/session/model" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const agent = body.sessionId ? findAgent(body.host, body.sessionId)
          : snapshot.hosts.find((host) => host.alias === body.host)?.agents.find((item) => item.id === body.agentId && item.pane);
        const model =
          typeof body.model === "string" ? body.model.trim().slice(0, 200) : "";
        const effort =
          typeof body.effort === "string"
            ? body.effort.trim().slice(0, 40)
            : "";
        const yolo =
          typeof body.yolo === "boolean"
            ? body.yolo
            : sessionYolo(agent?.rollout, hostRuntimeConfig(body.host).yolo);
        if (!agent || (!agent.rollout?.id && !agent.pane) || !model) {
          jsonResponse(response, 404, {
            error: "找不到对应 Session 或模型为空",
          });
          return true;
        }
        if (
          agent.status === "working" &&
          !appServerManager.isConnected(body.host, body.sessionId)
        ) {
          jsonResponse(response, 409, {
            error: "该 Session 正在执行 turn，请在本轮结束后切换模型",
          });
          return true;
        }
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === agent.host,
        );
        const managedSession = appServerManager
          .sessionRecords()
          .find((s) => s.host === body.host && s.sessionId === body.sessionId);
        const { models } = await readInstalledModels(
          host,
          false,
          managedSession?.connectionKey || "active",
        );
        const selectedModel = models.find(
          (candidate) => candidate.id === model,
        );
        if (!selectedModel) {
          jsonResponse(response, 400, {
            error: `模型 ${model} 不在该主机当前账号的可用目录中`,
          });
          return true;
        }
        const supportedEfforts = selectedModel.supportedReasoningEfforts || [];
        if (supportedEfforts.length && !supportedEfforts.includes(effort)) {
          jsonResponse(response, 400, {
            error: `推理强度 ${effort || "（空）"} 不受模型 ${model} 支持`,
          });
          return true;
        }
        if (agent.rollout?.id && appServerManager.isConnected(agent.host, agent.rollout.id)) {
          const session = await appServerManager.setSessionModel(
            agent.host,
            agent.rollout.id,
            model,
            effort,
            yolo,
          );
          jsonResponse(response, 200, {
            ok: true,
            transport: "app-server",
            model: session.model,
            effort: session.effort,
            yolo: session.yolo,
            deferred: session.deferred,
            verified: true,
          });
        } else if (agent.pane) {
          if (typeof body.yolo === "boolean" && yolo !== sessionYolo(agent.rollout, true)) {
            jsonResponse(response, 409, {
              error:
                "tmux Session 的执行策略只能在恢复时修改；App Server 可立即切换",
            });
            return true;
          }
          const result = await selectTmuxModel(
            agent,
            selectedModel,
            models,
            effort,
          );
          jsonResponse(response, 200, {
            ok: true,
            transport: "tmux",
            ...result,
          });
        } else {
          jsonResponse(response, 409, {
            error:
              "该外部 Session 尚未接入 tmux/app-server，无法安全发送 /model",
          });
        }
      } catch (error) {
        jsonResponse(response, 502, {
          error: `切换模型失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/host/model" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === body.host,
        );
        if (!host?.reachable) throw new Error("所选 SSH 主机当前不可连接");
        const { models } = await readInstalledModels(host, true);
        const selected = models.find((model) => model.id === body.model);
        if (!selected)
          throw new Error("模型不在该主机当前账号的可用目录中，请刷新模型列表");
        const effort =
          typeof body.effort === "string" ? body.effort.trim() : "";
        if (effort && !selected.supportedReasoningEfforts.includes(effort)) {
          throw new Error(`模型 ${selected.id} 不支持推理强度 ${effort}`);
        }
        const results = await appServerManager.setHostModel(
          host.alias,
          selected,
          effort,
        );
        const managed = new Set(results.map((result) => result.sessionId));
        for (const agent of host.agents || []) {
          const sessionId = agent.rollout?.id;
          if (!sessionId || agent.rollout.isSubagent || managed.has(sessionId))
            continue;
          managed.add(sessionId);
          if (!agent.pane || agent.status === "working") {
            results.push({
              sessionId,
              status: "skipped",
              reason: agent.pane
                ? "tmux 正在执行，本轮结束后可再次批量应用"
                : "外部 CLI 未接管",
            });
            continue;
          }
          try {
            const nextEffort =
              effort ||
              (selected.supportedReasoningEfforts.includes(
                agent.rollout.reasoningEffort,
              )
                ? agent.rollout.reasoningEffort
                : selected.defaultReasoningEffort);
            await selectTmuxModel(agent, selected, models, nextEffort);
            results.push({
              sessionId,
              transport: "tmux",
              status: "applied",
              effort: nextEffort,
            });
          } catch (error) {
            results.push({ sessionId, status: "failed", error: error.message });
          }
        }
        await persistAppServerSessions();
        await auditLifecycle("host-model-changed", {
          host: host.alias,
          model: selected.id,
          results,
          remoteSessionSignalSent: false,
        });
        jsonResponse(response, 200, {
          ok: results.every((result) => result.status !== "failed"),
          host: host.alias,
          model: selected.id,
          results,
        });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `主机模型切换失败：${error.message}`,
        });
      }
      return true;
    }
    return false;
  };
}
