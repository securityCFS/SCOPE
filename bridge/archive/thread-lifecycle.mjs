const locks = new WeakMap();
export function isArchiving(manager, host, sessionId) {
  return locks.get(manager)?.has(`${host}:${sessionId}`) || false;
}

/** Archive the durable remote thread first; only then release local bookkeeping. */
export async function archiveThread(
  manager,
  host,
  sessionId,
  executable,
  connectionKey,
) {
  if (!locks.has(manager)) locks.set(manager, new Set());
  const held = locks.get(manager);
  const key = `${host}:${sessionId}`;
  if (held.has(key)) throw new Error("正在归档，请稍后重试");
  const session = manager.sessions.get(key);
  if (
    session &&
    (session.status === "working" ||
      session.turnStarting ||
      session.profileHandoff ||
      session.profileSwitching)
  )
    throw new Error("会话仍在执行或交接，请结束后再归档");
  held.add(key);
  try {
    const connection = await manager.prepareHost(
      host,
      session?.executable || executable,
      session?.connectionKey || connectionKey,
    );
    const { thread } = await connection.request("thread/read", {
      threadId: sessionId,
      includeTurns: true,
    });
    if (!thread) throw new Error("无法核实远端会话，未归档");
    if (
      thread.status?.type === "active" ||
      thread.turns?.some((t) => t.status === "inProgress")
    )
      throw new Error("远端会话仍在执行，请结束后再归档");
    // A previous reply may have been lost after the remote move succeeded.
    if (!/[\\/]archived_sessions[\\/]/.test(thread.path || ""))
      await connection.request("thread/archive", { threadId: sessionId });
    manager.forgetArchivedSession(host, sessionId);
    return thread;
  } finally {
    held.delete(key);
  }
}
