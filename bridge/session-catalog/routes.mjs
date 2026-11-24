export function catalogRoutes(catalog, { jsonResponse, readJsonBody, resolveCodex }) {
  return async (request, response, url) => {
    if (!url.pathname.startsWith("/api/session-catalog")) return false;
    try {
      if (url.pathname === "/api/session-catalog" && request.method === "GET") {
        void catalog.refresh();
        const { state, etag } = catalog.state();
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("ETag", etag);
        if (request.headers["if-none-match"] === etag) { response.writeHead(304); response.end(); }
        else jsonResponse(response, 200, state);
      } else if (url.pathname === "/api/session-catalog/scan" && request.method === "POST") {
        void catalog.refresh(true);
        jsonResponse(response, 202, { scanning: true });
      } else if (url.pathname === "/api/session-catalog/dialogue" && request.method === "GET") {
        response.setHeader("Cache-Control", "no-store");
        jsonResponse(response, 200, await catalog.dialogue(url.searchParams.get("key"), {
          before: url.searchParams.get("before"), version: url.searchParams.get("version"),
        }));
      } else if (url.pathname === "/api/session-catalog/subagent-workflow" && request.method === "GET") {
        response.setHeader("Cache-Control", "no-store");
        jsonResponse(response, 200, await catalog.subagentWorkflow(url.searchParams.get("key"), {
          subagentId: url.searchParams.get("subagentId"),
          version: url.searchParams.get("version"),
        }));
      } else if (url.pathname === "/api/session-catalog/select" && request.method === "POST") {
        const entry = catalog.get((await readJsonBody(request)).key);
        if (!entry || entry.provider !== "codex") throw new Error("不是 Codex 会话");
        jsonResponse(response, 200, { agent: resolveCodex(entry) });
      } else jsonResponse(response, 404, { error: "接口不存在" });
    } catch (error) { jsonResponse(response, 400, { error: error.message }); }
    return true;
  };
}
