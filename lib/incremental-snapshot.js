import { preserveSnapshotSessions } from "./session-cache-guard.js";
import { overviewDelta, applyOverviewDelta } from "./overview-delta.js";
const SNAPSHOT_SYNC_PROTOCOL = 1;

function compactRollout(rollout) {
  if (!rollout) return null;
  return {
    id: rollout.id || "",
    rootSessionId: rollout.rootSessionId || "",
    parentThreadId: rollout.parentThreadId || "",
    agentPath: rollout.agentPath || "",
    agentNickname: rollout.agentNickname || "",
    isSubagent: Boolean(rollout.isSubagent),
    cwd: rollout.cwd || "",
    startedAt: rollout.startedAt || "",
    cliVersion: rollout.cliVersion || "",
    path: rollout.path || "",
    mtimeMs: rollout.mtimeMs || 0,
    lastUser: rollout.lastUser || "",
    lastAssistant: rollout.lastAssistant || "",
    lastAction: rollout.lastAction || "",
    lastError: rollout.lastError || "",
    firstUser: rollout.firstUser || "",
    userMessages: [],
    assistantMessages: [],
    model: rollout.model || "",
    reasoningEffort: rollout.reasoningEffort || "",
    approvalPolicy: rollout.approvalPolicy || "",
    sandboxPolicy: rollout.sandboxPolicy || "",
    collaborationMode: rollout.collaborationMode || "",
    launches: [],
    account: rollout.account || null,
    tokenUsage: rollout.tokenUsage || null,
    turnState: rollout.turnState || "idle",
    lastEventAt: rollout.lastEventAt || "",
    cacheRecovery: rollout.cacheRecovery,
  };
}

function compactRemoteJob(job) {
  return {
    ...job,
    evidence: "",
  };
}

function compactHost(host) {
  return {
    ...host,
    processes: [],
    sessions: (host.sessions || []).map(compactRollout),
    agents: (host.agents || []).map((agent) => ({
      ...agent,
      rollout: compactRollout(agent.rollout),
      subagents: (agent.subagents || []).map(compactRollout),
      remoteJobs: (agent.remoteJobs || []).map(compactRemoteJob),
    })),
  };
}

/**
 * Remove resources that are either large, independently versioned, or already
 * available through a dedicated detail endpoint. The overview remains a valid
 * Snapshot once gpuUsage and submissionTracker are merged back in.
 */
export function compactSnapshotOverview(snapshot) {
  const rest = { ...snapshot };
  delete rest.gpuUsage;
  delete rest.submissionTracker;
  return {
    ...rest,
    hosts: (snapshot.hosts || []).map(compactHost),
  };
}

export function splitSnapshotResources(snapshot) {
  return {
    overview: compactSnapshotOverview(snapshot),
    gpuUsage: snapshot.gpuUsage || {
      updatedAt: null,
      retentionHours: 168,
      episodes: [],
    },
    submissionTracker: snapshot.submissionTracker || {
      scannedAt: null,
      scanning: false,
      items: [],
      calls: [],
      launches: [],
      alerts: [],
      hosts: [],
      error: null,
    },
  };
}

function episodeMap(gpuUsage) {
  return new Map(
    (gpuUsage?.episodes || []).map((episode) => [episode.id, episode]),
  );
}

function gpuMeta(gpuUsage) {
  return {
    updatedAt: gpuUsage?.updatedAt || null,
    retentionHours: gpuUsage?.retentionHours || 168,
  };
}

function fullPayload(epoch, revision, resources) {
  return {
    protocol: SNAPSHOT_SYNC_PROTOCOL,
    epoch,
    revision,
    reset: true,
    overview: resources.overview,
    gpuUsage: resources.gpuUsage,
    submissionTracker: resources.submissionTracker,
  };
}

/**
 * Keep a bounded, in-memory revision log. Old clients fall back to one reset;
 * active clients receive only the compact overview and changed resource rows.
 */
