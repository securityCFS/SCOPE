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

export function activityLabel(value, now = Date.now()) {
  if (!value) return "时间未知";
  const minutes = Math.max(0, Math.floor((now - value) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时前`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}天前`;
  return new Date(value).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
