const HOUR_MS = 60 * 60 * 1_000;

export const GPU_USAGE_RETENTION_HOURS = 7 * 24;
export const GPU_USAGE_MAX_EPISODES = 5_000;

export function emptyGpuUsageHistory() {
  return {
    version: 1,
    updatedAt: null,
    retentionHours: GPU_USAGE_RETENTION_HOURS,
    episodes: [],
  };
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value, limit) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function confidenceRank(value) {
  return { unmatched: 0, inferred: 1, strong: 2, exact: 3 }[value] || 0;
}

function normalizeEpisode(value) {
  if (!value || typeof value !== "object") return null;
  const host = cleanText(value.host, 180);
  const gpuIndex = finiteNumber(value.gpuIndex, -1);
  const pid = finiteNumber(value.pid, 0);
  const groupId = finiteNumber(value.groupId, pid);
  const firstSeenAt = Date.parse(value.firstSeenAt || "");
  const lastSeenAt = Date.parse(value.lastSeenAt || "");
  if (
    !host ||
    gpuIndex < 0 ||
    pid <= 0 ||
    !Number.isFinite(firstSeenAt) ||
    !Number.isFinite(lastSeenAt)
  ) {
    return null;
  }
  return {
    id:
      cleanText(value.id, 500) ||
      `${host}:${gpuIndex}:${groupId}:${pid}:${firstSeenAt}`,
    host,
    gpuIndex,
    gpuUuid: cleanText(value.gpuUuid, 160),
    gpuName: cleanText(value.gpuName, 240) || "GPU",
    workloadKey:
      cleanText(value.workloadKey, 400) ||
      `${host}:${gpuIndex}:${groupId}:${pid}`,
    pid,
    groupId,
    workerPids: Array.isArray(value.workerPids)
      ? value.workerPids
          .map((item) => finiteNumber(item, 0))
          .filter((item) => item > 0)
          .slice(0, 128)
      : [],
    kind: value.kind === "evaluation" ? "evaluation" : "training",
    command: cleanText(value.command, 180),
    cmdline: cleanText(value.cmdline, 1_200),
    cwd: cleanText(value.cwd, 800),
    paneSession: cleanText(value.paneSession, 160),
    pane: cleanText(value.pane, 80),
    ownerSessionId: cleanText(value.ownerSessionId, 180) || null,
    ownerConfidence: ["exact", "strong", "inferred"].includes(
      value.ownerConfidence,
    )
      ? value.ownerConfidence
      : "unmatched",
    ownerEvidence: Array.isArray(value.ownerEvidence)
      ? value.ownerEvidence.map((item) => cleanText(item, 300)).slice(0, 6)
      : [],
    sessionTheme: cleanText(value.sessionTheme, 180),
    sessionCwd: cleanText(value.sessionCwd, 800),
    startedAt:
      Number.isFinite(Date.parse(value.startedAt || ""))
        ? value.startedAt
        : new Date(firstSeenAt).toISOString(),
    firstSeenAt: new Date(firstSeenAt).toISOString(),
    lastSeenAt: new Date(lastSeenAt).toISOString(),
    endedAt:
      Number.isFinite(Date.parse(value.endedAt || "")) ? value.endedAt : null,
    active: Boolean(value.active),
    samples: Math.max(1, finiteNumber(value.samples, 1)),
    lastMemoryMiB: Math.max(0, finiteNumber(value.lastMemoryMiB, 0)),
    maxMemoryMiB: Math.max(0, finiteNumber(value.maxMemoryMiB, 0)),
  };
}

export function normalizeGpuUsageHistory(value) {
  const history = emptyGpuUsageHistory();
  if (!value || typeof value !== "object") return history;
  const episodes = Array.isArray(value.episodes)
    ? value.episodes.map(normalizeEpisode).filter(Boolean)
    : [];
  return {
    version: 1,
    updatedAt:
      Number.isFinite(Date.parse(value.updatedAt || ""))
        ? value.updatedAt
        : null,
    retentionHours: Math.max(
      1,
      finiteNumber(value.retentionHours, GPU_USAGE_RETENTION_HOURS),
    ),
    episodes,
  };
}

function workloadGpuEntries(workload) {
  const byIndex = new Map();
  for (const entry of workload.gpus || []) {
    const index = finiteNumber(entry.index, -1);
    if (index < 0) continue;
    const current = byIndex.get(index) || {
      index,
      memoryMiB: 0,
      workerPids: new Set(),
    };
    current.memoryMiB += Math.max(0, finiteNumber(entry.memoryMiB, 0));
    if (finiteNumber(entry.pid, 0) > 0) {
      current.workerPids.add(finiteNumber(entry.pid, 0));
    }
    byIndex.set(index, current);
  }
  return [...byIndex.values()];
}

function sessionDetails(host, workload) {
  const ownerSessionId = workload.ownerSessionId || null;
  const agent = ownerSessionId
    ? (host.agents || []).find(
        (candidate) => candidate.rollout?.id === ownerSessionId,
      )
    : null;
  return {
    ownerSessionId,
    sessionTheme:
      workload.ownerSessionTheme ||
      agent?.suggestedSummary?.theme ||
      agent?.rollout?.lastUser ||
      "",
    sessionCwd: workload.ownerSessionCwd || agent?.cwd || workload.cwd || "",
  };
}

