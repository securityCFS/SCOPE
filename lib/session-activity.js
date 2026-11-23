/** Normalize provider timestamps (epoch seconds/milliseconds or ISO strings). */
export function activityTime(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  const time = Number.isFinite(numeric)
    ? numeric < 100_000_000_000 ? numeric * 1000 : numeric
    : Date.parse(value);
  return Number.isFinite(time) && time > 0 ? time : 0;
}

/** @template {{key: string, pinned: boolean, sessions: Array<{lastActivityAt?: number | null}>}} T
 * @param {T[]} projects
 * @returns {T[]}
 */
export function recentProjects(projects) {
  const sorted = projects.map(project => ({
    ...project,
    sessions: [...project.sessions].sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0)),
  }));
  return sorted.sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || (b.sessions[0]?.lastActivityAt || 0) - (a.sessions[0]?.lastActivityAt || 0)
    || a.key.localeCompare(b.key));
}

export function activityLabel(value, now = Date.now(), locale = "zh-CN") {
  const en = locale === "en";
  if (!value) return en ? "Unknown" : "时间未知";
  const minutes = Math.max(0, Math.floor((now - value) / 60_000));
  if (minutes < 1) return en ? "just now" : "刚刚";
  if (minutes < 60) return en ? `${minutes}m ago` : `${minutes}分钟前`;
  if (minutes < 1440) return en ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 60)}小时前`;
  if (minutes < 10080) return en ? `${Math.floor(minutes / 1440)}d ago` : `${Math.floor(minutes / 1440)}天前`;
  return new Date(value).toLocaleDateString(en ? "en-US" : "zh-CN", { month: "short", day: "numeric" });
}