export function createIncrementalSnapshotStore({
  epoch,
  maxHistory = 32,
  maxHistoryBytes = 16 * 1024 * 1024,
} = {}) {
  const storeEpoch = epoch || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let revision = 0;
  let current = null;
  let submissionJson = "";
  let gpuMetaJson = "";
  let gpuEpisodeJson = new Map();
  let history = [];
  let historyBytes = 0;

  function publish(snapshot) {
    const next = splitSnapshotResources(snapshot);
    const nextSubmissionJson = JSON.stringify(next.submissionTracker);
    const nextGpuMeta = gpuMeta(next.gpuUsage);
    const nextGpuMetaJson = JSON.stringify(nextGpuMeta);
    const nextGpuEpisodes = episodeMap(next.gpuUsage);
    const nextGpuEpisodeJson = new Map(
      [...nextGpuEpisodes].map(([id, episode]) => [id, JSON.stringify(episode)]),
    );

    if (!current) {
      revision = 1;
      current = next;
      submissionJson = nextSubmissionJson;
      gpuMetaJson = nextGpuMetaJson;
      gpuEpisodeJson = nextGpuEpisodeJson;
      return revision;
    }

    const patch = {};
    const overviewPatch = overviewDelta(current.overview, next.overview);
    if (overviewPatch) patch.overviewDelta = overviewPatch;
    if (nextSubmissionJson !== submissionJson) {
      patch.submissionTracker = next.submissionTracker;
    }

    const upserts = [];
    const removes = [];
    for (const [id, episode] of nextGpuEpisodes) {
      if (nextGpuEpisodeJson.get(id) !== gpuEpisodeJson.get(id)) {
        upserts.push(episode);
      }
    }
    for (const id of gpuEpisodeJson.keys()) {
      if (!nextGpuEpisodeJson.has(id)) removes.push(id);
    }
    if (
      nextGpuMetaJson !== gpuMetaJson ||
      upserts.length > 0 ||
      removes.length > 0
    ) {
      patch.gpuUsage = {
        meta: nextGpuMeta,
        upserts,
        removes,
      };
    }

    if (Object.keys(patch).length === 0) return revision;

    revision += 1;
    const entry = {
      revision,
      patch,
      bytes: new TextEncoder().encode(JSON.stringify(patch)).byteLength,
    };
    history.push(entry);
    historyBytes += entry.bytes;
    while (
      history.length > maxHistory ||
      (historyBytes > maxHistoryBytes && history.length > 1)
    ) {
      historyBytes -= history.shift().bytes;
    }

    current = next;
    submissionJson = nextSubmissionJson;
    gpuMetaJson = nextGpuMetaJson;
    gpuEpisodeJson = nextGpuEpisodeJson;
    return revision;
  }

  function read({ clientEpoch, since, fieldDeltas = false } = {}) {
    if (!current) return null;
    const requestedRevision = Number(since);
    const minimumBaseRevision = history.length
      ? history[0].revision - 1
      : revision;
    if (
      clientEpoch !== storeEpoch ||
      !Number.isInteger(requestedRevision) ||
      requestedRevision < minimumBaseRevision ||
      requestedRevision > revision
    ) {
      return fullPayload(storeEpoch, revision, current);
    }

    const patches = history.filter(
      (entry) => entry.revision > requestedRevision,
    );
    const merged = {};
    const gpuUpserts = new Map();
    const gpuRemoves = new Set();
    let gpuMetaPatch = null;
    for (const { patch } of patches) {
      if (patch.overviewDelta) {
        if (fieldDeltas) (merged.overviewPatches ||= []).push(patch.overviewDelta);
        else merged.overview = current.overview; // Existing clients retain the old contract.
      }
      if (patch.submissionTracker) {
        merged.submissionTracker = patch.submissionTracker;
      }
      if (!patch.gpuUsage) continue;
      gpuMetaPatch = patch.gpuUsage.meta;
      for (const id of patch.gpuUsage.removes) {
        gpuUpserts.delete(id);
        gpuRemoves.add(id);
      }
      for (const episode of patch.gpuUsage.upserts) {
        gpuRemoves.delete(episode.id);
        gpuUpserts.set(episode.id, episode);
      }
    }
    if (gpuMetaPatch || gpuUpserts.size || gpuRemoves.size) {
      merged.gpuUsage = {
        meta: gpuMetaPatch || gpuMeta(current.gpuUsage),
        upserts: [...gpuUpserts.values()],
        removes: [...gpuRemoves],
      };
    }
    return {
      protocol: SNAPSHOT_SYNC_PROTOCOL,
      epoch: storeEpoch,
      fromRevision: requestedRevision,
      revision,
      reset: false,
      ...merged,
    };
  }

  function info() {
    return {
      protocol: SNAPSHOT_SYNC_PROTOCOL,
      epoch: storeEpoch,
      revision,
      retainedRevisions: history.length,
      retainedBytes: historyBytes,
    };
  }

  return { publish, read, info };
}

/** Merge either a reset or a delta response into the browser's local cache. */
export function applySnapshotSync(previousSnapshot, payload) {
  if (!payload || payload.protocol !== SNAPSHOT_SYNC_PROTOCOL) {
    throw new Error("不支持的 Snapshot 增量协议");
  }
  if (payload.reset) {
    if (!payload.overview || !payload.gpuUsage || !payload.submissionTracker) {
      throw new Error("Snapshot reset 缺少完整资源");
    }
    return preserveSnapshotSessions(previousSnapshot, {
      ...payload.overview,
      gpuUsage: payload.gpuUsage,
      submissionTracker: payload.submissionTracker,
    });
  }
  if (!previousSnapshot) {
    throw new Error("本地 Snapshot 缓存缺失，无法应用增量");
  }

  let gpuUsage = previousSnapshot.gpuUsage;
  if (payload.gpuUsage) {
    const episodes = episodeMap(gpuUsage);
    for (const id of payload.gpuUsage.removes || []) episodes.delete(id);
    for (const episode of payload.gpuUsage.upserts || []) {
      episodes.set(episode.id, episode);
    }
    gpuUsage = {
      ...gpuUsage,
      ...(payload.gpuUsage.meta || {}),
      episodes: [...episodes.values()],
    };
  }

  let overview = { ...previousSnapshot, ...(payload.overview || {}) };
  for (const patch of payload.overviewPatches || []) overview = applyOverviewDelta(overview, patch);
  return preserveSnapshotSessions(previousSnapshot, {
    ...overview,
    gpuUsage,
    submissionTracker:
      payload.submissionTracker || previousSnapshot.submissionTracker,
  });
}
