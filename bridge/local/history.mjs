import { DIALOGUE_PROBE } from "../probes/dialogue-probe.mjs";
import { runLocalPython } from "./python-probe.mjs";
import { readLocalDialogue } from "./dialogue.mjs";

export function localHistoryReader({ manager, findRollout, run = runLocalPython }) {
  return async (body) => {
    const subagentId = typeof body.subagentId === "string" ? body.subagentId.trim() : "";
    if (!subagentId && manager.sessionRecords().some(record => record.host === body.host && record.sessionId === body.sessionId)) {
      return readLocalDialogue(manager, body.host, body.sessionId, body);
    }
    // Only use a server-discovered path, never a path supplied in the request.
    const rollout = findRollout(body.host, body.sessionId, subagentId);
    if (!rollout?.path) throw new Error(subagentId ? "未找到对应的子代理 rollout" : "未找到本机会话历史，请刷新会话扫描");
    const limit = Math.max(1, Math.min(100, Number(body.limit) || (subagentId ? 40 : 10)));
    const before = body.before != null && body.before !== "" && Number.isFinite(Number(body.before))
      ? String(Math.max(0, Math.floor(Number(body.before)))) : "";
    const result = await run(DIALOGUE_PROBE,
      [rollout.path, String(limit), before, body.dialogueOnly ? "dialogue-only" : "full"], 30_000, 5_000_000);
    if (result.code !== 0) throw new Error(result.stderr || "本机会话历史读取失败");
    const parsed = JSON.parse(result.stdout);
    if (!subagentId) return parsed;
    return {
      ...parsed,
      subagent: {
        id: rollout.id,
        agentNickname: rollout.agentNickname || "",
        agentPath: rollout.agentPath || "",
        agentRole: rollout.agentRole || "",
        model: rollout.model || "",
        turnState: rollout.turnState || "idle",
        lastAction: rollout.lastAction || "",
        lastEventAt: rollout.lastEventAt || null,
      },
    };
  };
}
