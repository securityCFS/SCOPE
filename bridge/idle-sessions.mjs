import { isArchiving } from "./archive/thread-lifecycle.mjs";

export function idleSessionTimeout(value = process.env.SCOPE_SESSION_IDLE_MINUTES) {
  if (value === undefined || value === "") return 30 * 60_000;
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes * 60_000 : 30 * 60_000;
}

function sessionBlockingRequest(manager, host, sessionId) {
  for (const request of manager.requests.values()) {
    if (
      request.host === host &&
      request.threadId === sessionId &&
      ["pending", "responding", "disconnected"].includes(request.status)
    ) {
      return true;
    }
  }
  return false;
}

function sessionIdleCandidate(manager, key, session, cutoffMs, isReserved) {
  const { host, sessionId } = session;
  const activityStamp = session.lastEventAt || session.connectedAt;
  const lastActivity = Date.parse(activityStamp || "");
  if (
    !Number.isFinite(lastActivity) ||
    manager.now() - lastActivity < cutoffMs ||
    session.status !== "idle" ||
    session.activeTurnId ||
    session.turnStarting ||
    session.profileSwitching ||
    session.profileHandoff ||
    isArchiving(manager, host, sessionId) ||
    manager.capacityRecoveries.has(key) ||
    !manager.isConnected(host, sessionId) ||
    isReserved(host, sessionId, session) ||
    sessionBlockingRequest(manager, host, sessionId)
  ) {
    return null;
  }
  return {
    key,
    session,
    activityStamp,
    lastActivity,
    connectedAt: Date.parse(session.connectedAt || "") || 0,
  };
}

// Release only excess non-reserved idle subscriptions, oldest first. Never interrupt a turn or kill a daemon.
export async function releaseIdleSessions(
  manager,
  {
    timeoutMs = idleSessionTimeout(),
    residentLimit = 0,
    isReserved = () => false,
    onError = () => {},
  } = {},
) {
  const resolvedTimeoutMs =
    typeof timeoutMs === "function" ? timeoutMs() : timeoutMs;
  if (!(resolvedTimeoutMs > 0)) return [];

  const byHost = new Map();
  for (const [key, session] of manager.sessions) {
    const entries = byHost.get(session.host) || [];
    entries.push([key, session]);
    byHost.set(session.host, entries);
  }

  const released = [];
  for (const [host, entries] of byHost) {
    const rawLimit =
      typeof residentLimit === "function" ? residentLimit(host) : residentLimit;
    const poolLimit = Math.max(0, Math.trunc(Number(rawLimit) || 0));
    const connectedEntries = entries.filter(([, session]) =>
      manager.isConnected(host, session.sessionId),
    );
    if (connectedEntries.length <= poolLimit) continue;

    let excess = connectedEntries.length - poolLimit;
    const candidates = connectedEntries
      .map(([key, session]) =>
        sessionIdleCandidate(manager, key, session, resolvedTimeoutMs, isReserved),
      )
      .filter(Boolean)
      .sort(
        (left, right) =>
          left.lastActivity - right.lastActivity ||
          left.connectedAt - right.connectedAt ||
          left.key.localeCompare(right.key),
      );

    for (const candidate of candidates) {
      if (excess <= 0) break;
      const { key, session, activityStamp } = candidate;
      const { sessionId } = session;
      if (
        manager.sessions.get(key) !== session ||
        !sessionIdleCandidate(manager, key, session, resolvedTimeoutMs, isReserved) ||
        (session.lastEventAt || session.connectedAt) !== activityStamp
      ) {
        continue;
      }

      session.idleReleasing = true;
      session.profileSwitching = true;
      try {
        const connection = await manager.prepareHost(
          host,
          session.executable,
          session.connectionKey,
        );
        if (connection.pendingRequests?.size) continue;
        const { thread } = await connection.request("thread/read", {
          threadId: sessionId,
          includeTurns: false,
        });
        const hasActiveFlags =
          Array.isArray(thread?.status?.activeFlags) &&
          thread.status.activeFlags.length > 0;
        // Fail closed when the server cannot confirm inactivity, including older protocols.
        if (
          !["idle", "notLoaded"].includes(thread?.status?.type) ||
          hasActiveFlags ||
          manager.sessions.get(key) !== session ||
          session.status !== "idle" ||
          session.activeTurnId ||
          session.turnStarting ||
          session.profileHandoff ||
          isArchiving(manager, host, sessionId) ||
          manager.capacityRecoveries.has(key) ||
          !manager.isConnected(host, sessionId) ||
          (session.lastEventAt || session.connectedAt) !== activityStamp ||
          isReserved(host, sessionId, session) ||
          sessionBlockingRequest(manager, host, sessionId)
        ) {
          continue;
        }
        await connection.request("thread/unsubscribe", { threadId: sessionId });
        if (manager.sessions.get(key) !== session) continue;
        manager.sessions.delete(key);
        for (const itemKey of manager.items.keys()) {
          if (itemKey.startsWith(`${key}:`)) manager.items.delete(itemKey);
        }
        for (const [requestKey, request] of manager.requests) {
          if (request.host === host && request.threadId === sessionId) {
            manager.requests.delete(requestKey);
          }
        }
        const record = { ...session, resumeOnRecovery: false };
        delete record.profileSwitching;
        delete record.idleReleasing;
        manager.emit("session-release", {
          host,
          sessionId,
          reason: "idle",
          record,
        });
        manager.emit("change");
        released.push({ host, sessionId });
        excess -= 1;
      } catch (error) {
        onError(error, session);
      } finally {
        delete session.profileSwitching;
        delete session.idleReleasing;
      }
    }
  }
  return released;
}

export function startIdleSessionReaper(manager, options) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await releaseIdleSessions(manager, options); }
    finally { running = false; }
  }, 60_000);
  timer.unref();
  return timer;
}
