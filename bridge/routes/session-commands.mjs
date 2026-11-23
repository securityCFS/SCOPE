/** Codex CLI slash commands are client actions, not turn/start prompts. */
export function sessionCommandRoutes({manager, jsonResponse}) {
  return async (request, response, url) => {
    if (url.pathname !== "/api/session/commands" || request.method !== "GET") return false;
    try {
      response.setHeader("Cache-Control", "no-store");
      const commands = await manager.sessionCommands(url.searchParams.get("host"), url.searchParams.get("sessionId"));
      jsonResponse(response, 200, {commands});
    } catch (error) { jsonResponse(response, 400, {error:error.message}); }
    return true;
  };
}
