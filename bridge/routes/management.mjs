import { normalizeProjects, projectIdentity } from "../../lib/projects.js";

/** Project pinning, session metadata/reservation, resource policy, summaries, W&B, and research search routes. */
export function managementRoutes(context) {
  const summaryJobs = new Map();
  let assistantQueryPromise = null;

  return async (request, response, url) => {
    const {
      appServerManager,
      discoverWandbRuns,
      findAgent,
      generateCodexSummary,
      getManagementState,
      jsonResponse,
      notifyClients,
      persistManagementState,
      readJsonBody,
      searchAssistantSessions,
      sessionKey,
      setManagementState,
    } = context();

    if (url.pathname === "/api/projects" && request.method === "POST") {
      try {
        const managementState = getManagementState();
        const body = await readJsonBody(request);
        const identity = projectIdentity(body.host, body.cwd);
        if (!identity || !["pin", "unpin"].includes(body.action)) {
          jsonResponse(response, 400, { error: "请提供主机、远端绝对目录和有效操作" });
          return true;
        }
        const projects = normalizeProjects(managementState.projects);
        const remaining = projects.filter((project) => projectIdentity(project.host, project.cwd).key !== identity.key);
        const nextState = {
          ...managementState,
          projects: body.action === "pin"
            ? projects.length === remaining.length
              ? [...projects, { host: identity.host, cwd: identity.cwd, name: "" }]
              : projects
            : remaining,
        };
        setManagementState(nextState);
        await persistManagementState();
        notifyClients();
        jsonResponse(response, 200, { ok: true, projects: nextState.projects });
      } catch (error) {
        jsonResponse(response, 400, { error: error.message });
      }
      return true;
    }

    if (url.pathname === "/api/session" && request.method === "POST") {
      try {
        const managementState = getManagementState();
        const body = await readJsonBody(request);
        const agent = findAgent(body.host, body.sessionId);
        const connectedSession = appServerManager.sessions.get(
          sessionKey(body.host, body.sessionId),
        );
        if (!agent && !connectedSession) {
          jsonResponse(response, 404, { error: "未找到这条活动 Codex session" });
          return true;
        }
        const key = sessionKey(body.host, body.sessionId);
        const current = managementState.sessions[key] || {};
        const next = { ...current };
        if (body.priority !== undefined) {
          if (!["P0", "P1", "P2", "P3", "paused"].includes(body.priority)) {
            jsonResponse(response, 400, { error: "优先级必须是 P0/P1/P2/P3/paused" });
            return true;
          }
          next.priority = body.priority;
          next.priorityUpdatedAt = new Date().toISOString();
        }
        if (typeof body.theme === "string") {
          const displayName =
            body.theme.trim().slice(0, 40) ||
            agent?.suggestedSummary?.theme ||
            body.sessionId;
          next.displayName = displayName;
          next.displayNameUpdatedAt = new Date().toISOString();
          next.summary = {
            ...(current.summary || agent?.suggestedSummary || {}),
            theme: displayName,
            source: "manual",
            updatedAt: new Date().toISOString(),
          };
        }
        if (body.reserved !== undefined) {
          if (typeof body.reserved !== "boolean") {
            jsonResponse(response, 400, { error: "reserved 必须是布尔值" });
            return true;
          }
          next.reserved = body.reserved;
          next.reservedUpdatedAt = new Date().toISOString();
        }
        setManagementState({
          ...managementState,
          sessions: { ...managementState.sessions, [key]: next },
        });
        await persistManagementState();
        notifyClients();
        jsonResponse(response, 200, { ok: true, record: next });
      } catch (error) {
        jsonResponse(response, 400, { error: error.message });
      }
      return true;
    }

    if (url.pathname === "/api/resource-policy" && request.method === "POST") {
      try {
        const managementState = getManagementState();
        const body = await readJsonBody(request);
        if (typeof body.prompt !== "string") {
          jsonResponse(response, 400, { error: "prompt 必须是字符串" });
          return true;
        }
        const nextState = {
          ...managementState,
          resourcePolicy: {
            prompt: body.prompt.trim().slice(0, 6000),
            updatedAt: new Date().toISOString(),
            version: managementState.resourcePolicy.version + 1,
          },
        };
        setManagementState(nextState);
        await persistManagementState();
        notifyClients();
        jsonResponse(response, 200, {
          ok: true,
          resourcePolicy: nextState.resourcePolicy,
        });
      } catch (error) {
        jsonResponse(response, 400, { error: error.message });
      }
      return true;
    }

    if (url.pathname === "/api/assistant/query" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const question =
          typeof body.question === "string" ? body.question.trim() : "";
        if (question.length < 2) {
          jsonResponse(response, 400, { error: "请至少输入两个字符的问题" });
          return true;
        }
        if (question.length > 800) {
          jsonResponse(response, 400, { error: "问题不能超过 800 个字符" });
          return true;
        }
        if (assistantQueryPromise) {
          jsonResponse(response, 409, {
            error: "科研检索助手正在回答上一条问题，请稍候",
          });
          return true;
        }
        assistantQueryPromise = searchAssistantSessions(question).finally(() => {
          assistantQueryPromise = null;
        });
        const result = await assistantQueryPromise;
        jsonResponse(response, 200, {
          ok: true,
          question,
          ...result,
        });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `科研检索失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/summarize" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const agent = findAgent(body.host, body.sessionId);
        if (!agent?.rollout) {
          jsonResponse(response, 404, { error: "未找到可摘要的活动 rollout" });
          return true;
        }
        const key = sessionKey(body.host, body.sessionId);
        let job = summaryJobs.get(key);
        if (!job) {
          job = generateCodexSummary(agent).finally(() => summaryJobs.delete(key));
          summaryJobs.set(key, job);
        }
        const summary = await job;
        const managementState = getManagementState();
        const current = managementState.sessions[key] || {};
        const displayName =
          current.displayName ||
          (current.summary?.source === "manual"
            ? current.summary.theme
            : undefined);
        setManagementState({
          ...managementState,
          sessions: {
            ...managementState.sessions,
            [key]: {
              ...current,
              ...(displayName
                ? {
                    displayName,
                    displayNameUpdatedAt:
                      current.displayNameUpdatedAt ||
                      current.summary?.updatedAt ||
                      new Date().toISOString(),
                  }
                : {}),
              summary,
            },
          },
        });
        await persistManagementState();
        notifyClients();
        jsonResponse(response, 200, { ok: true, summary });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `Codex 摘要失败：${error.message}`,
        });
      }
      return true;
    }

    if (
      url.pathname === "/api/experiments/discover" &&
      request.method === "POST"
    ) {
      try {
        const body = await readJsonBody(request);
        const agent = findAgent(body.host, body.sessionId);
        if (!agent?.rollout) {
          jsonResponse(response, 404, { error: "未找到对应的活动 rollout" });
          return true;
        }
        const runs = await discoverWandbRuns(agent);
        const managementState = getManagementState();
        const key = sessionKey(body.host, body.sessionId);
        const current = managementState.sessions[key] || {};
        const experiments = {
          source: "wandb-local",
          discoveredAt: new Date().toISOString(),
          root: agent.cwd,
          runs,
        };
        setManagementState({
          ...managementState,
          sessions: {
            ...managementState.sessions,
            [key]: { ...current, experiments },
          },
        });
        await persistManagementState();
        notifyClients();
        jsonResponse(response, 200, { ok: true, experiments });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `W&B 扫描失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/operator" && request.method === "POST") {
      try {
        const managementState = getManagementState();
        const body = await readJsonBody(request);
        const operatorName =
          typeof body.name === "string"
            ? body.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40)
            : "";
        if (!operatorName) {
          jsonResponse(response, 400, { error: "名称不能为空" });
          return true;
        }
        setManagementState({ ...managementState, operatorName });
        await persistManagementState();
        notifyClients();
        jsonResponse(response, 200, { ok: true, operatorName });
      } catch (error) {
        jsonResponse(response, 400, { error: error.message });
      }
      return true;
    }

    return false;
  };
}
