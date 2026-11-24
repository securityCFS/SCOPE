import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { LOCAL_HOST } from "../lib/execution-host.js";
import { normalizeProjects } from "../lib/projects.js";
import { normalizeHostRuntimeConfig } from "../lib/runtime-config.js";
import { preserveSession } from "../lib/session-cache-guard.js";
import { excludeActiveSessions } from "../lib/session-filters.js";
import {
  emptyGpuUsageHistory,
  normalizeGpuUsageHistory,
} from "./gpu-usage-history.mjs";
import { archiveSessionCache } from "./session-cache-archive.mjs";

export function normalizeHistoryIndex(parsed) {
  const normalized = {
    version: 1,
    updatedAt:
      typeof parsed?.updatedAt === "string" ? parsed.updatedAt : null,
    hosts: {},
  };
  if (!parsed?.hosts || typeof parsed.hosts !== "object") return normalized;
  for (const [alias, host] of Object.entries(parsed.hosts)) {
    if (!host?.orders || typeof host.orders !== "object") continue;
    const orders = {};
    for (const order of ["recent", "oldest"]) {
      const entry = host.orders[order];
      if (!entry || !Array.isArray(entry.sessions)) continue;
      orders[order] = {
        scannedAt:
          typeof entry.scannedAt === "string" ? entry.scannedAt : null,
        totalFiles: Number(entry.totalFiles) || 0,
        truncated: Boolean(entry.truncated),
        sessions: entry.sessions,
      };
    }
    normalized.hosts[alias] = { orders };
  }
  return normalized;
}

