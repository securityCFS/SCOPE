/** Called after the bridge's origin checks. New features don't grow server.mjs. */
export function workbenchRoutes(service, { readJsonBody, jsonResponse }) {
  return async (request, response, url) => {
    if (!url.pathname.startsWith("/api/workbench")) return false;
    try {
      response.setHeader("Cache-Control", "no-store");
      if (url.pathname === "/api/workbench" && request.method === "GET") {
        jsonResponse(response, 200, service.state());
        return true;
      }
      if (request.method !== "POST") {
        jsonResponse(response, 405, { error: "不支持的请求方法" });
        return true;
      }
      const body = await readJsonBody(request);
      if (url.pathname === "/api/workbench/config")
        await service.configure(body.config, body.revision);
      else if (url.pathname === "/api/workbench/tasks") {
        jsonResponse(response, 202, { task: await service.enqueue(body) });
        void service.tick();
        return true;
      } else if (url.pathname === "/api/workbench/messages") {
        jsonResponse(response, 202, {
          task: await service.enqueue(body, "manager"),
        });
        void service.tick();
        return true;
      } else if (url.pathname === "/api/workbench/task-action")
        await service.action(body.id, body.action);
      else {
        jsonResponse(response, 404, { error: "接口不存在" });
        return true;
      }
      jsonResponse(response, 200, service.state());
    } catch (error) {
      jsonResponse(response, 400, { error: error.message });
    }
    return true;
  };
}
