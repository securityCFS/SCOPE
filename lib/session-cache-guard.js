// Conversation history is durable data; reachability and process state are not.
const contentFields = ["firstUser", "lastUser", "lastAssistant", "lastAction", "lastError", "userMessages", "assistantMessages", "launches", "mtimeMs", "sizeBytes", "lastEventAt"];
const key = (s) => s?.id || s?.path;
const eventTime = (s) => Date.parse(s?.lastEventAt || "") || 0;
export function preserveSession(previous, incoming) {
  if (!previous) return incoming;
  if (!incoming) return { ...previous, turnState: "idle", cacheRecovery: "missing-on-remote" };
  const older = eventTime(previous) > eventTime(incoming) ||
    (!eventTime(previous) && Number(previous.mtimeMs || 0) > Number(incoming.mtimeMs || 0)) ||
    (Number(previous.sizeBytes || 0) > Number(incoming.sizeBytes || 0) && incoming.sizeBytes != null);
  if (older) {
    const result = { ...incoming, cacheRecovery: "remote-history-regressed", turnState: "idle" };
    for (const field of contentFields) if (previous[field] !== undefined) result[field] = previous[field];
    return result;
  }
  // Compact overview responses omit arrays; that must not erase richer copies.
  if (eventTime(previous) === eventTime(incoming)) {
    const result = { ...incoming };
    for (const field of ["userMessages", "assistantMessages", "launches"]) {
      if ((previous[field]?.length || 0) > (incoming[field]?.length || 0)) result[field] = previous[field];
    }
    return result;
  }
  return incoming;
}
export function preserveHostSessions(previous, incoming) {
  const old = new Map();
  for (const s of [...(previous?.sessions || []), ...(previous?.agents || []).flatMap(a => [a.rollout, ...(a.subagents || [])])]) {
    if (key(s)) old.set(key(s), preserveSession(old.get(key(s)), s));
  }
  const current = new Map();
  for (const s of incoming.sessions || []) if (key(s)) current.set(key(s), preserveSession(old.get(key(s)), s));
  for (const [id, s] of old) if (!current.has(id)) current.set(id, preserveSession(s, null));
  return {
    ...incoming,
    sessions: [...current.values()],
    agents: (incoming.agents || []).map(a => ({ ...a,
      rollout: a.rollout ? preserveSession(old.get(key(a.rollout)), a.rollout) : a.rollout,
      subagents: (a.subagents || []).map(s => preserveSession(old.get(key(s)), s)),
    })),
  };
}
export function preserveSnapshotSessions(previous, incoming) {
  const old = new Map((previous?.hosts || []).map(h => [h.alias, h]));
  const hosts = (incoming.hosts || []).map(h => preserveHostSessions(old.get(h.alias), h));
  const aliases = new Set(hosts.map(h => h.alias));
  for (const h of old.values()) if (!aliases.has(h.alias)) hosts.push(preserveHostSessions(h, {
    alias: h.alias, hostname: h.hostname, reachable: false, stale: true,
    processes: [], workloads: [], panes: [], agents: [], sessions: [], gpus: [],
  }));
  return { ...incoming, hosts };
}