export function createStatePersistence({
  STATE_DIR,
  STATE_FILE,
  GPU_USAGE_HISTORY_FILE,
  SNAPSHOT_CACHE_FILE,
  HISTORY_INDEX_FILE,
  sessionKey,
  appServerManager,
  localCodex,
  historicalSessions,
  hostNextScanAt,
  hostFailureStreaks,
  getSnapshot,
  setSnapshot,
  getManagementState,
  setManagementState,
  setGpuUsageHistory,
  getGpuUsageHistory,
  getHistoryIndex,
  setHistoryIndex,
  enrichAgentRelations = null,
}) {
  let stateWritePromise = Promise.resolve();
  let gpuUsageWritePromise = Promise.resolve();
  let snapshotWritePromise = Promise.resolve();
  let historyIndexWritePromise = Promise.resolve();
  let lastSnapshotPersistAt = 0;

  async function loadManagementState() {
    try {
      const parsed = JSON.parse(await readFile(STATE_FILE, "utf8"));
      setManagementState({
        operatorName:
          typeof parsed?.operatorName === "string" && parsed.operatorName.trim()
            ? parsed.operatorName.trim().slice(0, 40)
            : "Operator",
        sessions:
          parsed?.sessions && typeof parsed.sessions === "object"
            ? parsed.sessions
            : {},
        projects: normalizeProjects(parsed?.projects),
        hostRuntimeConfigs:
          parsed?.hostRuntimeConfigs &&
          typeof parsed.hostRuntimeConfigs === "object"
            ? Object.fromEntries(
                Object.entries(parsed.hostRuntimeConfigs).map(([host, config]) => [
                  host,
                  normalizeHostRuntimeConfig(config),
                ]),
              )
            : {},
        resourcePolicy: {
          prompt:
            typeof parsed?.resourcePolicy?.prompt === "string"
              ? parsed.resourcePolicy.prompt
              : "",
          updatedAt: parsed?.resourcePolicy?.updatedAt || null,
          version: Number(parsed?.resourcePolicy?.version) || 0,
        },
      });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.error(`无法读取 ${STATE_FILE}: ${error.message}`);
      }
    }
  }

  async function loadGpuUsageHistory() {
    try {
      setGpuUsageHistory(
        normalizeGpuUsageHistory(
          JSON.parse(await readFile(GPU_USAGE_HISTORY_FILE, "utf8")),
        ),
      );
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.error(
          `无法读取 ${GPU_USAGE_HISTORY_FILE}: ${error.message}`,
        );
      }
      setGpuUsageHistory(emptyGpuUsageHistory());
    }
  }

  async function loadSnapshotCache() {
    try {
      const parsed = JSON.parse(await readFile(SNAPSHOT_CACHE_FILE, "utf8"));
      const cachedSnapshot = parsed?.snapshot;
      if (!cachedSnapshot || !Array.isArray(cachedSnapshot.hosts)) return;
      await archiveSessionCache(path.join(STATE_DIR, "session-cache-versions"), cachedSnapshot);
      const snapshot = getSnapshot();
      setSnapshot({
        ...snapshot,
        ...cachedSnapshot,
        hosts: [localCodex.host(), ...cachedSnapshot.hosts.filter(h => h.alias !== LOCAL_HOST)],
        scanning: true,
        cached: true,
        cacheSavedAt: parsed.savedAt || cachedSnapshot.generatedAt || null,
      });
      lastSnapshotPersistAt = Date.parse(parsed.savedAt || "") || 0;
      const deferOfflineUntil = Date.now() + 60_000;
      for (const host of cachedSnapshot.hosts) {
        if (host?.alias && !host.reachable) {
          hostNextScanAt.set(host.alias, deferOfflineUntil);
          hostFailureStreaks.set(host.alias, 1);
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.error(`无法读取 ${SNAPSHOT_CACHE_FILE}: ${error.message}`);
      }
    }
  }

  async function loadHistoryIndex() {
    try {
      const historyIndex = normalizeHistoryIndex(
        JSON.parse(await readFile(HISTORY_INDEX_FILE, "utf8")),
      );
      setHistoryIndex(historyIndex);
      await archiveSessionCache(path.join(STATE_DIR, "session-cache-versions"), {
        hosts: Object.entries(historyIndex.hosts).map(([alias, host]) => ({ alias,
          sessions: Object.values(host.orders || {}).flatMap(entry => entry.sessions.map(a => a.rollout).filter(Boolean)),
        })),
      });
      for (const host of Object.values(historyIndex.hosts)) {
        for (const entry of Object.values(host.orders || {})) {
          for (const agent of entry.sessions || []) {
            if (agent?.host && agent?.rollout?.id) {
              historicalSessions.set(
                sessionKey(agent.host, agent.rollout.id),
                agent,
              );
            }
          }
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.error(`无法读取 ${HISTORY_INDEX_FILE}: ${error.message}`);
      }
      setHistoryIndex(normalizeHistoryIndex(null));
    }
  }

  function persistSnapshotCache(force = false) {
    const now = Date.now();
    if (!force && now - lastSnapshotPersistAt < 60_000) {
      return snapshotWritePromise;
    }
    lastSnapshotPersistAt = now;
    const savedAt = new Date(now).toISOString();
    const cachedSnapshot = {
      ...getSnapshot(),
      scanning: false,
      cached: false,
      cacheSavedAt: savedAt,
    };
    const serialized = `${JSON.stringify({
      version: 1,
      savedAt,
      snapshot: cachedSnapshot,
    })}\n`;
    snapshotWritePromise = snapshotWritePromise
      .catch(() => {})
      .then(async () => {
        await mkdir(STATE_DIR, { recursive: true });
        await archiveSessionCache(path.join(STATE_DIR, "session-cache-versions"), cachedSnapshot);
        const temporary = `${SNAPSHOT_CACHE_FILE}.tmp`;
        await writeFile(temporary, serialized, "utf8");
        await rename(temporary, SNAPSHOT_CACHE_FILE);
      });
    return snapshotWritePromise;
  }

  function persistHistoryIndex() {
    const historyIndex = getHistoryIndex();
    const historyToArchive = { hosts: Object.entries(historyIndex.hosts).map(([alias, host]) => ({
      alias, sessions: Object.values(host.orders || {}).flatMap(entry => entry.sessions.map(a => a.rollout).filter(Boolean)),
    })) };
    const serialized = `${JSON.stringify(historyIndex)}\n`;
    historyIndexWritePromise = historyIndexWritePromise
      .catch(() => {})
      .then(async () => {
        await mkdir(STATE_DIR, { recursive: true });
        await archiveSessionCache(path.join(STATE_DIR, "session-cache-versions"), historyToArchive);
        const temporary = `${HISTORY_INDEX_FILE}.tmp`;
        await writeFile(temporary, serialized, "utf8");
        await rename(temporary, HISTORY_INDEX_FILE);
      });
    return historyIndexWritePromise;
  }

  function revealUnarchivedSession(host, sessionId, thread = null) {
    const key = sessionKey(host, sessionId);
    const current = historicalSessions.get(key);
    const activePath =
      thread?.path ||
      current?.rollout?.path?.replace(
        "/.codex/archived_sessions/",
        "/.codex/sessions/",
      ) ||
      "";
    if (current?.rollout) {
      historicalSessions.set(key, {
        ...current,
        rollout: {
          ...current.rollout,
          archived: false,
          path: activePath || current.rollout.path,
        },
      });
    }
    const indexedHost = getHistoryIndex().hosts[host];
    if (indexedHost?.orders) {
      for (const entry of Object.values(indexedHost.orders)) {
        if (!Array.isArray(entry?.sessions)) continue;
        entry.sessions = entry.sessions.map((agent) =>
          agent?.rollout?.id === sessionId
            ? {
                ...agent,
                rollout: {
                  ...agent.rollout,
                  archived: false,
                  path: activePath || agent.rollout.path,
                },
              }
            : agent,
        );
      }
    }
  }

  function cachedHistoryResult(requestedHost, limit, requestedOrder) {
    const snapshot = getSnapshot();
    const historyIndex = getHistoryIndex();
    const activeSessions = [
      ...snapshot.hosts.flatMap((host) =>
        host.agents
          .filter((agent) => agent.rollout?.id)
          .map((agent) => ({ ...agent, host: host.alias })),
      ),
      ...appServerManager.sessionRecords(),
    ];
    const aliases =
      requestedHost === "all"
        ? Object.keys(historyIndex.hosts).sort()
        : [requestedHost];
    const hosts = [];
    const sessions = [];
    let scannedAt = null;
    for (const alias of aliases) {
      const entry = historyIndex.hosts[alias]?.orders?.[requestedOrder];
      if (!entry) continue;
      const liveHost = snapshot.hosts.find((item) => item.alias === alias);
      const hostSessions = excludeActiveSessions(
        entry.sessions,
        activeSessions,
      )
        .slice(0, limit)
        .map((agent) =>
          liveHost && enrichAgentRelations
            ? enrichAgentRelations(liveHost, agent)
            : agent,
        );
      sessions.push(...hostSessions);
      hosts.push({
        host: alias,
        totalFiles: entry.totalFiles,
        truncated: entry.truncated || entry.sessions.length > limit,
        returned: hostSessions.length,
        error: null,
        cached: true,
      });
      if (!scannedAt || Date.parse(entry.scannedAt || "") > Date.parse(scannedAt)) {
        scannedAt = entry.scannedAt;
      }
    }
    sessions.sort((left, right) => {
      const difference =
        (right.lastActivityAt || 0) - (left.lastActivityAt || 0);
      return requestedOrder === "recent" ? difference : -difference;
    });
    return {
      ok: true,
      cached: hosts.length > 0,
      scope: requestedHost,
      limit,
      order: requestedOrder,
      scannedAt,
      sessions,
      hosts,
    };
  }

  function updateHistoryIndex(scans, requestedOrder, scannedAt) {
    const historyIndex = getHistoryIndex();
    let changed = false;
    for (const scan of scans) {
      if (scan.error) continue;
      const current = historyIndex.hosts[scan.host] || { orders: {} };
      const retained = new Map((current.orders[requestedOrder]?.sessions || []).map(a => [a.rollout?.id || a.id, a]));
      for (const agent of scan.sessions) {
        const id = agent.rollout?.id || agent.id;
        const old = retained.get(id);
        retained.set(id, { ...agent, rollout: preserveSession(old?.rollout, agent.rollout) });
      }
      historyIndex.hosts[scan.host] = {
        ...current,
        orders: {
          ...current.orders,
          [requestedOrder]: {
            scannedAt,
            totalFiles: scan.totalFiles,
            truncated: scan.truncated,
            sessions: [...retained.values()],
          },
        },
      };
      changed = true;
    }
    if (changed) historyIndex.updatedAt = scannedAt;
    return changed;
  }

  function persistManagementState() {
    const serialized = `${JSON.stringify(getManagementState(), null, 2)}\n`;
    stateWritePromise = stateWritePromise
      .catch(() => {})
      .then(async () => {
        await mkdir(STATE_DIR, { recursive: true });
        const temporary = `${STATE_FILE}.tmp`;
        await writeFile(temporary, serialized, "utf8");
        await rename(temporary, STATE_FILE);
      });
    return stateWritePromise;
  }

  function persistGpuUsageHistory() {
    const serialized = `${JSON.stringify(getGpuUsageHistory())}\n`;
    gpuUsageWritePromise = gpuUsageWritePromise
      .catch(() => {})
      .then(async () => {
        await mkdir(STATE_DIR, { recursive: true });
        const temporary = `${GPU_USAGE_HISTORY_FILE}.tmp`;
        await writeFile(temporary, serialized, "utf8");
        await rename(temporary, GPU_USAGE_HISTORY_FILE);
      });
    return gpuUsageWritePromise;
  }

  return {
    loadManagementState,
    loadGpuUsageHistory,
    loadSnapshotCache,
    loadHistoryIndex,
    persistSnapshotCache,
    persistHistoryIndex,
    revealUnarchivedSession,
    cachedHistoryResult,
    updateHistoryIndex,
    persistManagementState,
    persistGpuUsageHistory,
  };
}
