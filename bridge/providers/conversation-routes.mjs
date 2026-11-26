export function cliConversationRoutes(service, { readJsonBody, jsonResponse, models, commands }) {
  return async (request, response, url) => {
    if (!url.pathname.startsWith("/api/cli-conversations")) return false;
    try {
      response.setHeader("Cache-Control", "no-store");
      if (url.pathname === "/api/cli-conversations/commands" && request.method === "GET") {
        const {host,provider,cwd} = Object.fromEntries(url.searchParams);
        const session = provider === "antigravity" && [...service.sessions.values()].find(s => s.host === host && s.cwd === cwd && Array.isArray(s.commands));
        jsonResponse(response, 200, provider === "antigravity"
          ? { commands: session?.commands || [], ...(!session ? {notice:"AGY 首轮连接后显示原生命令与技能；也可直接输入已有命令，由原生协议校验。"} : {}) }
          : {commands: await commands.list(host, provider, cwd, url.searchParams.get("refresh") === "1")});
      } else if (url.pathname === "/api/cli-conversations/models" && request.method === "GET") {
        jsonResponse(response, 200, {
          models: await models.list(
            url.searchParams.get("host"),
            url.searchParams.get("provider"),
            url.searchParams.get("refresh") === "1",
            { agyProfile: url.searchParams.get("agyProfile") || "" },
          ),
        });
      } else if (url.pathname === "/api/cli-conversations" && request.method === "GET") {
        const key = url.searchParams.get("key");
        const result = key ? await service.read(key) : { entries: service.entries() };
        jsonResponse(response, result ? 200 : 404, result || { error: "会话不存在" });
      } else if (url.pathname === "/api/cli-conversations/control" && request.method === "POST") {
        jsonResponse(response, 202, await service.control(await readJsonBody(request)));
      } else if (url.pathname === "/api/cli-conversations/state" && request.method === "POST") {
        jsonResponse(response, 200, await service.changeState(await readJsonBody(request)));
      } else if (url.pathname === "/api/cli-conversations/send" && request.method === "POST") {
        jsonResponse(response, 202, await service.send(await readJsonBody(request)));
      } else jsonResponse(response, 404, { error: "接口不存在" });
    } catch (error) { jsonResponse(response, 400, { error: error.message }); }
    return true;
  };
}
