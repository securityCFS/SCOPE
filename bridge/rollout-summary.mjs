import path from "node:path";

export function stripContext(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferCategory(text) {
  if (/调研|查阅|检索|文献|论文|survey|research|literature|paper/i.test(text)) {
    return "research";
  }
  if (/评测|评估|eval|evaluation|benchmark|libero|指标|统计/i.test(text)) {
    return "evaluation";
  }
  if (/训练|train|epoch|step|loss|checkpoint|微调|finetun/i.test(text)) {
    return "training";
  }
  if (/实现|修复|代码|重构|bug|debug|build|部署|接口|脚本/i.test(text)) {
    return "engineering";
  }
  return "other";
}

export function shortenTheme(value, cwd) {
  const cleaned = stripContext(value)
    .replace(
      /^(请|麻烦|现在|接下来|另外|你可以|能不能|帮我|继续|进入下一步)[，,。:\s]*/i,
      "",
    )
    .replace(/[。！？!?；;].*$/, "")
    .trim();
  if (cleaned && !/^(继续|进度呢|现在呢|下一步|？+)$/.test(cleaned)) {
    return cleaned.slice(0, 22);
  }
  return `${path.posix.basename(cwd || "") || "未命名"} 会话`;
}

export function heuristicSummary(rollout, cwd) {
  const userMessages = [
    rollout?.firstUser,
    ...(Array.isArray(rollout?.userMessages) ? rollout.userMessages : []),
    rollout?.lastUser,
  ]
    .map(stripContext)
    .filter(Boolean);
  const useful =
    userMessages.find(
      (message) =>
        !/^(继续|进入下一步|现在进度呢|进度呢|为什么不报告进度|干嘛呢|？+)[。！？!?]*$/.test(
          message,
        ),
    ) ||
    userMessages[0] ||
    "";
  const assistantMessages = Array.isArray(rollout?.assistantMessages)
    ? rollout.assistantMessages.map(stripContext).filter(Boolean)
    : [];
  const combined = [...userMessages, ...assistantMessages].join(" ");
  const taskCategory = inferCategory(useful);
  const category =
    taskCategory === "other" ? inferCategory(combined) : taskCategory;
  const latestReport = assistantMessages.at(-1) || rollout?.lastAssistant || "";

  return {
    theme: shortenTheme(useful, cwd),
    category,
    objective: useful.slice(0, 220) || "尚未从 rollout 中提取到明确任务",
    progress:
      (latestReport || rollout?.lastAction || "等待新的会话事件").slice(0, 420),
    result: category === "research" ? latestReport.slice(0, 1200) : "",
    nextStep: "",
    source: "rollout",
    updatedAt: rollout?.lastEventAt || new Date().toISOString(),
  };
}

export function historicalAgent(host, rollout) {
  const cwd = rollout.cwd || "";
  const lastEventAt = Date.parse(rollout.lastEventAt || "");
  const executable =
    host.agents
      ?.map((agent) => agent.executable)
      .find(
        (candidate) =>
          typeof candidate === "string" &&
          candidate.startsWith("/") &&
          candidate.endsWith("/codex"),
      ) || "codex";
  return {
    id: `history:${host.alias}:${rollout.id}`,
    host: host.alias,
    hostname: host.hostname || host.alias,
    pid: 0,
    tty: "历史记录",
    cwd,
    executable,
    elapsedSeconds: 0,
    status: "idle",
    pane: null,
    rollout,
    subagents: Array.isArray(rollout.subagents) ? rollout.subagents : [],
    historical: true,
    mapping: {
      rollout: "history",
      tmux: "unmatched",
    },
    lastActivityAt: Number.isFinite(lastEventAt)
      ? lastEventAt
      : rollout.mtimeMs || null,
    suggestedSummary: heuristicSummary(rollout, cwd),
    title:
      rollout.lastUser ||
      `历史会话 · ${path.posix.basename(cwd) || rollout.id.slice(0, 8)}`,
  };
}

export function createAgentEnricher({ getSubmissionItems }) {
  return function enrichAgentRelations(host, agent) {
    const sessionId = agent.rollout?.id || "";
    const subagentById = new Map();
    for (const sub of Array.isArray(agent.subagents) ? agent.subagents : []) {
      if (sub?.id) subagentById.set(sub.id, sub);
    }
    if (sessionId) {
      for (const session of Array.isArray(host.sessions) ? host.sessions : []) {
        if (!session?.isSubagent || !session.id) continue;
        if (session.parentThreadId !== sessionId) continue;
        const prev = subagentById.get(session.id);
        if (!prev || (session.mtimeMs || 0) >= (prev.mtimeMs || 0)) {
          subagentById.set(session.id, session);
        }
      }
    }
    const mergedSubagents = Array.from(subagentById.values()).sort(
      (a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0),
    );
    const relatedSessionIds = new Set([
      sessionId,
      ...mergedSubagents.map((subagent) => subagent.id),
    ]);
    const localWorkloads = (host.workloads || []).filter(
      (workload) => workload.ownerSessionId === sessionId,
    );
    const remoteJobs = getSubmissionItems().filter(
      (item) =>
        item.host === host.alias &&
        (relatedSessionIds.has(item.sessionId) ||
          (item.parentThreadId && relatedSessionIds.has(item.parentThreadId))),
    );
    const paneKeys = new Set();
    const relatedPanes = [];
    const addPane = (pane) => {
      if (!pane) return;
      const key = `${pane.session}:${pane.pane}`;
      if (paneKeys.has(key)) return;
      paneKeys.add(key);
      const fullPane =
        host.panes.find(
          (candidate) =>
            candidate.session === pane.session && candidate.pane === pane.pane,
        ) || pane;
      relatedPanes.push(fullPane);
    };
    addPane(agent.pane);
    for (const workload of localWorkloads) addPane(workload.pane);
    return {
      ...agent,
      subagents: mergedSubagents,
      localWorkloads,
      remoteJobs,
      relatedPanes,
    };
  };
}
