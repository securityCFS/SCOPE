import { LOCAL_HOST } from "../../lib/execution-host.js";

/** Domain routes. Context is read per request so replaced snapshot state stays current. */
export function authRoutes(context) {
  return async (request, response, url) => {
    const {
      accountQuotas,
      appServerActiveAuthFailoverJobs,
      assertProfileNotBound,
      auditLifecycle,
      authProfileManager,
      authRestartJobs,
      checkedProfileSlug,
      deleteAuthProfile,
      hostCodexExecutable,
      jsonResponse,
      latestAuthRestartJob,
      listAuthProfiles,
      normalizeProfileName,
      publicAuthRestartJob,
      publicProfileFailoverJob,
      readJsonBody,
      readLocalAuthProfiles,
      runProfileWrite,
      snapshot,
      startAuthRestart,
    } = context();
    if (url.pathname === "/api/auth/profiles" && request.method === "GET") {
      try {
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === url.searchParams.get("host"),
        );
        if (!host?.reachable) {
          jsonResponse(response, 404, { error: "所选 SSH 主机当前不可连接" });
          return true;
        }
        const runningSessions = host.agents.filter(
          (agent) => agent.rollout?.id && !agent.rollout.isSubagent,
        ).length;
        if (host.alias === LOCAL_HOST) {
          const localProfiles = await readLocalAuthProfiles();
          jsonResponse(response, 200, {
            ...localProfiles,
            host: host.alias,
            runningSessions,
          });
          return true;
        }
        const profiles = await listAuthProfiles(host.alias);
        jsonResponse(response, 200, {
          host: host.alias,
          ...profiles,
          runningSessions,
          restartJob: latestAuthRestartJob(host.alias)
            ? publicAuthRestartJob(latestAuthRestartJob(host.alias))
            : null,
          automaticFailover: publicProfileFailoverJob(
            appServerActiveAuthFailoverJobs.get(host.alias),
          ),
        });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `读取账号 Profiles 失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/auth/quota" && request.method === "GET") {
      try {
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === url.searchParams.get("host"),
        );
        if (!host?.reachable) {
          jsonResponse(response, 404, { error: "所选 SSH 主机当前不可连接" });
          return true;
        }
        const force = url.searchParams.get("refresh") === "1";
        if (url.searchParams.get("all") === "1") {
          const quotas = await accountQuotas.readHostQuotas(host.alias, { force });
          jsonResponse(response, 200, quotas);
        } else {
          const connectionKey = url.searchParams.get("connectionKey") || "active";
          const single = await accountQuotas.readSingleQuota(host.alias, {
            connectionKey,
            force,
          });
          jsonResponse(response, 200, single);
        }
      } catch (error) {
        jsonResponse(response, 502, {
          error: `读取账号额度失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/auth/providers" && request.method === "GET") {
      try {
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === url.searchParams.get("host"),
        );
        if (!host?.reachable) {
          jsonResponse(response, 404, { error: "所选 SSH 主机当前不可连接" });
          return true;
        }
        const force = url.searchParams.get("refresh") === "1";
        jsonResponse(
          response,
          200,
          await accountQuotas.readProviderAuthStatuses(host.alias, { force }),
        );
      } catch (error) {
        jsonResponse(response, 502, {
          error: `读取 Agent 登录状态失败：${error.message}`,
        });
      }
      return true;
    }

    if (
      url.pathname === "/api/auth/profiles/save" &&
      request.method === "POST"
    ) {
      try {
        const body = await readJsonBody(request);
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === body.host,
        );
        if (!host?.reachable) throw new Error("所选 SSH 主机当前不可连接");
        const profile = normalizeProfileName(body.profileName);
        assertProfileNotBound(host.alias, profile.slug);
        const account =
          (await listAuthProfiles(host.alias)).currentAccount || null;
        await runProfileWrite(host.alias, "save-current", profile, account);
        jsonResponse(response, 201, {
          ok: true,
          host: host.alias,
          profile,
          account,
        });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `保存当前账号失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/auth/login/start" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === body.host,
        );
        if (!host?.reachable) throw new Error("所选 SSH 主机当前不可连接");
        assertProfileNotBound(
          host.alias,
          normalizeProfileName(body.profileName).slug,
        );
        const job = await authProfileManager.start({
          host: host.alias,
          executable: hostCodexExecutable(host),
          profileName: body.profileName,
        });
        jsonResponse(response, 201, job);
      } catch (error) {
        jsonResponse(response, 502, {
          error: `启动 device auth 失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/auth/login/status" && request.method === "GET") {
      const job = authProfileManager.get(url.searchParams.get("jobId"));
      jsonResponse(
        response,
        job ? 200 : 404,
        job || { error: "找不到这条登录任务；Bridge 重启后请重新发起登录" },
      );
      return true;
    }

    if (
      url.pathname === "/api/auth/login/cancel" &&
      request.method === "POST"
    ) {
      try {
        const body = await readJsonBody(request);
        jsonResponse(
          response,
          200,
          await authProfileManager.cancel(body.jobId),
        );
      } catch (error) {
        jsonResponse(response, 404, { error: error.message });
      }
      return true;
    }

    if (
      url.pathname === "/api/auth/profiles/activate" &&
      request.method === "POST"
    ) {
      try {
        const body = await readJsonBody(request);
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === body.host,
        );
        if (!host?.reachable) throw new Error("所选 SSH 主机当前不可连接");
        const slug = checkedProfileSlug(body.slug);
        const profile = { slug, name: String(body.name || slug).slice(0, 80) };
        // Account metadata already lives beside the remote profile. Never accept
        // credential-shaped data echoed back by the browser.
        await runProfileWrite(host.alias, "select-default", profile, null);
        await auditLifecycle("host-default-profile-selected", {
          host: host.alias,
          profile: slug,
          existingSessionsUnchanged: true,
          remoteSessionSignalSent: false,
        });
        const runningSessions = host.agents.filter(
          (agent) => agent.rollout?.id && !agent.rollout.isSubagent,
        ).length;
        jsonResponse(response, 200, {
          ok: true,
          host: host.alias,
          activeProfile: slug,
          runningSessions,
          restartRequired: false,
        });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `切换账号失败：${error.message}`,
        });
      }
      return true;
    }

    if (
      url.pathname === "/api/auth/profiles/delete" &&
      request.method === "POST"
    ) {
      try {
        const body = await readJsonBody(request);
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === body.host,
        );
        if (!host?.reachable) throw new Error("所选 SSH 主机当前不可连接");
        const slug = checkedProfileSlug(body.slug);
        if (body.confirmation !== `${host.alias}:${slug}`) {
          jsonResponse(response, 400, {
            error: "删除确认与目标主机/Profile 不匹配",
          });
          return true;
        }
        assertProfileNotBound(host.alias, slug);
        const profiles = await listAuthProfiles(host.alias);
        const profile = profiles.profiles.find(
          (candidate) => candidate.slug === slug,
        );
        if (!profile) {
          jsonResponse(response, 404, { error: "Profile 不存在或已经删除" });
          return true;
        }
        if (profile.active || profiles.activeProfile === slug) {
          jsonResponse(response, 409, {
            error: "当前正在使用的 Profile 不能删除；请先切换到另一套账号",
          });
          return true;
        }
        const cancelledLoginJobs = await authProfileManager.cancelForProfile(
          host.alias,
          slug,
        );
        await deleteAuthProfile(host.alias, slug);
        jsonResponse(response, 200, {
          ok: true,
          host: host.alias,
          slug,
          removed: true,
          cancelledLoginJobs,
        });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `删除 Profile 失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/auth/restart" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const host = typeof body.host === "string" ? body.host : "";
        if (!host || body.confirmation !== host) {
          jsonResponse(response, 400, {
            error: "必须明确确认目标主机名后才能重启会话",
          });
          return true;
        }
        jsonResponse(response, 202, startAuthRestart(host));
      } catch (error) {
        jsonResponse(response, 502, {
          error: `启动批量重启失败：${error.message}`,
        });
      }
      return true;
    }

    if (
      url.pathname === "/api/auth/restart/status" &&
      request.method === "GET"
    ) {
      const job = authRestartJobs.get(url.searchParams.get("jobId"));
      jsonResponse(
        response,
        job ? 200 : 404,
        job ? publicAuthRestartJob(job) : { error: "找不到这条重启任务" },
      );
      return true;
    }
    return false;
  };
}
