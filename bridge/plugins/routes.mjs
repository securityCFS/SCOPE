import { jsonResponse, readJsonBody } from "../http.mjs";

export function pluginRoutes(registry) {
  return async (request, response, url) => {
    if (url.pathname !== "/api/plugins" && !url.pathname.startsWith("/api/plugins/")) return false;
    response.setHeader?.("Cache-Control", "no-store");
    try {
      if (url.pathname === "/api/plugins" && request.method === "GET") {
        jsonResponse(response, 200, registry.list()); return true;
      }
      const match = /^\/api\/plugins\/([a-z0-9-]+)\/(config|status|actions\/([a-z0-9-]+))$/.exec(url.pathname);
      if (!match) { jsonResponse(response, 404, { error: "插件接口不存在" }); return true; }
      const [, id, operation, action] = match;
      registry.get(id);
      if (request.method === "GET" && operation === "config") jsonResponse(response, 200, registry.describe(id));
      else if (request.method === "GET" && operation === "status") jsonResponse(response, 200, registry.get(id).status());
      else if (request.method === "POST" && operation === "config") {
        const body = await readJsonBody(request);
        jsonResponse(response, 200, registry.configure(id, body, body.revision));
      } else if (request.method === "POST" && action) {
        const input = await readJsonBody(request);
        jsonResponse(response, registry.get(id).source === "local" ? 200 : 202, await registry.invoke(id, action, input));
      } else jsonResponse(response, 405, { error: "不支持此操作" });
    } catch (error) { jsonResponse(response, error.statusCode || 400, { error: error.message }); }
    return true;
  };
}
