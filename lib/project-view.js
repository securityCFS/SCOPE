export const DEFAULT_PROJECT_FILTERS = {
  order: "recent",
  category: "all",
  provider: "all",
  status: "all",
};
export const PROJECT_FILTER_OPTIONS = {
  order: { recent: "最近活动", oldest: "最早活动" },
  category: {
    all: "全部任务",
    research: "研究",
    training: "训练",
    evaluation: "评测",
    engineering: "工程",
    other: "未分类",
  },
  provider: {
    all: "全部 Agent",
    codex: "Codex",
    claude: "Claude",
    antigravity: "Antigravity",
  },
  status: {
    all: "全部状态",
    working: "执行中",
    attention: "需要处理",
    idle: "空闲 / 已结束",
  },
};
export function normalizeProjectFilters(value) {
  return Object.fromEntries(
    Object.entries(DEFAULT_PROJECT_FILTERS).map(([key, fallback]) => [
      key,
      Object.hasOwn(PROJECT_FILTER_OPTIONS[key], value?.[key])
        ? value[key]
        : fallback,
    ]),
  );
}
/** @template {{key:string, name:string, host:string, cwd:string, pinned:boolean, sessions:Array<{title:string, lastActivityAt?:number|null, category?:string, provider?:string, status:string}>}} T
 * @param {T[]} projects
 * @param {typeof DEFAULT_PROJECT_FILTERS} filters
 * @param {string} query
 * @returns {T[]}
 */
export function filterProjects(projects, filters, query = "") {
  const needle = query.trim().toLocaleLowerCase();
  const compare = (a, b) => {
    const left = a.lastActivityAt || 0,
      right = b.lastActivityAt || 0;
    if (!left || !right) return Number(!left) - Number(!right);
    return filters.order === "oldest" ? left - right : right - left;
  };
  const narrowed =
    filters.category !== "all" ||
    filters.provider !== "all" ||
    filters.status !== "all";
  return projects
    .flatMap((project) => {
      const sessions = project.sessions
        .filter(
          (session) =>
            (!needle ||
              [project.name, project.host, project.cwd, session.title]
                .join(" ")
                .toLocaleLowerCase()
                .includes(needle)) &&
            (filters.category === "all" ||
              (session.category || "other") === filters.category) &&
            (filters.provider === "all" ||
              (session.provider || "codex") === filters.provider) &&
            (filters.status === "all" || session.status === filters.status),
        )
        .sort(compare);
      return sessions.length ||
        (!narrowed && !needle && !project.sessions.length)
        ? [{ ...project, sessions }]
        : [];
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        compare(a.sessions[0] || {}, b.sessions[0] || {}) ||
        a.key.localeCompare(b.key),
    );
}
