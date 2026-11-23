/** Normalize protocol items for the same conversation renderer used by SSH sessions. */
function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "string"
        ? part
        : part.text || (part.type === "image" ? "[图片]" : ""),
    )
    .join("\n");
}
export function localThreadDialogue(
  thread,
  { limit = 10, before, dialogueOnly = false } = {},
) {
  const all = [];
  for (const turn of thread.turns || []) {
    for (const item of turn.items || []) {
      let kind,
        text = "",
        title,
        extra = {};
      switch (item.type) {
        case "userMessage":
          kind = "user";
          title = "User";
          text = contentText(item.content);
          break;
        case "agentMessage":
          kind = "assistant";
          title = "Codex";
          text = item.text || "";
          extra.phase = item.phase;
          break;
        case "reasoning":
          kind = "reasoning";
          title = "思考摘要";
          text = contentText(item.summary);
          break;
        case "commandExecution":
          kind = "command";
          title = "命令";
          text = item.command || "";
          extra = {
            command: item.command,
            output: (item.aggregatedOutput || "").slice(-20_000),
            status: item.status,
          };
          break;
        case "fileChange":
          kind = "tool";
          title = "文件修改";
          text = (item.changes || [])
            .map((c) => `${c.path}\n${c.diff || ""}`)
            .join("\n");
          break;
        case "plan":
          kind = "intermediate";
          title = "计划";
          text = item.text || "";
          break;
        default:
          kind = "tool";
          title = item.tool || item.type;
          text = item.text || contentText(item.result?.content);
          extra.status = item.status;
      }
      const category =
        kind === "user" || (kind === "assistant" && item.phase !== "commentary")
          ? "dialogue"
          : ["assistant", "reasoning", "intermediate"].includes(kind)
            ? "reasoning"
            : "operations";
      all.push({
        id: `${turn.id}:${item.id}`,
        kind,
        category,
        title,
        text: text.slice(0, 200_000),
        timestamp: turn.startedAt
          ? new Date(turn.startedAt * 1000).toISOString()
          : null,
        turnId: turn.id,
        ...extra,
      });
    }
    if (turn.error?.message)
      all.push({
        id: `${turn.id}:error`,
        kind: "error",
        category: "operations",
        title: "会话错误",
        text: turn.error.message,
        timestamp: null,
      });
  }
  const end =
    before === undefined || before === null || before === ""
      ? all.length
      : Math.min(all.length, Math.max(0, Math.floor(Number(before)) || 0));
  const pageSize = Math.max(1, Math.min(100, Number(limit) || 10));
  const candidates = all
    .slice(0, end)
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.category === "dialogue");
  const start = candidates.length
    ? candidates.slice(-pageSize)[0].index
    : Math.max(0, end - pageSize);
  const events = all
    .slice(start, end)
    .filter((e) => !dialogueOnly || e.category === "dialogue");
  const counts = {};
  for (const event of events)
    counts[event.kind] = (counts[event.kind] || 0) + 1;
  return {
    path: thread.path || "",
    totalLines: all.length,
    totalBytes: 0,
    scannedBytes: 0,
    events,
    counts,
    toolEventCount: (counts.tool || 0) + (counts.command || 0),
    omittedToolEvents: 0,
    hiddenReasoningCount: 0,
    pageSize,
    hasMore: start > 0,
    nextBefore: start > 0 ? start : null,
  };
}
export async function readLocalDialogue(manager, host, sessionId, options) {
  const record = manager
    .sessionRecords()
    .find((s) => s.host === host && s.sessionId === sessionId);
  if (!record) throw new Error("本机会话尚未恢复，请稍后重试");
  const connection = await manager.prepareHost(
    host,
    record.executable,
    record.connectionKey,
  );
  try {
    const { thread } = await connection.request("thread/read", { threadId: sessionId, includeTurns: true });
    return localThreadDialogue(thread, options);
  } catch (error) {
    // The first turn can arrive before Codex flushes its new rollout metadata.
    if (/rollout .* is empty/.test(error.message) && Date.now() - Date.parse(record.connectedAt || "") < 10_000)
      return localThreadDialogue({ path: record.path, turns: [] }, options);
    throw error;
  }
}
