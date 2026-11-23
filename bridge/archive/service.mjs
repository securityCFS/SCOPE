/** Durable intents make lost SSH replies retryable without pretending local-only deletion succeeded. */
export function sessionArchiveService({
  manager,
  getState,
  persist,
  findAgent,
  getHost,
  executable,
  connectionKey,
  notify,
  restored,
  protectedSession = () => false,
}) {
  const busy = new Set();
  const keyOf = (host, id) => `${host}:${id}`;
  function list() {
    return Object.values(getState().sessions).flatMap((value) =>
      value.archive && value.archive.phase !== "restored"
        ? [value.archive]
        : [],
    );
  }
  async function write(key, record) {
    const sessions = getState().sessions;
    const previous = sessions[key];
    sessions[key] = { ...previous, archive: record };
    try {
      await persist();
    } catch (error) {
      sessions[key] = previous;
      throw error;
    }
    notify();
  }
  async function change(host, sessionId, action, receipt = null) {
    if (!host || !sessionId || !["archive", "restore"].includes(action))
      throw new Error("归档参数无效");
    if (protectedSession(host, sessionId))
      throw new Error("这是总调度的主会话，请从左侧归档普通项目会话或任务");
    const key = keyOf(host, sessionId);
    if (busy.has(key)) throw new Error("此会话的归档操作尚未完成");
    if (!getHost(host)?.reachable)
      throw new Error("主机当前离线，恢复连接后可归档或恢复");
    busy.add(key);
    let record;
    try {
      const previous = getState().sessions[key]?.archive;
      if (action === "restore" && !previous) throw new Error("找不到归档记录");
      if (action === "restore" && previous.phase === "restored")
        return previous;
      const agent = findAgent(host, sessionId);
      const managed = manager
        .sessionRecords()
        .find((s) => s.host === host && s.sessionId === sessionId);
      if (action === "archive") {
        if (!agent && !managed && !receipt && !previous)
          throw new Error("找不到对应会话");
        if (
          agent?.status === "working" ||
          (!managed && (agent?.pid > 0 || agent?.pane))
        )
          throw new Error("会话仍由运行中的 Agent 使用，请结束后再归档");
        if (agent?.subagents?.some((child) => child.status === "working"))
          throw new Error("子会话仍在执行，请结束后再归档");
      }
      record = {
        ...previous,
        host,
        sessionId,
        title:
          previous?.title ||
          agent?.title ||
          agent?.rollout?.firstUser ||
          sessionId,
        session: managed || previous?.session || null,
        cwd: previous?.cwd || agent?.cwd || managed?.cwd || receipt?.cwd || "",
        executable:
          managed?.executable ||
          receipt?.executable ||
          previous?.executable ||
          executable(host),
        connectionKey:
          managed?.connectionKey ||
          receipt?.connectionKey ||
          previous?.connectionKey ||
          (await connectionKey(host, sessionId)),
        phase: action === "archive" ? "archiving" : "restoring",
        error: null,
        updatedAt: new Date().toISOString(),
      };
      await write(key, record);
      if (action === "archive") {
        await manager.archiveSession(
          host,
          sessionId,
          record.executable,
          record.connectionKey,
        );
        record = {
          ...record,
          phase: "archived",
          archivedAt: new Date().toISOString(),
        };
      } else {
        const thread = await manager.unarchiveSession(
          host,
          sessionId,
          record.executable,
          record.connectionKey,
        );
        if (record.session)
          await manager.resumeSession({
            ...record.session,
            path: thread.path || null,
          });
        await restored(host, sessionId, thread);
        record = { ...record, phase: "restored" };
      }
      await write(key, record);
      return record;
    } catch (error) {
      if (record)
        await write(key, { ...record, error: error.message }).catch(() => {});
      throw error;
    } finally {
      busy.delete(key);
    }
  }
  return { list, change };
}
