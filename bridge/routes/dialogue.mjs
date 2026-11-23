import { LOCAL_HOST } from "../../lib/execution-host.js";
/** Domain routes. Context is read per request so replaced snapshot state stays current. */
export function dialogueRoutes(context) {
  return async (request, response, url) => {
    const {
      DIALOGUE_PROBE,
      localDialogue,
      DIALOGUE_TIMEOUT_MS,
      RAW_CONTEXT_PROBE,
      cleanSshError,
      findAgent,
      historicalSessions,
      jsonResponse,
      readJsonBody,
      runSshCommand,
      sessionKey,
      shellQuote,
    } = context();
    if (url.pathname === "/api/dialogue" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        if (body.host === LOCAL_HOST && localDialogue) {
          const dialogue = await localDialogue(body);
          jsonResponse(response, 200, { ok: true, host: body.host, sessionId: body.sessionId, loadedAt: new Date().toISOString(), ...dialogue });
          return true;
        }
        const agent =
          findAgent(body.host, body.sessionId) ||
          historicalSessions.get(sessionKey(body.host, body.sessionId));
        if (!agent?.rollout?.path) {
          jsonResponse(response, 404, { error: "未找到对应的 rollout" });
          return true;
        }
        const limit = Math.max(1, Math.min(100, Number(body.limit) || 10));
        const before = Number.isFinite(Number(body.before))
          ? Math.max(0, Math.floor(Number(body.before)))
          : "";
        const command = [
          "python3 -",
          shellQuote(agent.rollout.path),
          shellQuote(String(limit)),
          shellQuote(String(before)),
          shellQuote(body.dialogueOnly ? "dialogue-only" : "full"),
        ].join(" ");
        const result = await runSshCommand(
          agent.host,
          command,
          DIALOGUE_PROBE,
          DIALOGUE_TIMEOUT_MS,
          5_000_000,
        );
        if (result.code !== 0) {
          throw new Error(cleanSshError(result.stderr || result.stdout));
        }
        let dialogue;
        try {
          dialogue = JSON.parse(result.stdout.trim());
        } catch {
          throw new Error("远端返回的 dialogue 数据不完整");
        }
        jsonResponse(response, 200, {
          ok: true,
          host: agent.host,
          sessionId: agent.rollout.id,
          loadedAt: new Date().toISOString(),
          ...dialogue,
        });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `Dialogue 读取失败：${error.message}`,
        });
      }
      return true;
    }

    if (
      url.pathname === "/api/session/raw-context" &&
      request.method === "POST"
    ) {
      try {
        const body = await readJsonBody(request);
        const agent =
          findAgent(body.host, body.sessionId) ||
          historicalSessions.get(sessionKey(body.host, body.sessionId));
        if (!agent?.rollout?.path) {
          jsonResponse(response, 404, { error: "未找到对应的 rollout" });
          return true;
        }
        const result = await runSshCommand(
          agent.host,
          `python3 - ${shellQuote(agent.rollout.path)}`,
          RAW_CONTEXT_PROBE,
          DIALOGUE_TIMEOUT_MS,
          10_000_000,
        );
        if (result.code !== 0) {
          throw new Error(cleanSshError(result.stderr || result.stdout));
        }
        let context;
        try {
          context = JSON.parse(result.stdout.trim());
        } catch {
          throw new Error("远端返回的 raw context 数据不完整");
        }
        jsonResponse(response, 200, {
          ok: true,
          host: agent.host,
          sessionId: agent.rollout.id,
          context,
        });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `Raw context 读取失败：${error.message}`,
        });
      }
      return true;
    }
    return false;
  };
}
