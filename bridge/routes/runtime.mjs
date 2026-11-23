/** Domain routes. Context is read per request so replaced snapshot state stays current. */
export function runtimeRoutes(context) {
  return async (request, response, url) => {
    const {
      hostRuntimeConfig,
      jsonResponse,
      readJsonBody,
      saveHostRuntimeConfig,
      snapshot,
    } = context();
    if (url.pathname === "/api/runtime/config" && request.method === "GET") {
      const host = String(url.searchParams.get("host") || "").trim();
      if (host) {
        jsonResponse(response, 200, { host, config: hostRuntimeConfig(host) });
      } else {
        jsonResponse(response, 200, {
          hosts: Object.fromEntries(
            snapshot.hosts.map((candidate) => [
              candidate.alias,
              hostRuntimeConfig(candidate.alias),
            ]),
          ),
        });
      }
      return true;
    }

    if (url.pathname === "/api/runtime/config" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const host = String(body.host || "")
          .trim()
          .slice(0, 200);
        if (
          !host ||
          !snapshot.hosts.some((candidate) => candidate.alias === host)
        ) {
          jsonResponse(response, 404, { error: "找不到对应 SSH 主机" });
          return true;
        }
        let residentSessionLimit;
        if (body.residentSessionLimit !== undefined) {
          if (body.residentSessionLimit === null || body.residentSessionLimit === "") {
            residentSessionLimit = null;
          } else {
            const parsed =
              typeof body.residentSessionLimit === "number"
                ? body.residentSessionLimit
                : Number(String(body.residentSessionLimit).trim());
            if (!Number.isInteger(parsed) || parsed < 0 || parsed > 64) {
              jsonResponse(response, 400, {
                error: "常驻会话池大小必须是 0 到 64 的整数，或留空跟随全局设置",
              });
              return true;
            }
            residentSessionLimit = parsed;
          }
        }
        const config = await saveHostRuntimeConfig(host, {
          preLaunchCommand: body.preLaunchCommand,
          yolo: body.yolo,
          ...(residentSessionLimit !== undefined ? { residentSessionLimit } : {}),
        });
        jsonResponse(response, 200, {
          ok: true,
          host,
          config,
          activeProcessesChanged: false,
        });
      } catch (error) {
        jsonResponse(response, 400, {
          error: `保存主机启动配置失败：${error.message}`,
        });
      }
      return true;
    }
    return false;
  };
}
