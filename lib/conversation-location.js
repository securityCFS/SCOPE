export const CONVERSATION_LOCATION_KEY = "scope.conversation-location.v1";

export function readConversationLocation(raw) {
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !["manager", "projects", "resources", "settings"].includes(value.section)) return null;
    const text = (v) => typeof v === "string" && v.length <= 4096;
    if (!text(value.projectHost) || !text(value.host) || !text(value.cwd)) return null;
    if (value.session && (!text(value.session.id) || !text(value.session.sessionId) || !["codex", "claude", "antigravity"].includes(value.session.provider))) return null;
    return { version: 1, section: value.section, projectHost: value.projectHost, host: value.host, cwd: value.cwd,
      session: value.session ? { id: value.session.id, sessionId: value.session.sessionId, provider: value.session.provider } : null };
  } catch { return null; }
}

// Durable IDs survive a process restart or the transition from a scanned to a managed session.
export function findConversationLocation(projects, location) {
  for (const project of projects) {
    if (project.host !== location.host) continue;
    if (!location.session) { if (project.cwd === location.cwd) return { project, session: null }; continue; }
    const wanted = location.session;
    const session = project.sessions.find(item => (item.provider || "codex") === wanted.provider &&
      (wanted.sessionId ? item.sessionId === wanted.sessionId : item.id === wanted.id));
    if (session) return { project, session };
  }
  return null;
}
