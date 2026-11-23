/**
 * Return every known work directory for the selected host. Callers can merge
 * active and already-scanned historical sessions before applying a view filter.
 *
 * @param {Array<{host?: string, cwd?: string}>} sessions
 * @param {string} hostFilter
 */
export function collectCwdOptions(sessions, hostFilter) {
  return Array.from(
    new Set(
      sessions
        .filter(
          (session) =>
            hostFilter === "all" || session.host === hostFilter,
        )
        .map((session) => session.cwd?.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

/**
 * Remove cached history rows for Sessions that are currently controlled by a
 * live CLI process, tmux, or the app-server bridge.
 *
 * @template {{host?: string, sessionId?: string, rollout?: {id?: string} | null}} T
 * @param {Array<T>} sessions
 * @param {Array<{host?: string, sessionId?: string, rollout?: {id?: string} | null}>} activeSessions
 */
export function excludeActiveSessions(sessions, activeSessions) {
  const identity = (session) => {
    const host = session?.host?.trim();
    const sessionId = session?.sessionId || session?.rollout?.id;
    return host && sessionId ? `${host}:${sessionId}` : "";
  };
  const activeKeys = new Set(activeSessions.map(identity).filter(Boolean));
  return sessions.filter((session) => !activeKeys.has(identity(session)));
}
