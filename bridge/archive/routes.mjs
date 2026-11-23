export function archiveRoutes(service, { readJsonBody, jsonResponse }) {
  return async (req, res, url) => {
    if (url.pathname !== "/api/session/archives") return false;
    res.setHeader("Cache-Control", "no-store");
    try {
      if (req.method === "GET")
        jsonResponse(res, 200, { records: service.list() });
      else if (req.method === "POST") {
        const { host, sessionId, action } = await readJsonBody(req);
        jsonResponse(res, 200, {
          record: await service.change(host, sessionId, action),
        });
      } else jsonResponse(res, 405, { error: "不支持的请求方法" });
    } catch (error) {
      jsonResponse(res, 409, { error: error.message });
    }
    return true;
  };
}
