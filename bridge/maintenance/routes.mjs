import { readJsonBody, jsonResponse } from "../http.mjs";
export function maintenanceRoutes(service) {
  return async (request, response, url) => {
    if (url.pathname !== "/api/agents/maintenance") return false;
    try {
      if (request.method === "GET")
        jsonResponse(response, 200, {
          agents: await service.view(url.searchParams.get("host") || ""),
        });
      else if (request.method === "POST") {
        const { host, provider, action } = await readJsonBody(request);
        jsonResponse(response, 202, {
          job: await service.start(host, provider, action),
        });
      } else jsonResponse(response, 405, { error: "不支持的请求方法" });
    } catch (error) {
      jsonResponse(response, 409, { error: error.message });
    }
    return true;
  };
}