export function updateGpuUsageHistory(
  input,
  hosts,
  now = Date.now(),
  {
    retentionHours = GPU_USAGE_RETENTION_HOURS,
    maxEpisodes = GPU_USAGE_MAX_EPISODES,
  } = {},
) {
  const history = normalizeGpuUsageHistory(input);
  const nowIso = new Date(now).toISOString();
  const reachableHosts = new Set(
    (hosts || []).filter((host) => host.reachable).map((host) => host.alias),
  );
  const openByKey = new Map(
    history.episodes
      .filter((episode) => episode.active)
      .map((episode) => [episode.workloadKey, episode]),
  );
  const observedKeys = new Set();

  for (const host of hosts || []) {
    if (!host.reachable) continue;
    const gpuByIndex = new Map(
      (host.gpus || []).map((gpu) => [finiteNumber(gpu.index, -1), gpu]),
    );
    for (const workload of host.workloads || []) {
      const session = sessionDetails(host, workload);
      for (const gpuEntry of workloadGpuEntries(workload)) {
        const pid = finiteNumber(workload.pid, 0);
        const groupId = finiteNumber(workload.groupId, pid);
        if (pid <= 0 || groupId <= 0) continue;
        const workloadKey = `${host.alias}:${gpuEntry.index}:${groupId}:${pid}`;
        observedKeys.add(workloadKey);
        const estimatedStartedAt =
          now - Math.max(0, finiteNumber(workload.elapsedSeconds, 0)) * 1_000;
        let episode = openByKey.get(workloadKey);
        if (
          episode &&
          Math.abs(Date.parse(episode.startedAt) - estimatedStartedAt) >
            5 * 60_000
        ) {
          episode.active = false;
          episode.endedAt = nowIso;
          episode = null;
        }
        const gpu = gpuByIndex.get(gpuEntry.index) || {};
        if (!episode) {
          episode = normalizeEpisode({
            id: `${workloadKey}:${now}`,
            host: host.alias,
            gpuIndex: gpuEntry.index,
            gpuUuid: gpu.uuid || "",
            gpuName: gpu.name || "GPU",
            workloadKey,
            pid,
            groupId,
            workerPids: [
              ...(workload.workerPids || []),
              ...gpuEntry.workerPids,
            ],
            kind: workload.kind,
            command: workload.command,
            cmdline: workload.cmdline,
            cwd: workload.cwd,
            paneSession: workload.pane?.session || "",
            pane: workload.pane?.pane || "",
            ownerSessionId: session.ownerSessionId,
            ownerConfidence: workload.ownerConfidence,
            ownerEvidence: workload.ownerEvidence,
            sessionTheme: session.sessionTheme,
            sessionCwd: session.sessionCwd,
            startedAt: new Date(estimatedStartedAt).toISOString(),
            firstSeenAt: nowIso,
            lastSeenAt: nowIso,
            active: true,
            samples: 1,
            lastMemoryMiB: gpuEntry.memoryMiB,
            maxMemoryMiB: gpuEntry.memoryMiB,
          });
          history.episodes.push(episode);
          openByKey.set(workloadKey, episode);
          continue;
        }

        episode.gpuUuid = cleanText(gpu.uuid || episode.gpuUuid, 160);
        episode.gpuName = cleanText(gpu.name || episode.gpuName, 240);
        episode.workerPids = [
          ...new Set([
            ...episode.workerPids,
            ...(workload.workerPids || []),
            ...gpuEntry.workerPids,
          ]),
        ].slice(0, 128);
        episode.kind =
          workload.kind === "evaluation" ? "evaluation" : "training";
        episode.command = cleanText(
          workload.command || episode.command,
          180,
        );
        episode.cmdline = cleanText(workload.cmdline || episode.cmdline, 1_200);
        episode.cwd = cleanText(workload.cwd || episode.cwd, 800);
        episode.paneSession = cleanText(
          workload.pane?.session || episode.paneSession,
          160,
        );
        episode.pane = cleanText(
          workload.pane?.pane || episode.pane,
          80,
        );
        if (
          session.ownerSessionId &&
          (!episode.ownerSessionId ||
            confidenceRank(workload.ownerConfidence) >=
              confidenceRank(episode.ownerConfidence))
        ) {
          episode.ownerSessionId = session.ownerSessionId;
          episode.ownerConfidence = workload.ownerConfidence;
          episode.ownerEvidence = (workload.ownerEvidence || [])
            .map((item) => cleanText(item, 300))
            .slice(0, 6);
        }
        episode.sessionTheme = cleanText(
          session.sessionTheme || episode.sessionTheme,
          180,
        );
        episode.sessionCwd = cleanText(
          session.sessionCwd || episode.sessionCwd,
          800,
        );
        episode.lastSeenAt = nowIso;
        episode.endedAt = null;
        episode.active = true;
        episode.samples += 1;
        episode.lastMemoryMiB = gpuEntry.memoryMiB;
        episode.maxMemoryMiB = Math.max(
          episode.maxMemoryMiB,
          gpuEntry.memoryMiB,
        );
      }
    }
  }

  for (const episode of history.episodes) {
    if (
      episode.active &&
      reachableHosts.has(episode.host) &&
      !observedKeys.has(episode.workloadKey)
    ) {
      episode.active = false;
      episode.endedAt = nowIso;
    }
  }

  const cutoff = now - Math.max(1, retentionHours) * HOUR_MS;
  history.episodes = history.episodes
    .filter((episode) => Date.parse(episode.lastSeenAt) >= cutoff)
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt),
    )
    .slice(0, Math.max(100, maxEpisodes));
  history.updatedAt = nowIso;
  history.retentionHours = retentionHours;
  return history;
}
