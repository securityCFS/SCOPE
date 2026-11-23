export function conversationRoutes(
  manager,
  { readJsonBody, jsonResponse, persist },
) {
  return async (request, response, url) => {
    if (url.pathname !== "/api/session/interrupt") return false;
    if (request.method !== "POST") {
      jsonResponse(response, 405, { error: "不支持的请求方法" });
      return true;
    }
    try {
      const body = await readJsonBody(request);
      if (
        typeof body.host !== "string" ||
        typeof body.sessionId !== "string" ||
        !body.host.trim() ||
        !body.sessionId.trim()
      )
        throw new Error("缺少主机或会话 ID");
      const result = await manager.interruptTurn(
        body.host.trim(),
        body.sessionId.trim(),
      );
      await persist();
      jsonResponse(response, 200, result);
    } catch (error) {
      jsonResponse(response, 409, { error: error.message });
    }
    return true;
  };
}
