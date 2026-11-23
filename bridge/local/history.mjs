import { DIALOGUE_PROBE } from "../probes/dialogue-probe.mjs";
import { runLocalPython } from "./python-probe.mjs";
import { readLocalDialogue } from "./dialogue.mjs";

export function localHistoryReader({ manager, findRollout, run = runLocalPython }) {
  return async (body) => {
    if (manager.sessionRecords().some(record => record.host === body.host && record.sessionId === body.sessionId)) {
      return readLocalDialogue(manager, body.host, body.sessionId, body);
    }
    // Only use a server-discovered path, never a path supplied in the request.
    const rollout = findRollout(body.host, body.sessionId);
    if (!rollout?.path) throw new Error("未找到本机会话历史，请刷新会话扫描");
    const limit = Math.max(1, Math.min(100, Number(body.limit) || 10));
    const before = body.before != null && body.before !== "" && Number.isFinite(Number(body.before))
      ? String(Math.max(0, Math.floor(Number(body.before)))) : "";
    const result = await run(DIALOGUE_PROBE,
      [rollout.path, String(limit), before, body.dialogueOnly ? "dialogue-only" : "full"], 30_000, 5_000_000);
    if (result.code !== 0) throw new Error(result.stderr || "本机会话历史读取失败");
    return JSON.parse(result.stdout);
  };
}
