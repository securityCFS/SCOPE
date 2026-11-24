import { loadDeploymentProfile } from "./deployment-profile.mjs";
import { nativeSessionState } from "./providers/native-session-state.mjs";
import { idleSessionTimeout, startIdleSessionReaper } from "./idle-sessions.mjs";
import { submissionSettingsRoutes } from "./submissions/settings.mjs";
import { PluginRegistry } from "./plugins/registry.mjs";
import { loadExternalPlugins } from "./plugins/external.mjs";
import { pluginRoutes } from "./plugins/routes.mjs";
import { createAliyunDlcPlugin } from "./plugins/aliyun-dlc/index.mjs";
const deployment = loadDeploymentProfile();
import { SessionCatalog } from "./session-catalog/catalog.mjs";
import { catalogRoutes } from "./session-catalog/routes.mjs";
import { NativeModels } from "./providers/native-models.mjs";
import { NativeCommands } from "./providers/native-commands.mjs";
import { sessionCommandRoutes } from "./routes/session-commands.mjs";
import { CliConversations } from "./providers/conversations.mjs";
import { cliConversationRoutes } from "./providers/conversation-routes.mjs";
import { AgentMaintenance } from "./maintenance/service.mjs";
import { maintenanceRoutes } from "./maintenance/routes.mjs";
import { localHistoryReader } from "./local/history.mjs";
import { LOCAL_HOST } from "../lib/execution-host.js";
import { LocalCodexRuntime } from "./local/runtime.mjs";
import { localDirectories, localDirectory } from "./local/directories.mjs";
import { sessionArchiveService } from "./archive/service.mjs";
import { archiveRoutes } from "./archive/routes.mjs";
import { createSshCommand, shellQuote } from "./transport/ssh-command.mjs";
import { readJsonBody, jsonResponse, requestHandler } from "./http.mjs";
import { modelRoutes } from './routes/models.mjs';
import { dialogueRoutes } from './routes/dialogue.mjs';
import { runtimeRoutes } from './routes/runtime.mjs';
import { authRoutes } from './routes/accounts.mjs';
import { emailRoutes } from "./routes/email.mjs";
import { systemRoutes } from "./routes/system.mjs";
import { sessionLifecycleRoutes } from "./routes/session-lifecycle.mjs";
import { managementRoutes } from "./routes/management.mjs";
import { sessionDeliveryRoutes } from "./routes/session-delivery.mjs";
import { RemoteTunnelManager } from "./remote-bootstrap/tunnels.mjs";
import { RemoteBootstrapService } from "./remote-bootstrap/service.mjs";
import { remoteBootstrapRoutes } from "./remote-bootstrap/routes.mjs";
import { PROFILE_LIST_PROBE, PROFILE_WRITE_PROBE, PROFILE_CANCEL_PROBE, PROFILE_DELETE_PROBE, REMOTE_PROBE, DIALOGUE_PROBE, RAW_CONTEXT_PROBE, TAKEOVER_PROBE, APP_SERVER_WRITER_PROBE } from './probes/index.mjs';
import { REMOTE_DIRECTORY_PROBE } from "./workbench/directory-probe.mjs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WorkbenchStore } from "./workbench/store.mjs";
import { directoryRoutes } from "./workbench/directory-routes.mjs";
import { conversationRoutes } from "./workbench/conversation-routes.mjs";
import { WorkbenchService } from "./workbench/service.mjs";
import { workbenchRoutes } from "./workbench/routes.mjs";
import { remoteCliAdapter } from "./providers/remote-cli.mjs";
import { codexWorkbenchAdapter } from "./providers/codex-workbench.mjs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AppServerManager,
  JsonlAppServerConnection,
  isAuthenticationRefreshError,
} from "./app-server-client.mjs";
import { WebSocketJsonlChild } from "./app-server-websocket-transport.mjs";
import { remoteResumeValidator } from "./remote-rollout-locks.mjs";
import { profileCapacityRetryDelays } from "./profile-capacity-policy.mjs";
import { HostSessionRestarts } from "./host-session-restart.mjs";
import {
  CodexUpgrades,
  parseCodexUpgradeOutput,
  remoteCodexUpgradeScript,
  stableVersion,
  wrapCodexUpgradeCommand,
} from "./codex-upgrade.mjs";
import { SessionProfileAssignments, sessionProfileKey, profileFromConnection, boundConnectionKey, profileHandoffPending } from "./session-profiles.mjs";
import { modelCatalogTarget, modelCatalogHomeCommands } from "./model-catalog.mjs";
import {
  emptyGpuUsageHistory,
  updateGpuUsageHistory,
} from "./gpu-usage-history.mjs";
import {
  createEmailNotifier,
  dlcAlertEmailEvent,
  humanRequestEmailEvent,
} from "./email-notifier.mjs";
import {
  AuthProfileManager,
  normalizeProfileName,
} from "./auth-profile-manager.mjs";
import {
  markProfileUnavailable,
  orderedReadyProfileCandidates,
  publicProfileFailoverJob,
} from "./auth-profile-failover.mjs";
import { createIncrementalSnapshotStore } from "../lib/incremental-snapshot.js";
import { preserveHostSessions } from "../lib/session-cache-guard.js";
import { guardPersistentCodexHome } from "./persistent-home-guard.mjs";
import { sshAliasesForHostname } from "../lib/ssh-config.js";
import {
  normalizeHostRuntimeConfig,
  runtimePolicy,
} from "../lib/runtime-config.js";
import {
  durableRemoteAppServerCommand,
  retireProfileAppServerCommand,
  retireScopedAppServerCommand,
  wrapBootstrapAppServer,
} from "./remote-app-server-command.mjs";
import {
  createAgentEnricher,
  heuristicSummary,
  historicalAgent,
} from "./rollout-summary.mjs";
import { createStatePersistence } from "./state-persistence.mjs";
import { createAttachmentStore } from "./attachment-store.mjs";
import { createResearchInsights } from "./research/insights.mjs";
import { createTmuxDelivery } from "./tmux-delivery.mjs";
import {
  cleanSshError,
  createInventoryScanner,
  mapLimit,
  parseSshAliases,
} from "./inventory-scanner.mjs";
import { attachTerminalGateway } from "./terminal-gateway.mjs";
import {
  createAccountQuotaService,
  readLocalAuthProfiles,
} from "./account-quotas.mjs";

const PORT = Number(process.env.SCOPE_BRIDGE_PORT || 4815);
const UI_PORT = Number(process.env.SCOPE_UI_PORT || 3000);
const HOST = "127.0.0.1";
const TRUSTED_BROWSER_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://[::1]:3000",
  `http://localhost:${UI_PORT}`,
  `http://127.0.0.1:${UI_PORT}`,
  `http://[::1]:${UI_PORT}`,
]);
const SSH_CONFIG =
  process.env.SCOPE_SSH_CONFIG || path.join(os.homedir(), ".ssh", "config");
const POLL_MS = Math.max(5_000, Number(process.env.SCOPE_POLL_MS || 15_000));
const SSH_TIMEOUT_MS = Math.max(
  2_000,
  Number(process.env.SCOPE_SSH_TIMEOUT_MS || 7_000),
);
const INVENTORY_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.SCOPE_INVENTORY_TIMEOUT_MS || 20_000),
);
const INVENTORY_STALE_GRACE_MS = Math.max(
  60_000,
  Number(process.env.SCOPE_INVENTORY_STALE_GRACE_MS || 10 * 60_000),
);
const CONCURRENCY = Math.max(
  1,
  Math.min(12, Number(process.env.SCOPE_CONCURRENCY || 6)),
);
const STATE_DIR = process.env.SCOPE_STATE_DIR
  ? path.resolve(process.env.SCOPE_STATE_DIR)
  : path.resolve(process.cwd(), ".scope");
const localCodex = new LocalCodexRuntime(STATE_DIR);
const persistentCodexHomes = JSON.parse(await readFile(path.join(STATE_DIR, "persistent-codex-homes.json"), "utf8").catch(error => {
  if (error.code === "ENOENT") return "{}";
  throw error;
}));
const STATE_FILE = path.join(STATE_DIR, "state.json");
const GPU_USAGE_HISTORY_FILE = path.join(STATE_DIR, "gpu-usage-history.json");
const SNAPSHOT_CACHE_FILE = path.join(STATE_DIR, "snapshot-cache.json");
const HISTORY_INDEX_FILE = path.join(STATE_DIR, "history-index.json");
const AUTH_RESTART_JOBS_FILE = path.join(STATE_DIR, "auth-restart-jobs.json");
const APP_SERVER_SESSIONS_FILE = path.join(
  STATE_DIR,
  "app-server-sessions.json",
);
const LIFECYCLE_AUDIT_FILE = path.join(STATE_DIR, "lifecycle-audit.jsonl");
const EMAIL_NOTIFICATION_CONFIG_FILE = path.join(
  STATE_DIR,
  "email-notifications.json",
);
const EMAIL_NOTIFICATION_STATE_FILE = path.join(
  STATE_DIR,
  "email-notification-state.json",
);
const SUMMARY_TIMEOUT_MS = Math.max(
  20_000,
  Number(process.env.SCOPE_SUMMARY_TIMEOUT_MS || 75_000),
);
const DIALOGUE_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.SCOPE_DIALOGUE_TIMEOUT_MS || 30_000),
);
const HISTORY_TIMEOUT_MS = Math.max(
  20_000,
  Number(process.env.SCOPE_HISTORY_TIMEOUT_MS || 60_000),
);
const ASSISTANT_SEARCH_TIMEOUT_MS = Math.max(
  20_000,
  Number(process.env.SCOPE_ASSISTANT_SEARCH_TIMEOUT_MS || 45_000),
);
const ASSISTANT_CODEX_TIMEOUT_MS = Math.max(
  20_000,
  Number(process.env.SCOPE_ASSISTANT_CODEX_TIMEOUT_MS || 120_000),
);
const DEFAULT_SUBMISSION_WINDOW_DAYS = Math.max(
  1,
  Math.min(365, Number(process.env.SCOPE_SUBMISSION_WINDOW_DAYS || 1)),
);
const TAKEOVER_TIMEOUT_MS = Math.max(
  15_000,
  Number(process.env.SCOPE_TAKEOVER_TIMEOUT_MS || 30_000),
);
const APP_SERVER_TIMEOUT_MS = Math.max(
  15_000,
  Number(process.env.SCOPE_APP_SERVER_TIMEOUT_MS || 45_000),
);
const AUTH_LOGIN_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.SCOPE_AUTH_LOGIN_TIMEOUT_MS || 120_000),
);
const ATTACHMENT_TTL_MS = 6 * 60 * 60 * 1_000;
const ATTACHMENT_UPLOAD_TIMEOUT_MS = 2 * 60 * 1_000;
const AUTH_PROFILE_FAILOVER_WAIT_MS = Math.max(
  2_000,
  Number(process.env.SCOPE_AUTH_PROFILE_FAILOVER_WAIT_MS || 5_000),
);
const PROXY_BOOTSTRAP_HOSTS = new Set(deployment.proxyBootstrapHosts);

let snapshot = {
  generatedAt: null,
  scanning: true,
  cached: false,
  cacheSavedAt: null,
  sshConfig: SSH_CONFIG,
  hosts: [localCodex.host()],
  summary: { hosts: 0, online: 0, codex: 0, tmux: 0, attention: 0 },
  management: null,
};
let scanPromise = null;
let authRestartWritePromise = Promise.resolve();
let appServerSessionWritePromise = Promise.resolve();
let lifecycleAuditWritePromise = Promise.resolve();
const persistedAppServerSessions = new Map();
let appServerSessionsLoaded = false;
let appServerRestorePromise = null;
const appServerRestoreFailures = new Map();
const appServerReconnectTimers = new Map();
const appServerReconnectAttempts = new Map();
const appServerReconnectInFlight = new Set();
const appServerHostRecoveryJobs = new Map();
const appServerAuthRecoveryJobs = new Map();
const appServerAuthRecoveryHosts = new Set();
const appServerActiveAuthFailoverJobs = new Map();
const authProfileFailedUntil = new Map();

function auditLifecycle(action, details = {}) {
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    action,
    ...details,
  })}\n`;
  lifecycleAuditWritePromise = lifecycleAuditWritePromise
    .catch(() => {})
    .then(async () => {
      await mkdir(STATE_DIR, { recursive: true });
      await appendFile(LIFECYCLE_AUDIT_FILE, line, "utf8");
    })
    .catch((error) =>
      console.error(`lifecycle audit 写入失败：${error.message}`),
    );
  return lifecycleAuditWritePromise;
}
const sshOperationCounts = new Map();
const inventoryOperations = new Map();
const hostFailureStreaks = new Map();
const hostNextScanAt = new Map();

const clients = new Map();
const snapshotSyncStore = createIncrementalSnapshotStore({
  epoch: randomUUID(),
  maxHistory: 32,
  maxHistoryBytes: 16 * 1024 * 1024,
});
let snapshotNotifyTimer = null;
const takeoverHostQueues = new Map();
const authRestartJobs = new Map();
const historicalSessions = new Map();
let historyIndex = {
  version: 1,
  updatedAt: null,
  hosts: {},
};
const plugins = new PluginRegistry();
const aliyunPlugin = createAliyunDlcPlugin({
  stateDirectory: STATE_DIR, legacyHost: deployment.dlcHostname,
  defaultWindowDays: DEFAULT_SUBMISSION_WINDOW_DAYS,
  context: () => ({ readSshConfig: () => readFile(SSH_CONFIG, "utf8"), sshAliasesForHostname,
    getSnapshot: () => snapshot, runSshCommand, cleanSshError, mapLimit, findAgent,
    getManagement: () => managementState, sessionKey, heuristicSummary }),
  notify: notifyClients, onScanComplete: syncDlcAlertNotifications,
});
plugins.register(aliyunPlugin);
loadExternalPlugins(plugins, STATE_DIR);

let gpuUsageHistory = emptyGpuUsageHistory();
let managementState = {
  operatorName: "Operator",
  sessions: {},
  projects: [],
  hostRuntimeConfigs: {},
  resourcePolicy: {
    prompt: "",
    updatedAt: null,
    version: 0,
  },
};

function defaultHostRuntimeConfig(host) {
  return normalizeHostRuntimeConfig({
    preLaunchCommand: PROXY_BOOTSTRAP_HOSTS.has(host) ? (process.env.SCOPE_HOST_BOOTSTRAP_COMMAND?.trim() || "") : "",
    yolo: true,
  });
}

function hostRuntimeConfig(host, override = null) {
  const stored = normalizeHostRuntimeConfig(
    managementState.hostRuntimeConfigs?.[host],
    defaultHostRuntimeConfig(host),
  );
  return normalizeHostRuntimeConfig(override, stored);
}

function sessionYolo(rollout, fallback = true) {
  if (
    rollout?.approvalPolicy === "never" &&
    ["danger-full-access", "dangerFullAccess"].includes(
      rollout?.sandboxPolicy,
    )
  ) {
    return true;
  }
  if (rollout?.approvalPolicy || rollout?.sandboxPolicy) return false;
  return fallback !== false;
}

async function saveHostRuntimeConfig(host, value) {
  const config = {
    ...hostRuntimeConfig(host, value),
    updatedAt: new Date().toISOString(),
  };
  managementState = {
    ...managementState,
    hostRuntimeConfigs: {
      ...managementState.hostRuntimeConfigs,
      [host]: config,
    },
  };
  await persistManagementState();
  notifyClients();
  return config;
}
const emailNotifier = await createEmailNotifier({
  configPath: EMAIL_NOTIFICATION_CONFIG_FILE,
  statePath: EMAIL_NOTIFICATION_STATE_FILE,
});
let humanRequestNotificationsPrimed = false;
let dlcAlertNotificationsPrimed = false;

function sessionKey(host, sessionId) {
  return `${host}:${sessionId}`;
}

async function withTakeoverHostQueue(host, operation) {
  const previous = takeoverHostQueues.get(host) || Promise.resolve();
  let release;
  const turn = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => turn);
  takeoverHostQueues.set(host, tail);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (takeoverHostQueues.get(host) === tail) {
      takeoverHostQueues.delete(host);
    }
  }
}

const enrichAgentRelations = createAgentEnricher({
  getSubmissionItems: () => aliyunPlugin.snapshot().items,
});
const {
  storeUploadedAttachment,
  resolveUploadedAttachments,
  streamAttachmentToHost,
} = createAttachmentStore({
  cleanSshError,
  inventoryOperations,
  sshOperationCounts,
  SSH_TIMEOUT_MS,
  ATTACHMENT_TTL_MS,
  ATTACHMENT_UPLOAD_TIMEOUT_MS,
});
const { runSsh, parseHost } = createInventoryScanner({
  REMOTE_PROBE,
  shellQuote,
  guardPersistentCodexHome,
  persistentCodexHomes,
  SSH_TIMEOUT_MS,
  INVENTORY_TIMEOUT_MS,
  inventoryOperations,
  spawn,
  heuristicSummary,
  preserveHostSessions,
});

function publicGpuUsage(hosts) {
  const episodes = gpuUsageHistory.episodes.map((episode) => {
    const host = hosts.find((candidate) => candidate.alias === episode.host);
    const agent = host?.agents.find(
      (candidate) => candidate.rollout?.id === episode.ownerSessionId,
    );
    const session = host?.sessions.find(
      (candidate) => candidate.id === episode.ownerSessionId,
    );
    const managed = episode.ownerSessionId
      ? managementState.sessions[
          sessionKey(episode.host, episode.ownerSessionId)
        ] || {}
      : {};
    return {
      ...episode,
      sessionTheme:
        managed.displayName ||
        managed.summary?.theme ||
        agent?.suggestedSummary?.theme ||
        episode.sessionTheme ||
        session?.lastUser ||
        "",
      sessionCwd:
        agent?.cwd || session?.cwd || episode.sessionCwd || episode.cwd,
      sessionActive: Boolean(agent),
    };
  });
  return {
    updatedAt: gpuUsageHistory.updatedAt,
    retentionHours: gpuUsageHistory.retentionHours,
    episodes,
  };
}

function publicSnapshot() {
  const appServer = appServerManager.publicState();
  appServer.sessions = appServer.sessions.map((session) => ({ ...session,
    profileAssignment: sessionProfileAssignment(session.host, session.sessionId),
  }));
  appServer.restorePending = Array.from(persistedAppServerSessions.values())
    .filter(
      (record) =>
        !appServerManager.isManaged(record.host, record.sessionId),
    )
    .map((record) => {
      const failure = appServerRestoreFailures.get(
        sessionKey(record.host, record.sessionId),
      );
      return {
        host: record.host,
        sessionId: record.sessionId,
        cwd: record.cwd,
        error: failure?.error || null,
        attempt: failure?.attempt || 0,
        retryAt: failure?.retryAt
          ? new Date(failure.retryAt).toISOString()
          : null,
      };
    });
  const hosts = snapshot.hosts.map((host) => ({
    ...host,
    agents: host.agents.filter(agent => !["archived", "restoring"].includes(managementState.sessions[sessionKey(host.alias, agent.rollout?.id)]?.archive?.phase)).map((agent) => ({
        ...agent,
        mapping: { ...agent.mapping },
        capacityRecovery: publicTmuxCapacityRecovery(agent),
      })),
  }));
  for (const managed of appServer.sessions) {
    const host = hosts.find((candidate) => candidate.alias === managed.host);
    if (!host) continue;
    const existing = host.agents.find(
      (agent) => agent.rollout?.id === managed.sessionId,
    );
    if (existing) {
      existing.appServerManaged = true;
      existing.transport = "app-server";
      existing.status =
        managed.status === "offline" ? "attention" : managed.status;
      existing.capacityRecovery = managed.capacityRecovery || null;
      if (existing.rollout) {
        const policy = runtimePolicy(managed.yolo);
        existing.rollout = {
          ...existing.rollout,
          model: managed.model || existing.rollout.model || "",
          reasoningEffort:
            managed.effort || existing.rollout.reasoningEffort || "",
          approvalPolicy: policy.approvalPolicy,
          sandboxPolicy: policy.sandbox,
        };
      }
      continue;
    }
    const storedRollout = host.sessions.find(
      (session) => session.id === managed.sessionId,
    );
    const managedPolicy = runtimePolicy(managed.yolo);
    const rollout = storedRollout
      ? {
          ...storedRollout,
          model: managed.model || storedRollout.model || "",
          reasoningEffort:
            managed.effort || storedRollout.reasoningEffort || "",
          approvalPolicy: managedPolicy.approvalPolicy,
          sandboxPolicy: managedPolicy.sandbox,
        }
      : {
          id: managed.sessionId,
          rootSessionId: managed.sessionId,
          cwd: managed.cwd || "",
          path: managed.path || null,
          model: managed.model || "",
          reasoningEffort: managed.effort || "",
          approvalPolicy: managedPolicy.approvalPolicy,
          sandboxPolicy: managedPolicy.sandbox,
          mtimeMs:
            Date.parse(managed.lastEventAt || managed.connectedAt) || Date.now(),
          startedAt: managed.connectedAt,
          lastEventAt: managed.lastEventAt,
          firstUser: "",
          lastUser: "",
          lastAssistant: "",
          lastAction: "",
          lastError: "",
          userMessages: [],
          assistantMessages: [],
          launches: [],
          turnState: managed.status,
        };
    host.agents.push({
      id: `app-server:${host.alias}:${managed.sessionId}`,
      host: host.alias,
      hostname: host.hostname,
      pid: 0,
      tty: "app-server",
      cwd: managed.cwd || rollout.cwd,
      executable: "codex",
      elapsedSeconds: 0,
      status: managed.status === "offline" ? "attention" : managed.status,
      pane: null,
      rollout,
      subagents: [],
      historical: false,
      appServerManaged: true,
      transport: "app-server",
      capacityRecovery: managed.capacityRecovery || null,
      mapping: {
        rollout: "app-server",
        tmux: "unmatched",
      },
      lastActivityAt:
        Date.parse(managed.lastEventAt || managed.connectedAt) ||
        rollout.mtimeMs,
      suggestedSummary: heuristicSummary(rollout, managed.cwd || rollout.cwd),
      title:
        rollout.lastUser ||
        `App-server · ${path.posix.basename(managed.cwd || rollout.cwd)}`,
    });
  }
  for (const host of hosts) {
    host.agents = host.agents.map((agent) => enrichAgentRelations(host, agent));
  }
  const allAgents = hosts.flatMap((host) => host.agents);
  const effectiveRuntimeConfigs = Object.fromEntries(
    hosts.map((host) => [host.alias, hostRuntimeConfig(host.alias)]),
  );
  return {
    ...snapshot,
    hosts,
    summary: {
      ...snapshot.summary,
      codex: allAgents.length,
      attention: allAgents.filter((agent) => agent.status === "attention")
        .length,
    },
    management: {
      ...managementState,
      hostRuntimeConfigs: effectiveRuntimeConfigs,
    },
    appServer,
    submissionTracker: aliyunPlugin.snapshot(),
    gpuUsage: publicGpuUsage(hosts),
    notifications: {
      email: emailNotifier.publicState(),
    },
  };
}

function findLiveAgent(host, sessionId) {
  const direct = snapshot.hosts
    .find((candidate) => candidate.alias === host)
    ?.agents.find((agent) => agent.rollout?.id === sessionId);
  if (direct) return direct;
  const managed = publicSnapshot()
    .hosts.find((candidate) => candidate.alias === host)
    ?.agents.find((agent) => agent.rollout?.id === sessionId);
  if (managed) return managed;
  return null;
}

function findAgent(host, sessionId) {
  const live = findLiveAgent(host, sessionId);
  if (live) return live;
  return historicalSessions.get(sessionKey(host, sessionId));
}

function temporaryRemoteCwd(value) {
  return /^\/(?:tmp|var\/tmp)(?:\/|$)/.test(String(value || ""));
}

async function recoveryAgent(agent, activeAgent, requestedCwd) {
  if (activeAgent) return agent;
  const cwd = typeof requestedCwd === "string" ? requestedCwd.trim() : "";
  if (!cwd) {
    const error = new Error(
      "历史 Session 必须明确选择新的恢复工作目录；不会使用 rollout 中记录的旧目录",
    );
    error.statusCode = 400;
    throw error;
  }
  if (temporaryRemoteCwd(cwd)) {
    const error = new Error(
      `拒绝恢复到临时目录 ${cwd}；请选择持久项目目录或 recovery worktree`,
    );
    error.statusCode = 400;
    throw error;
  }
  const preflight = await runSshCommand(
    agent.host,
    `python3 - ${shellQuote(cwd)}`,
    NEW_SESSION_PREFLIGHT,
    15_000,
  );
  if (preflight.code !== 0) {
    const error = new Error(
      `恢复工作目录不可用：${cleanSshError(preflight.stderr || preflight.stdout)}`,
    );
    error.statusCode = 400;
    throw error;
  }
  const resolved = JSON.parse(preflight.stdout.trim());
  return { ...agent, cwd: resolved.cwd };
}

const runSshCommand = createSshCommand({ inventoryOperations, operationCounts: sshOperationCounts, connectTimeoutMs: SSH_TIMEOUT_MS, audit: auditLifecycle });

async function resumeAgentInTmux(
  agent,
  pid = 0,
  model = agent?.rollout?.model || "",
  runtimeOverride = null,
) {
  if (!agent?.rollout?.id || !agent.rollout.path) {
    throw new Error("Session 缺少可恢复的 rollout 路径");
  }
  if (Number(pid) > 0) {
    throw new Error(
      "安全策略禁止接管活动 CLI/VS Code Session；请先让原 Session 正常退出，再从 Inactive 恢复",
    );
  }
  const tmuxName = `scope-${agent.rollout.id.slice(0, 8)}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );
  const runtime = hostRuntimeConfig(agent.host, runtimeOverride);
  const command = [
    "python3 -",
    shellQuote(String(pid)),
    shellQuote(agent.rollout.path),
    shellQuote(agent.cwd || "."),
    shellQuote(agent.executable || "codex"),
    shellQuote(agent.rollout.id),
    shellQuote(tmuxName),
    shellQuote(runtime.preLaunchCommand),
    shellQuote(model || ""),
    runtime.yolo ? "1" : "0",
  ].join(" ");
  const result = await withTakeoverHostQueue(agent.host, () =>
    runSshCommand(
      agent.host,
      command,
      TAKEOVER_PROBE,
      TAKEOVER_TIMEOUT_MS,
      1_000_000,
    ),
  );
  if (result.code !== 0) {
    throw new Error(cleanSshError(result.stderr || result.stdout));
  }
  try {
    const resumed = JSON.parse(result.stdout.trim());
    auditLifecycle(resumed.reused ? "tmux-reused" : "tmux-created", {
      host: agent.host,
      sessionId: agent.rollout.id,
      tmux: resumed.tmux,
      yolo: runtime.yolo,
      preLaunchConfigured: Boolean(runtime.preLaunchCommand),
      remoteSessionSignalSent: false,
    });
    return {
      ...resumed,
      yolo: runtime.yolo,
      preLaunchConfigured: Boolean(runtime.preLaunchCommand),
    };
  } catch {
    throw new Error("远端 tmux 恢复结果无法解析");
  }
}

function tmuxAgentForDelivery(agent, resumed) {
  return {
    host: agent.host,
    rollout: agent.rollout,
    pane: {
      session: resumed.tmux,
      pane: "0.0",
    },
  };
}

function rememberTmuxAgent(agent, resumed) {
  const policy = runtimePolicy(resumed.yolo);
  const record = {
    ...agent,
    rollout: agent.rollout
      ? {
          ...agent.rollout,
          approvalPolicy: policy.approvalPolicy,
          sandboxPolicy: policy.sandbox,
        }
      : agent.rollout,
    pid: resumed.panePid || agent.pid || 0,
    tty: `tmux:${resumed.target}`,
    status: "idle",
    pane: {
      session: resumed.tmux,
      pane: "0.0",
      command: resumed.paneCommand || "node",
      pid: resumed.panePid || 0,
    },
    historical: false,
    appServerManaged: false,
    transport: "tmux",
    mapping: {
      rollout: "open-fd",
      tmux: "exact",
    },
  };
  historicalSessions.set(
    sessionKey(agent.host, agent.rollout.id),
    record,
  );
  return record;
}

function spawnRemoteAppServer(
  alias,
  executable = "codex",
  connectionKey = "active",
) {
  if (alias === LOCAL_HOST) return localCodex.connect();
  const runtime = hostRuntimeConfig(alias);
  const appServerCommand = durableRemoteAppServerCommand({
    // Scanner process rows can begin with `node` because the Codex launcher is
    // a Node wrapper. `node app-server` is not Codex (and resolves as a local
    // script such as /root/app-server), so it must never become the durable
    // writer executable.
    executable: codexExecutable(executable),
    key: connectionKey === "active" ? "default" : connectionKey,
    useActiveProfile: connectionKey === "active",
    isolatedProfile: profileFromConnection(connectionKey) || "",
  });
  const bootstrapCommand = runtime.preLaunchCommand
    ? wrapBootstrapAppServer(appServerCommand, runtime.preLaunchCommand)
    : appServerCommand;
  const command = guardPersistentCodexHome(bootstrapCommand, persistentCodexHomes[alias]);
  const child = spawn(
    (typeof process !== "undefined" && process.platform === "win32" ? "ssh.exe" : "ssh"),
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectionAttempts=1",
      "-o",
      `ConnectTimeout=${Math.ceil(SSH_TIMEOUT_MS / 1000)}`,
      "-o",
      "ServerAliveInterval=20",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "TCPKeepAlive=yes",
      "--",
      alias,
      command,
    ],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  auditLifecycle("app-server-proxy-spawned", {
    host: alias,
    connectionKey,
    transport: "ssh-websocket-unix-socket",
    remoteSessionSignalSent: false,
  });
  return new WebSocketJsonlChild(child);
}

// Catalog probes run the installed CLI, never the months-old durable writer.
// They cannot acquire a research thread and exit as soon as stdin is closed.
const modelCatalogCache = new Map();
const modelCatalogJobs = new Map();
async function readInstalledModels(host, force = false, connectionKey = "active") {
  // A profile-bound session must be queried with its own credentials, but a
  // fresh CLI: durable writers can retain an obsolete model catalog for months.
  const target = modelCatalogTarget(host.alias, connectionKey);
  const catalogKey = target.key;
  const cached = modelCatalogCache.get(catalogKey);
  if (!force && cached && Date.now() - cached.fetchedAt < 60_000) return cached;
  if (modelCatalogJobs.has(catalogKey)) return modelCatalogJobs.get(catalogKey);
  const job = (async () => {
    const executable = hostCodexExecutable(host);
    const command = wrapBootstrapAppServer([
      ...modelCatalogHomeCommands(target),
      `scope_catalog_exe=$(command -v codex 2>/dev/null || printf '%s' ${shellQuote(executable)})`,
      'exec "$scope_catalog_exe" app-server --listen stdio://',
    ].join('; '), hostRuntimeConfig(host.alias).preLaunchCommand);
    const probe = new AppServerManager({
      spawnConnection: () => host.alias === LOCAL_HOST ? localCodex.probe() : spawn((typeof process !== "undefined" && process.platform === "win32" ? "ssh.exe" : "ssh"), ["-T", "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=20", "--", host.alias, command],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }),
      requestTimeoutMs: 30_000,
    });
    try {
      const models = await probe.listModels(host.alias, executable);
      const result = { models, fetchedAt: Date.now(),
        serverInfo: (await probe.prepareHost(host.alias)).serverInfo };
      modelCatalogCache.set(catalogKey, result);
      return result;
    } finally { probe.close(); }
  })().finally(() => modelCatalogJobs.delete(catalogKey));
  modelCatalogJobs.set(catalogKey, job);
  return job;
}

function hostCodexExecutable(host) {
  return (
    host?.agents
      ?.map((agent) => agent.executable)
      .find(
        (candidate) => codexExecutable(candidate) !== "codex",
      ) || "codex"
  );
}

function codexExecutable(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  // We accept the CLI command or an absolute Codex binary recorded by the
  // process scanner, but never a runtime such as node/python/bash.
  if (candidate === "codex" || /(?:^|[\\/])codex$/.test(candidate)) {
    return candidate;
  }
  return "codex";
}

function spawnRemoteProfileAppServer({ host, executable = "codex", profile }) {
  const runtime = hostRuntimeConfig(host);
  const profileHome = `$HOME/.codex/scope-auth-profiles/${profile.slug}/home`;
  // Device-auth transports are short lived and never execute research turns.
  // Keep them on JSONL stdio so cancelling or deleting a login cannot leave an
  // orphan per-profile daemon behind.
  const appServerCommand = [
    `export CODEX_HOME="${profileHome}"`,
    `exec ${shellQuote(executable || "codex")} -c cli_auth_credentials_store=file app-server --listen stdio://`,
  ].join("; ");
  const command = runtime.preLaunchCommand
    ? wrapBootstrapAppServer(appServerCommand, runtime.preLaunchCommand)
    : `sh -lc ${shellQuote(appServerCommand)}`;
  return spawn(
    (typeof process !== "undefined" && process.platform === "win32" ? "ssh.exe" : "ssh"),
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectionAttempts=1",
      "-o",
      `ConnectTimeout=${Math.ceil(SSH_TIMEOUT_MS / 1000)}`,
      "--",
      host,
      command,
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
}

function profilePayload(profile, account = null) {
  return Buffer.from(
    JSON.stringify({ name: profile.name, account }),
    "utf8",
  ).toString("base64");
}

function checkedProfileSlug(value) {
  const slug = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(slug)) {
    throw new Error("Profile 标识无效");
  }
  return slug;
}

async function runProfileWrite(host, action, profile, account = null) {
  const result = await runSshCommand(
    host,
    `python3 - ${shellQuote(action)} ${shellQuote(profile.slug)} ${shellQuote(
      profilePayload(profile, account),
    )}`,
    PROFILE_WRITE_PROBE,
    20_000,
    100_000,
  );
  if (result.code !== 0) {
    throw new Error(cleanSshError(result.stderr || result.stdout));
  }
  return JSON.parse(result.stdout.trim());
}

async function listAuthProfiles(host) {
  if (host === LOCAL_HOST) return { profiles: [], activeProfile: null, local: true };
  const result = await runSshCommand(
    host,
    "python3 -",
    PROFILE_LIST_PROBE,
    15_000,
    300_000,
  );
  if (result.code !== 0) {
    throw new Error(cleanSshError(result.stderr || result.stdout));
  }
  return JSON.parse(result.stdout.trim());
}

function failedProfilesForHost(host) {
  let failed = authProfileFailedUntil.get(host);
  if (!failed) {
    failed = new Map();
    authProfileFailedUntil.set(host, failed);
  }
  return failed;
}

async function probeAuthProfile(host, executable, profile) {
  const child = spawnRemoteProfileAppServer({ host, executable, profile });
  const connection = new JsonlAppServerConnection({
    host: `${host}:${profile.slug}:failover-probe`,
    child,
    requestTimeoutMs: Math.min(AUTH_LOGIN_TIMEOUT_MS, 45_000),
  });
  try {
    await connection.start();
    const response = await connection.request("account/read", {
      // A metadata-only read can succeed with an already decoded ID token even
      // when the refresh token is dead. Force the same refresh path used by a
      // real turn before treating a saved profile as a failover candidate.
      refreshToken: true,
    });
    if (!response?.account) {
      throw new Error("Profile 未返回可用的 Codex 账号");
    }
    return response.account;
  } finally {
    connection.close();
  }
}

async function deleteAuthProfile(host, slug) {
  const result = await runSshCommand(
    host,
    `python3 - ${shellQuote(slug)} ${shellQuote(slug)}`,
    PROFILE_DELETE_PROBE,
    15_000,
    100_000,
  );
  if (result.code !== 0) {
    throw new Error(cleanSshError(result.stderr || result.stdout));
  }
  return JSON.parse(result.stdout.trim());
}

const appServerManager = new AppServerManager({
  spawnConnection: spawnRemoteAppServer,
  validateResume: remoteResumeValidator(runSshCommand),
  requestTimeoutMs: APP_SERVER_TIMEOUT_MS,
  async resolveCapacityRetryDelays(host, connection) {
    if (host === LOCAL_HOST) return [];
    const [profiles, response] = await Promise.all([
      listAuthProfiles(host),
      connection.request("account/read", { refreshToken: true }),
    ]);
    return profileCapacityRetryDelays(profiles, response?.account);
  },
});

const {
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
} = createStatePersistence({
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
  getSnapshot: () => snapshot,
  setSnapshot: (next) => { snapshot = next; },
  getManagementState: () => managementState,
  setManagementState: (next) => { managementState = next; },
  getGpuUsageHistory: () => gpuUsageHistory,
  setGpuUsageHistory: (next) => { gpuUsageHistory = next; },
  getHistoryIndex: () => historyIndex,
  setHistoryIndex: (next) => { historyIndex = next; },
  enrichAgentRelations,
});

const {
  sendTmuxText,
  publicTmuxCapacityRecovery,
  cancelTmuxCapacityRecovery,
  detectTmuxCapacityFailures,
  selectTmuxModel,
} = createTmuxDelivery({
  findAgent,
  sessionKey,
  shellQuote,
  runSshCommand,
  cleanSshError,
  notifyClients: () => notifyClients(),
});

const {
  generateCodexSummary,
  searchAssistantSessions,
  discoverWandbRuns,
  renderResourcePrompt,
} = createResearchInsights({
  SUMMARY_TIMEOUT_MS,
  ASSISTANT_SEARCH_TIMEOUT_MS,
  ASSISTANT_CODEX_TIMEOUT_MS,
  getSnapshot: () => snapshot,
  publicSnapshot: () => publicSnapshot(),
  getManagementState: () => managementState,
  historicalSessions,
  enrichAgentRelations,
  historicalAgent,
  sessionKey,
  shellQuote,
  runSshCommand,
  cleanSshError,
  mapLimit,
});

// A completed account migration must survive a Bridge restart even when one
// thread needs a later retry. Without this marker the stale persisted writer
// key could silently recreate a previous account's app-server daemon.
const activeProfileMigrationSessions = new Set();

function sessionProfileAssignment(host, sessionId) {
  return managementState.sessions[sessionKey(host, sessionId)]?.profileAssignment || null;
}

function assertProfileNotBound(host, slug) {
  if (Object.entries(managementState.sessions).some(([key, state]) => key.startsWith(`${host}:`) &&
      [state.profileAssignment?.profile, state.profileAssignment?.desiredProfile].includes(slug))) {
    throw new Error("该 Profile 仍绑定了 Session；请先改绑，再删除或覆盖其登录凭据");
  }
}

function fixedProfileSession(session) {
  return Boolean(profileFromConnection(session.connectionKey) ||
    sessionProfileAssignment(session.host, session.sessionId)?.desiredProfile);
}

function closeUnboundHostConnections(host) {
  for (const connection of appServerManager.publicState().connections) {
    if (connection.host === host && !profileFromConnection(connection.connectionKey)) {
      appServerManager.closeConnection(host, connection.connectionKey);
    }
  }
}

function assertNoPendingProfileMigration(host) {
  if (appServerManager.sessionRecords().some((s) => s.host === host && fixedProfileSession(s) &&
    !profileFromConnection(s.connectionKey))) {
    throw new Error("该主机还有会话尚未完成独立账号绑定；请先完成或重试这些会话的切换，再修改主机账号");
  }
}

const sessionProfiles = new SessionProfileAssignments({
  read: sessionProfileAssignment,
  async write(host, sessionId, assignment) {
    const key = sessionKey(host, sessionId);
    managementState.sessions[key] = { ...managementState.sessions[key], profileAssignment: assignment };
    await persistManagementState();
    notifyClients();
  },
  session: (host, sessionId) => appServerManager.sessionRecords().find((s) => s.host === host && s.sessionId === sessionId),
  blocked: (host, sessionId) => appServerAuthRecoveryHosts.has(host) ||
    appServerManager.sessionRecords().some((s) => s.host === host && s.sessionId === sessionId && (s.status === "working" || s.turnStarting)) ||
    appServerManager.publicState().pendingRequests.some((r) => r.host === host && r.threadId === sessionId),
  async verify(host, slug, executable) {
    const profiles = await listAuthProfiles(host);
    const profile = profiles.profiles.find((p) => p.slug === slug && p.ready);
    if (!profile) throw new Error("该 Profile 不存在或尚未登录");
    const connection = await appServerManager.prepareHost(host, codexExecutable(executable), sessionProfileKey(slug));
    const { account } = await connection.request("account/read", { refreshToken: true });
    if (!account || account.type !== "chatgpt" || !account.email ||
      account.email.toLowerCase() !== profile.account?.email?.toLowerCase()) {
      throw new Error("目标 writer 的实际账号与 Profile 不匹配；未切换会话，请重新登录该 Profile");
    }
    return { type: account.type, email: account.email, planType: account.planType };
  },
  hold: (...args) => appServerManager.holdSessionForProfile(...args),
  release: (...args) => appServerManager.releaseProfileWriter(...args),
  migrate: (...args) => appServerManager.finishProfileHandoff(...args),
  restore: (host, sessionId, source) => appServerManager.finishProfileHandoff(host, sessionId, source.connectionKey || "active", source.executable, source),
});

const sessionProfileTimer = setInterval(() => {
  for (const record of appServerManager.sessionRecords()) {
    sessionProfiles.apply(record.host, record.sessionId).catch(() => {});
  }
}, 3000);
sessionProfileTimer.unref();

function appServerConnectionKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.-]{1,100}$/.test(key) ? key : "active";
}

async function detectRemoteSessionWriter(host, sessionId) {
  if (host === LOCAL_HOST) return null;
  const result = await runSshCommand(
    host,
    `python3 - ${shellQuote(sessionId)}`,
    APP_SERVER_WRITER_PROBE,
    12_000,
    100_000,
  );
  if (result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout.trim());
    const connectionKey = appServerConnectionKey(parsed.connectionKey);
    if (!parsed.connectionKey || connectionKey === "active") return null;
    return {
      connectionKey,
      ownerPid: Number(parsed.ownerPid) || 0,
      endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : "",
    };
  } catch {
    return null;
  }
}

async function resumeManagedAppServerSession(options) {
  const binding = sessionProfileAssignment(options.host, options.sessionId);
  if (profileHandoffPending(binding)) throw new Error("此会话正在交接账号；不会重新加载旧 writer，请等待或取消交接");
  const existing = appServerManager.sessionRecords().find((record) =>
    record.host === options.host && record.sessionId === options.sessionId);
  const recoveredWriter = !existing && !options.connectionKey && !binding?.profile
    ? await detectRemoteSessionWriter(options.host, options.sessionId) : null;
  const requestedConnectionKey = boundConnectionKey(binding,
    managementState.sessions[sessionKey(options.host, options.sessionId)]?.restartConnectionKey ||
    existing?.connectionKey || options.connectionKey || recoveredWriter?.connectionKey || await newSessionConnectionKey(options.host));
  const normalizedOptions = {
    ...options,
    executable: codexExecutable(options.executable),
  };
  try {
    return await appServerManager.resumeSession({
      ...normalizedOptions,
      connectionKey: requestedConnectionKey,
    });
  } catch (error) {
    if (binding?.profile || profileFromConnection(requestedConnectionKey)) throw error;
    if (!/already has an active writer/i.test(error?.message || "")) throw error;
    const writer = await detectRemoteSessionWriter(
      options.host,
      options.sessionId,
    );
    if (!writer || writer.connectionKey === requestedConnectionKey) throw error;
    const resumed = await appServerManager.resumeSession({
      ...normalizedOptions,
      connectionKey: writer.connectionKey,
    });
    await auditLifecycle("app-server-session-writer-routed", {
      host: options.host,
      sessionId: options.sessionId,
      fromConnectionKey: requestedConnectionKey,
      toConnectionKey: writer.connectionKey,
      ownerPid: writer.ownerPid,
      remoteSessionSignalSent: false,
    });
    return resumed;
  }
}
async function newSessionConnectionKey(host) {
  if (host === LOCAL_HOST) return "active";
  const profiles = await listAuthProfiles(host);
  return profiles.activeProfile ? sessionProfileKey(profiles.activeProfile) : "active";
}
const authProfileManager = new AuthProfileManager({
  spawnConnection: spawnRemoteProfileAppServer,
  requestTimeoutMs: AUTH_LOGIN_TIMEOUT_MS,
  prepareProfile: async (host, profile) => {
    const result = await runSshCommand(
      host,
      `umask 077; mkdir -p "$HOME/.codex/scope-auth-profiles/${profile.slug}/home"`,
      "",
      15_000,
    );
    if (result.code !== 0) {
      throw new Error(cleanSshError(result.stderr || result.stdout));
    }
  },
  finalizeProfile: (host, profile, account) =>
    runProfileWrite(host, "finalize", profile, account),
  cancelProfile: async (host, profile) => {
    const result = await runSshCommand(
      host,
      `python3 - ${shellQuote(profile.slug)}`,
      PROFILE_CANCEL_PROBE,
      15_000,
      100_000,
    );
    if (result.code !== 0) {
      throw new Error(cleanSshError(result.stderr || result.stdout));
    }
  },
});

function persistedAppServerSession(record) {
  if (!record?.host || !record?.sessionId) return null;
  return {
    host: String(record.host).slice(0, 200),
    sessionId: String(record.sessionId).slice(0, 200),
    path: typeof record.path === "string" ? record.path.slice(0, 8_000) : null,
    cwd: typeof record.cwd === "string" ? record.cwd.slice(0, 8_000) : "",
    model: typeof record.model === "string" ? record.model.slice(0, 200) : "",
    effort: typeof record.effort === "string" ? record.effort.slice(0, 40) : "",
    yolo: record.yolo !== false,
          readOnly: record.readOnly === true,
    executable:
      typeof record.executable === "string"
        ? record.executable.slice(0, 8_000)
        : "codex",
    resumeOnRecovery:
      typeof record.resumeOnRecovery === "boolean"
        ? record.resumeOnRecovery
        : record.status === "working",
    connectionKey: appServerConnectionKey(record.connectionKey),
    updatedAt: new Date().toISOString(),
  };
}

async function loadPersistedAppServerSessions() {
  try {
    const parsed = JSON.parse(await readFile(APP_SERVER_SESSIONS_FILE, "utf8"));
    for (const raw of Array.isArray(parsed?.sessions) ? parsed.sessions : []) {
      const record = persistedAppServerSession(raw);
      if (!record) continue;
      persistedAppServerSessions.set(
        sessionKey(record.host, record.sessionId),
        { ...record, updatedAt: raw.updatedAt || record.updatedAt },
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error(`无法读取 ${APP_SERVER_SESSIONS_FILE}: ${error.message}`);
    }
  } finally {
    appServerSessionsLoaded = true;
  }
}

function persistAppServerSessions() {
  if (!appServerSessionsLoaded) return Promise.resolve();
  for (const raw of appServerManager.sessionRecords()) {
    const record = persistedAppServerSession(raw);
    if (!record) continue;
    if (!fixedProfileSession(record) && activeProfileMigrationSessions.has(sessionKey(record.host, record.sessionId))) {
      record.connectionKey = "active";
    }
    persistedAppServerSessions.set(
      sessionKey(record.host, record.sessionId),
      record,
    );
  }
  const serialized = `${JSON.stringify(
    {
      version: 1,
      sessions: Array.from(persistedAppServerSessions.values()),
    },
    null,
    2,
  )}\n`;
  appServerSessionWritePromise = appServerSessionWritePromise
    .catch(() => {})
    .then(async () => {
      await mkdir(STATE_DIR, { recursive: true });
      const temporary = `${APP_SERVER_SESSIONS_FILE}.tmp`;
      await writeFile(temporary, serialized, "utf8");
      await rename(temporary, APP_SERVER_SESSIONS_FILE);
    });
  return appServerSessionWritePromise;
}

function restorePersistedAppServerSessions() {
  if (appServerRestorePromise) return appServerRestorePromise;
  appServerRestorePromise = (async () => {
    const records = Array.from(persistedAppServerSessions.values());
    for (const record of records) {
      const key = sessionKey(record.host, record.sessionId);
      if (managementState.sessions[key]?.archive && managementState.sessions[key].archive.phase !== "restored") continue;
      const assignment = sessionProfileAssignment(record.host, record.sessionId);
      if (profileHandoffPending(assignment)) {
        appServerManager.hydrateProfileHandoff(assignment.handoff.source);
        continue;
      }
      if (appServerManager.isManaged(record.host, record.sessionId)) {
        appServerRestoreFailures.delete(key);
        continue;
      }
      const previousFailure = appServerRestoreFailures.get(key);
      if ((previousFailure?.retryAt || 0) > Date.now()) continue;
      const currentHost = snapshot.hosts.find(
        (candidate) => candidate.alias === record.host,
      );
      const externalOwner = currentHost?.agents?.find(
        (agent) =>
          agent.rollout?.id === record.sessionId && !agent.appServerManaged,
      );
      if (externalOwner) {
        appServerRestoreFailures.set(key, {
          attempt: previousFailure?.attempt || 0,
          error: `当前由外部 CLI/VS Code PID ${externalOwner.pid} 持有`,
          retryAt: Date.now() + 30_000,
        });
        continue;
      }
      if (!currentHost?.reachable) continue;
      try {
        await resumeManagedAppServerSession({
          host: record.host,
          sessionId: record.sessionId,
          path: record.path,
          cwd: record.cwd,
          model: record.model || null,
          effort: record.effort || null,
          yolo: record.yolo !== false,
          readOnly: record.readOnly === true,
          executable: record.executable || "codex",
          resumeOnRecovery: record.resumeOnRecovery === true,
          connectionKey: record.connectionKey,
        });
        appServerRestoreFailures.delete(key);
        auditLifecycle("app-server-session-restored", {
          host: record.host,
          sessionId: record.sessionId,
          remoteSessionSignalSent: false,
        });
      } catch (error) {
        const attempt = (previousFailure?.attempt || 0) + 1;
        const retryDelay = Math.min(
          5 * 60_000,
          5_000 * 2 ** Math.min(attempt - 1, 6),
        );
        appServerRestoreFailures.set(key, {
          attempt,
          error: error.message,
          retryAt: Date.now() + retryDelay,
        });
        console.error(
          `[app-server] 自动恢复 ${record.host}:${record.sessionId} 失败：${error.message}；${Math.round(retryDelay / 1000)} 秒后重试`,
        );
        if (previousFailure?.error !== error.message) {
          auditLifecycle("app-server-session-restore-failed", {
            host: record.host,
            sessionId: record.sessionId,
            error: error.message,
            remoteSessionSignalSent: false,
          });
        }
      }
    }
    await persistAppServerSessions();
  })().finally(() => {
    appServerRestorePromise = null;
  });
  return appServerRestorePromise;
}

function scheduleAppServerReconnects() {
  if (!appServerSessionsLoaded) return;
  const offlineHosts = new Set(
    appServerManager
      .sessionRecords()
      .filter((session) => session.status === "offline" && !profileHandoffPending(sessionProfileAssignment(session.host, session.sessionId)))
      .map((session) => session.host),
  );
  for (const [host, timer] of appServerReconnectTimers.entries()) {
    if (offlineHosts.has(host)) continue;
    clearTimeout(timer);
    appServerReconnectTimers.delete(host);
    appServerReconnectAttempts.delete(host);
  }
  for (const host of offlineHosts) {
    if (
      appServerAuthRecoveryHosts.has(host) ||
      appServerReconnectTimers.has(host) ||
      appServerReconnectInFlight.has(host)
    )
      continue;
    const attempt = appServerReconnectAttempts.get(host) || 0;
    // A dropped proxy has no useful grace period: rebuild the whole managed
    // app-server stream immediately. Further failures retain exponential
    // backoff so a genuinely unreachable host is not hammered.
    const delay =
      attempt === 0 ? 0 : Math.min(30_000, 2_000 * 2 ** Math.min(attempt, 4));
    const timer = setTimeout(async () => {
      appServerReconnectTimers.delete(host);
      appServerReconnectInFlight.add(host);
      const records = Array.from(persistedAppServerSessions.values()).filter(
        (record) => record.host === host,
      );
      if (!records.length) {
        appServerReconnectAttempts.delete(host);
        appServerReconnectInFlight.delete(host);
        return;
      }
      try {
        const currentHost = snapshot.hosts.find(
          (candidate) => candidate.alias === host,
        );
        if (!currentHost?.reachable) throw new Error("SSH 主机当前不可连接");
        for (const record of records) {
          if (profileHandoffPending(sessionProfileAssignment(record.host, record.sessionId))) continue;
          const externalOwner = currentHost.agents?.find(
            (agent) =>
              agent.rollout?.id === record.sessionId &&
              !agent.appServerManaged,
          );
          if (externalOwner) {
            persistedAppServerSessions.delete(
              sessionKey(record.host, record.sessionId),
            );
            continue;
          }
          await resumeManagedAppServerSession({
            host: record.host,
            sessionId: record.sessionId,
            path: record.path,
            cwd: record.cwd,
            model: record.model || null,
            effort: record.effort || null,
            yolo: record.yolo !== false,
          readOnly: record.readOnly === true,
            executable: record.executable || "codex",
            resumeOnRecovery: record.resumeOnRecovery === true,
            connectionKey: record.connectionKey,
          });
        }
        appServerReconnectAttempts.delete(host);
        await persistAppServerSessions();
      } catch (error) {
        appServerReconnectAttempts.set(host, attempt + 1);
        console.error(`[app-server] ${host} 重连失败：${error.message}`);
      } finally {
        appServerReconnectInFlight.delete(host);
        scheduleAppServerReconnects();
      }
    }, delay);
    timer.unref();
    appServerReconnectTimers.set(host, timer);
  }
}

const configRestartHeld = new Map();
const hostConfigRestarts = new HostSessionRestarts({
  async prepare(host) {
    if (!snapshot.hosts.some((h) => h.alias === host && h.reachable)) throw new Error("主机不可连接");
    if (appServerAuthRecoveryHosts.has(host)) throw new Error("主机正在恢复或迁移账号，请稍后重试");
    const sessions = appServerManager.sessionRecords().filter((s) => s.host === host);
    if (!sessions.length) throw new Error("没有 SCOPE 托管会话");
    if (sessions.some((s) => s.status === "working" || s.turnStarting || s.profileHandoff)) {
      throw new Error("仍有工作中或账号交接中的会话；请先结束当前回合。未停止任何进程");
    }
    const profiles = await listAuthProfiles(host);
    const groups = new Map();
    for (const s of sessions) {
      const owner = await detectRemoteSessionWriter(host, s.sessionId);
      if (!owner) throw new Error(`无法确认 ${s.sessionId} 的 writer，未停止任何进程`);
      retireScopedAppServerCommand(owner.connectionKey); // validates the exact daemon key
      let group = groups.get(owner.connectionKey);
      if (!group) {
        const connection = await appServerManager.prepareHost(host, s.executable, s.connectionKey);
        const account = (await connection.request("account/read", { refreshToken: false }))?.account;
        const profile = profiles.profiles.find((p) => p.account?.email && account?.type === "chatgpt" &&
          p.account.email.toLowerCase() === account.email?.toLowerCase());
        if (!profile) throw new Error("无法确定原会话实际账号，拒绝按主机默认账号重启");
        if (owner.connectionKey.startsWith("profile-") &&
            profiles.currentAccount?.email?.toLowerCase() !== account.email?.toLowerCase()) {
          throw new Error("旧共享进程的账号与磁盘凭据不同；请先完成会话账号迁移，避免重启后换错账号");
        }
        group = { key: owner.connectionKey, connection, targetKey: owner.connectionKey, sessions: [] };
        groups.set(owner.connectionKey, group);
      }
      group.sessions.push(s);
    }
    for (const group of groups.values()) {
      let cursor = null;
      do {
        const loaded = await group.connection.request("thread/loaded/list", { cursor, limit: 100 });
        if (!Array.isArray(loaded.data)) throw new Error("无法核验 daemon 已加载会话，未停止任何进程");
        for (const id of loaded.data) {
          if (!group.sessions.some((s) => s.sessionId === id)) throw new Error(`daemon 还有未纳入重启的会话 ${id}，未停止任何进程`);
          const current = await group.connection.request("thread/read", { threadId: id, includeTurns: false });
          if (!current?.thread?.status || current.thread.status.type === "active") {
            throw new Error(`会话 ${id} 远端仍活跃或无法核验，未停止任何进程`);
          }
          const terminals = await group.connection.request("thread/backgroundTerminals/list", { threadId: id, limit: 1 });
          if (!Array.isArray(terminals.data) || terminals.data.length || terminals.nextCursor) {
            throw new Error(`会话 ${id} 仍有后台命令或无法核验，未停止任何进程`);
          }
        }
        cursor = loaded.nextCursor;
      } while (cursor);
    }
    // Synchronously prevent instructions/retries racing the completed preflight.
    const held = [];
    try {
      for (const s of sessions) { appServerManager.holdSessionForProfile(host, s.sessionId); held.push(s); }
    } catch (error) {
      for (const s of held) appServerManager.clearSessionRestartHold(host, s.sessionId);
      throw error;
    }
    appServerAuthRecoveryHosts.add(host);
    configRestartHeld.set(host, held.map((s) => s.sessionId));
    return [...groups.values()];
  },
  async restart(host, group) {
    // Persist each original thread's intended account before retiring its daemon.
    for (const s of group.sessions) {
      const key = sessionKey(host, s.sessionId);
      managementState.sessions[key] = { ...managementState.sessions[key], restartConnectionKey: group.targetKey };
    }
    await persistManagementState();
    const retired = await runSshCommand(host, retireScopedAppServerCommand(group.key), "", 15_000, 100_000);
    if (retired.code !== 0) throw new Error(cleanSshError(retired.stderr || retired.stdout));
    for (const key of new Set(group.sessions.map((s) => s.connectionKey))) appServerManager.closeConnection(host, key);
    const results = [];
    for (const s of group.sessions) {
      try {
        await appServerManager.resumeSession({ ...s, connectionKey: group.targetKey, resumeOnRecovery: false, allowProfileHandoff: true });
        results.push({ sessionId: s.sessionId, ok: true });
      } catch (error) { results.push({ sessionId: s.sessionId, ok: false, error: error.message }); }
    }
    await persistAppServerSessions();
    return results;
  },
  async publish(job) {
    if (job.status !== "running") {
      for (const id of configRestartHeld.get(job.host) || []) {
        appServerManager.clearSessionRestartHold(job.host, id);
      }
      if (configRestartHeld.has(job.host)) appServerAuthRecoveryHosts.delete(job.host);
      configRestartHeld.delete(job.host);
      if (job.status === "completed") {
        for (const result of job.results) {
          const state = managementState.sessions[sessionKey(job.host, result.sessionId)];
          if (state) delete state.restartConnectionKey;
        }
        await persistManagementState();
      }
      await auditLifecycle("host-config-restart-result", { host: job.host, status: job.status, results: job.results, error: job.error });
    }
    notifyClients();
  },
});

const codexUpgrades = new CodexUpgrades({
  async inspect(host) {
    // Query npm registry locally first; if local egress is restricted, let the
    // remote host query via its configured updatePreCommand / preLaunchCommand.
    let latest = null;
    try {
      const registry = await fetch("https://registry.npmjs.org/@openai%2Fcodex/latest", { signal: AbortSignal.timeout(15_000) });
      if (registry.ok) latest = stableVersion((await registry.json()).version);
    } catch {
      latest = null;
    }
    const runtime = hostRuntimeConfig(host);
    const updatePre = runtime?.updatePreCommand?.trim() || runtime?.preLaunchCommand?.trim() || "";
    const wrapped = wrapCodexUpgradeCommand(remoteCodexUpgradeScript(null, latest), updatePre);
    const result = await runSshCommand(host, wrapped.command, wrapped.stdin, 60_000, 60_000);
    if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim().split(/\r?\n/).filter(Boolean).at(-1) || "远端 Codex 检查失败");
    return parseCodexUpgradeOutput(result.stdout);
  },
  async install(host, target) {
    if (hostConfigRestarts.view(host)?.status === "running" || appServerAuthRecoveryHosts.has(host)) {
      throw new Error("主机正在重启或迁移账号，请稍后再升级");
    }
    const runtime = hostRuntimeConfig(host);
    const updatePre = runtime?.updatePreCommand?.trim() || runtime?.preLaunchCommand?.trim() || "";
    const wrapped = wrapCodexUpgradeCommand(remoteCodexUpgradeScript(target), updatePre);
    const result = await runSshCommand(host, wrapped.command, wrapped.stdin, 360_000, 60_000);
    if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim().split(/\r?\n/).filter(Boolean).at(-1) || "远端 Codex 安装失败");
    return parseCodexUpgradeOutput(result.stdout);
  },
  async restart(host) {
    if (!appServerManager.sessionRecords().some((s) => s.host === host)) return { status: "completed", results: [] };
    await hostConfigRestarts.start(host).done;
    return hostConfigRestarts.view(host);
  },
  running(host) {
    return appServerManager.publicState().connections
      .filter((c) => c.host === host && c.sessionIds.length)
      .map((c) => ({ connectionKey: c.connectionKey, status: c.status,
        version: c.serverInfo?.userAgent?.match(/scope-ssh-monitor\/(\d+\.\d+\.\d+)/)?.[1] || null,
        sessions: c.sessionIds.length }));
  },
});

function recoverHostAppServerSessions(hostAlias) {
  const inFlight = appServerHostRecoveryJobs.get(hostAlias);
  if (inFlight) return inFlight;

  const recovery = (async () => {
    const records = Array.from(persistedAppServerSessions.values()).filter(
      (record) => record.host === hostAlias,
    );
    if (!records.length) {
      const error = new Error(`主机 ${hostAlias} 没有 SCOPE 托管的 app-server Session`);
      error.statusCode = 404;
      throw error;
    }
    if (!snapshot.hosts.some((host) => host.alias === hostAlias)) {
      const error = new Error(`SSH 配置中找不到主机 ${hostAlias}`);
      error.statusCode = 404;
      throw error;
    }

    const reconnectTimer = appServerReconnectTimers.get(hostAlias);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    appServerReconnectTimers.delete(hostAlias);
    appServerReconnectAttempts.delete(hostAlias);

    const before = new Map(
      appServerManager
        .sessionRecords()
        .filter((session) => session.host === hostAlias)
        .map((session) => [session.sessionId, session]),
    );
    const results = [];

    try {
      await appServerManager.prepareHost(
        hostAlias,
        records.find((record) => record.executable)?.executable || "codex",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const record of records) {
        results.push({
          sessionId: record.sessionId,
          status: "failed",
          error: message,
        });
      }
      await auditLifecycle("app-server-host-recovery-failed", {
        host: hostAlias,
        sessions: records.length,
        error: message,
        remoteSessionSignalSent: false,
      });
      return {
        ok: false,
        host: hostAlias,
        total: records.length,
        reconnected: 0,
        continued: 0,
        alreadyWorking: 0,
        alreadyRecovering: 0,
        idle: 0,
        failed: records.length,
        results,
      };
    }

    const currentHost = snapshot.hosts.find((host) => host.alias === hostAlias);
    for (const record of records) {
      const previous = before.get(record.sessionId);
      const shouldContinue = Boolean(
        previous?.resumeOnRecovery ||
          previous?.status === "working" ||
          record.resumeOnRecovery,
      );
      const externalOwner = currentHost?.agents?.find(
        (agent) =>
          agent.rollout?.id === record.sessionId && !agent.appServerManaged,
      );
      if (externalOwner) {
        results.push({
          sessionId: record.sessionId,
          status: "failed",
          error: `当前由外部 CLI/VS Code PID ${externalOwner.pid} 持有`,
        });
        continue;
      }

      try {
        let session = appServerManager
          .sessionRecords()
          .find(
            (candidate) =>
              candidate.host === hostAlias &&
              candidate.sessionId === record.sessionId &&
              candidate.status !== "offline",
          );
        let reconnected = false;
        if (!session) {
          session = await resumeManagedAppServerSession({
            host: record.host,
            sessionId: record.sessionId,
            path: record.path,
            cwd: record.cwd,
            model: record.model || null,
            effort: record.effort || null,
            yolo: record.yolo !== false,
          readOnly: record.readOnly === true,
            executable: record.executable || "codex",
            resumeOnRecovery: shouldContinue,
            connectionKey: record.connectionKey,
          });
          reconnected = true;
        }

        if (session.status === "working") {
          results.push({
            sessionId: record.sessionId,
            status: "already-working",
            reconnected,
          });
          continue;
        }
        if (
          session.capacityRecovery &&
          ["scheduled", "waiting", "sending", "sent"].includes(
            session.capacityRecovery.status,
          )
        ) {
          results.push({
            sessionId: record.sessionId,
            status: "already-recovering",
            reconnected,
          });
          continue;
        }
        if (shouldContinue) {
          await appServerManager.startTurn(hostAlias, record.sessionId, "继续", {
            automaticRecovery: true,
            effort: record.effort || null,
          });
          results.push({
            sessionId: record.sessionId,
            status: "continued",
            reconnected,
          });
          continue;
        }
        results.push({
          sessionId: record.sessionId,
          status: reconnected ? "reconnected-idle" : "idle",
          reconnected,
        });
      } catch (error) {
        results.push({
          sessionId: record.sessionId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await persistAppServerSessions();
    const summary = {
      ok: results.every((result) => result.status !== "failed"),
      host: hostAlias,
      total: results.length,
      reconnected: results.filter((result) => result.reconnected).length,
      continued: results.filter((result) => result.status === "continued").length,
      alreadyWorking: results.filter(
        (result) => result.status === "already-working",
      ).length,
      alreadyRecovering: results.filter(
        (result) => result.status === "already-recovering",
      ).length,
      idle: results.filter((result) =>
        ["idle", "reconnected-idle"].includes(result.status),
      ).length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    };
    await auditLifecycle("app-server-host-recovered", {
      host: hostAlias,
      total: summary.total,
      reconnected: summary.reconnected,
      continued: summary.continued,
      alreadyWorking: summary.alreadyWorking,
      alreadyRecovering: summary.alreadyRecovering,
      idle: summary.idle,
      failed: summary.failed,
      remoteSessionSignalSent: summary.continued > 0,
    });
    notifyClients();
    setTimeout(() => scanAll({ force: true, hosts: [hostAlias] }).catch(() => {}), 300);
    return summary;
  })().finally(() => appServerHostRecoveryJobs.delete(hostAlias));

  appServerHostRecoveryJobs.set(hostAlias, recovery);
  return recovery;
}

function recoverAuthenticationFailedSessions(
  hostAlias,
  { sessionIds = null, sourceConnectionKey = null } = {},
) {
  const jobKey = `${hostAlias}:${sourceConnectionKey || "explicit"}`;
  const existing = appServerAuthRecoveryJobs.get(jobKey);
  if (existing) return existing;

  appServerAuthRecoveryHosts.add(hostAlias);
  const reconnectTimer = appServerReconnectTimers.get(hostAlias);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  appServerReconnectTimers.delete(hostAlias);
  appServerReconnectAttempts.delete(hostAlias);

  const recovery = (async () => {
    const requestedIds = Array.isArray(sessionIds)
      ? new Set(sessionIds.map((value) => String(value || "").trim()).filter(Boolean))
      : null;
    const requestedSessions = appServerManager.sessionRecords().filter((session) => {
      if (fixedProfileSession(session)) return false;
      if (session.host !== hostAlias || session.status === "working") return false;
      if (requestedIds && !requestedIds.has(session.sessionId)) return false;
      if (
        sourceConnectionKey &&
        appServerConnectionKey(session.connectionKey) !==
          appServerConnectionKey(sourceConnectionKey)
      ) {
        return false;
      }
      return appServerConnectionKey(session.connectionKey) !== "active";
    });
    const results = [];

    // An explicit recovery request is scoped to individual interrupted threads.
    // Moving the whole profile writer would also stop unrelated working turns that
    // still share it, so migrate each selected thread to the active profile instead.
    if (requestedIds) {
      for (const previous of requestedSessions) {
        try {
          const fromConnectionKey = appServerConnectionKey(previous.connectionKey);
          let migrated;
          let forkedFromSessionId = null;
          try {
            migrated = await appServerManager.migrateSessionConnection(
              hostAlias,
              previous.sessionId,
              "active",
              previous.executable || "codex",
            );
          } catch (error) {
            if (!/already has an active writer/i.test(error?.message || "")) {
              throw error;
            }
            migrated = await appServerManager.forkSessionConnection(
              hostAlias,
              previous.sessionId,
              "active",
              previous.executable || "codex",
            );
            forkedFromSessionId = previous.sessionId;
          }
          await appServerManager.startTurn(hostAlias, migrated.sessionId, "继续", {
            automaticRecovery: true,
            effort: previous.effort || null,
          });
          results.push({
            sessionId: migrated.sessionId,
            forkedFromSessionId,
            status: forkedFromSessionId ? "forked-continued" : "continued",
          });
          await auditLifecycle("app-server-auth-writer-migrated", {
            host: hostAlias,
            sessionId: migrated.sessionId,
            forkedFromSessionId,
            fromConnectionKey,
            toConnectionKey: migrated.connectionKey,
            continued: true,
            remoteSessionSignalSent: true,
          });
        } catch (error) {
          results.push({
            sessionId: previous.sessionId,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await persistAppServerSessions();
      notifyClients();
      return {
        ok: results.every((result) => result.status !== "failed"),
        host: hostAlias,
        total: results.length,
        migrated: 0,
        continued: results.filter((result) =>
          ["continued", "forked-continued"].includes(result.status),
        ).length,
        forked: results.filter((result) => result.status === "forked-continued").length,
        failed: results.filter((result) => result.status === "failed").length,
        results,
      };
    }

    const sourceKeys = new Set(
      requestedSessions.map((session) => appServerConnectionKey(session.connectionKey)),
    );
    for (const sourceKey of sourceKeys) {
      const sourceSessions = appServerManager
        .sessionRecords()
        .filter(
          (session) =>
            session.host === hostAlias &&
            appServerConnectionKey(session.connectionKey) === sourceKey,
        );
      const working = sourceSessions.filter((session) => session.status === "working");
      if (working.length) {
        for (const session of sourceSessions) {
          if (requestedIds && !requestedIds.has(session.sessionId)) continue;
          results.push({
            sessionId: session.sessionId,
            status: "failed",
            error: `旧账号 writer 仍有 ${working.length} 个 Turn 在运行，未终止 daemon`,
          });
        }
        continue;
      }
      try {
        await retireStaleProfileAppServer(hostAlias, sourceKey, sourceSessions);
      } catch (error) {
        for (const session of sourceSessions) {
          if (requestedIds && !requestedIds.has(session.sessionId)) continue;
          results.push({
            sessionId: session.sessionId,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }
      for (const previous of sourceSessions) {
        const shouldContinue =
          previous.resumeOnRecovery === true ||
          isAuthenticationRefreshError(previous.lastProtocolError) ||
          Boolean(requestedIds?.has(previous.sessionId));
        try {
          const migrated = await appServerManager.resumeSession({
            host: hostAlias,
            sessionId: previous.sessionId,
            path: previous.path,
            cwd: previous.cwd,
            model: previous.model || null,
            effort: previous.effort || null,
            yolo: previous.yolo !== false,
            executable: previous.executable || "codex",
            resumeOnRecovery: shouldContinue,
            connectionKey: "active",
          });
          let status = "migrated";
          if (shouldContinue) {
            await appServerManager.startTurn(hostAlias, previous.sessionId, "继续", {
              automaticRecovery: true,
              effort: previous.effort || null,
            });
            status = "continued";
          }
          results.push({ sessionId: previous.sessionId, status });
          await auditLifecycle("app-server-auth-writer-migrated", {
            host: hostAlias,
            sessionId: previous.sessionId,
            fromConnectionKey: sourceKey,
            toConnectionKey: migrated.connectionKey,
            continued: shouldContinue,
            remoteSessionSignalSent: shouldContinue,
          });
        } catch (error) {
          results.push({
            sessionId: previous.sessionId,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    await persistAppServerSessions();
    notifyClients();
    return {
      ok: results.every((result) => result.status !== "failed"),
      host: hostAlias,
      total: results.length,
      migrated: results.filter((result) => result.status === "migrated").length,
      continued: results.filter((result) => result.status === "continued").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    };
  })().finally(() => {
    appServerAuthRecoveryJobs.delete(jobKey);
    appServerAuthRecoveryHosts.delete(hostAlias);
    scheduleAppServerReconnects();
  });
  appServerAuthRecoveryJobs.set(jobKey, recovery);
  return recovery;
}

async function retireStaleProfileAppServer(host, connectionKey, sessions) {
  const key = appServerConnectionKey(connectionKey);
  if (key === "active" || !key.startsWith("profile-")) {
    throw new Error("拒绝终止非 Profile 的 app-server writer");
  }
  if (sessions.some((session) => session.status === "working")) {
    throw new Error("旧账号 writer 仍有 Turn 在运行，拒绝终止");
  }
  const pending = appServerManager
    .publicState()
    .pendingRequests.some(
      (request) =>
        request.host === host &&
        appServerConnectionKey(request.connectionKey) === key &&
        ["pending", "responding", "disconnected"].includes(request.status),
    );
  if (pending) throw new Error("旧账号 writer 仍有待回答问题或审批，拒绝终止");

  appServerManager.closeConnection(host, key);
  const command = retireProfileAppServerCommand(key);
  const result = await runSshCommand(host, command, "", 15_000, 100_000);
  if (result.code !== 0) {
    throw new Error(cleanSshError(result.stderr || result.stdout));
  }
  await auditLifecycle("app-server-stale-auth-writer-retired", {
    host,
    connectionKey: key,
    sessions: sessions.length,
    tmux: `scope-app-server-${key}`,
    remoteSessionSignalSent: false,
  });
}

function pendingRequestsForConnection(host, connectionKey) {
  const key = appServerConnectionKey(connectionKey);
  return appServerManager
    .publicState()
    .pendingRequests.filter(
      (request) =>
        request.host === host &&
        appServerConnectionKey(request.connectionKey) === key &&
        ["pending", "responding", "disconnected"].includes(request.status),
    );
}

function scheduleActiveAuthFailoverAttempt(job, delay = AUTH_PROFILE_FAILOVER_WAIT_MS) {
  if (appServerActiveAuthFailoverJobs.get(job.host) !== job) return;
  if (job.timer) clearTimeout(job.timer);
  job.nextAttemptAt = new Date(Date.now() + delay).toISOString();
  job.timer = setTimeout(() => {
    job.timer = null;
    attemptActiveAuthProfileFailover(job).catch((error) =>
      finishActiveAuthProfileFailover(job, error),
    );
  }, delay);
  job.timer.unref?.();
  notifyClients();
}

function finishActiveAuthProfileFailover(job, error = null) {
  if (job.timer) clearTimeout(job.timer);
  job.timer = null;
  job.nextAttemptAt = null;
  job.completedAt = new Date().toISOString();
  if (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    auditLifecycle("app-server-auth-profile-failover-failed", {
      host: job.host,
      failedProfile: job.failedProfile,
      targetProfile: job.targetProfile,
      interruptedSessions: Array.from(job.interruptedSessions),
      error: job.error,
      remoteSessionSignalSent: false,
    }).catch(() => {});
  } else {
    job.status = "completed";
    job.error = null;
    auditLifecycle("app-server-auth-profile-failover-completed", {
      host: job.host,
      failedProfile: job.failedProfile,
      targetProfile: job.targetProfile,
      interruptedSessions: Array.from(job.interruptedSessions),
      continued: job.continued || 0,
      failed: job.failed || 0,
      remoteSessionSignalSent: (job.continued || 0) > 0,
    }).catch(() => {});
  }
  appServerAuthRecoveryHosts.delete(job.host);
  notifyClients();
  scheduleAppServerReconnects();
  // Keep the completed state briefly so the profile panel can explain what
  // happened, while allowing a newly observed auth failure to start a fresh
  // rotation immediately after the cooldown window is recorded.
  const cleanup = setTimeout(() => {
    if (appServerActiveAuthFailoverJobs.get(job.host) === job) {
      appServerActiveAuthFailoverJobs.delete(job.host);
      notifyClients();
    }
  }, 60_000);
  cleanup.unref?.();
}

async function chooseActiveAuthFailoverTarget(job) {
  const profiles = await listAuthProfiles(job.host);
  const activeSlug = profiles.activeProfile;
  if (!activeSlug) {
    throw new Error("当前账号尚未绑定到已保存 Profile，无法安全自动轮换");
  }
  if (!job.failedProfile) job.failedProfile = activeSlug;
  if (activeSlug !== job.failedProfile) {
    // A manual switch won the race. Use the newly selected profile and only
    // perform the safe writer restart/resume phase below.
    const manuallySelected = profiles.profiles.find(
      (profile) => profile.slug === activeSlug && profile.ready,
    );
    if (!manuallySelected) throw new Error("手动切换后的 Profile 不可用");
    job.targetProfile = manuallySelected.slug;
    job.targetProfileRecord = manuallySelected;
    return;
  }

  const failedUntil = failedProfilesForHost(job.host);
  markProfileUnavailable(failedUntil, activeSlug);
  const candidates = orderedReadyProfileCandidates(
    profiles.profiles,
    activeSlug,
    { failedUntil },
  );
  if (!candidates.length) {
    throw new Error("没有另一套已登录且未处于冷却期的 Profile");
  }

  for (const candidate of candidates) {
    job.attemptedProfiles.push(candidate.slug);
    const candidateKey = `profile-${candidate.slug}`;
    const candidateSessions = appServerManager
      .sessionRecords()
      .filter(
        (session) =>
          session.host === job.host &&
          appServerConnectionKey(session.connectionKey) === candidateKey,
      );
    if (
      candidateSessions.some((session) => session.status === "working") ||
      pendingRequestsForConnection(job.host, candidateKey).length
    ) {
      continue;
    }
    try {
      await probeAuthProfile(job.host, job.executable, candidate);
      job.targetProfile = candidate.slug;
      job.targetProfileRecord = candidate;
      await auditLifecycle("app-server-auth-profile-probe-succeeded", {
        host: job.host,
        profile: candidate.slug,
        remoteSessionSignalSent: false,
      });
      return;
    } catch (error) {
      markProfileUnavailable(failedUntil, candidate.slug);
      await auditLifecycle("app-server-auth-profile-probe-failed", {
        host: job.host,
        profile: candidate.slug,
        error: error instanceof Error ? error.message : String(error),
        remoteSessionSignalSent: false,
      });
    }
  }
  throw new Error("其余 Profile 均未通过 refresh-token 可用性检查");
}

async function attemptActiveAuthProfileFailover(job) {
  if (appServerActiveAuthFailoverJobs.get(job.host) !== job) return;
  assertNoPendingProfileMigration(job.host);
  if (!job.targetProfileRecord) await chooseActiveAuthFailoverTarget(job);

  const sourceSessions = appServerManager
    .sessionRecords()
    .filter(
      (session) =>
        session.host === job.host &&
        appServerConnectionKey(session.connectionKey) === "active",
    );
  const working = sourceSessions.filter((session) => session.status === "working");
  const pending = pendingRequestsForConnection(job.host, "active");
  if (working.length || pending.length) {
    job.status = "waiting-for-turns";
    job.waitingForSessions = new Set([
      ...working.map((session) => session.sessionId),
      ...pending.map((request) => request.threadId).filter(Boolean),
    ]);
    if (!job.waitingAuditWritten) {
      job.waitingAuditWritten = true;
      await auditLifecycle("app-server-auth-profile-failover-deferred", {
        host: job.host,
        failedProfile: job.failedProfile,
        targetProfile: job.targetProfile,
        waitingForSessions: Array.from(job.waitingForSessions),
        reason: "preserving active turns and pending approvals",
        remoteSessionSignalSent: false,
      });
    }
    scheduleActiveAuthFailoverAttempt(job);
    return;
  }

  job.status = "switching";
  job.waitingForSessions = new Set();
  job.nextAttemptAt = null;
  appServerAuthRecoveryHosts.add(job.host);
  const reconnectTimer = appServerReconnectTimers.get(job.host);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  appServerReconnectTimers.delete(job.host);
  appServerReconnectAttempts.delete(job.host);
  notifyClients();

  const sourceSnapshot = sourceSessions.map((session) => ({ ...session }));
  const targetKey = `profile-${job.targetProfile}`;
  const targetSessions = appServerManager
    .sessionRecords()
    .filter(
      (session) =>
        session.host === job.host &&
        appServerConnectionKey(session.connectionKey) === targetKey,
      );
  let activeConnectionClosed = false;
  let targetActivated = false;
  try {
    await retireStaleProfileAppServer(job.host, targetKey, targetSessions);

    appServerManager.closeConnection(job.host, "active");
    activeConnectionClosed = true;
    if (job.failedProfile) {
      const failedKey = `profile-${job.failedProfile}`;
      const result = await runSshCommand(
        job.host,
        retireProfileAppServerCommand(failedKey),
        "",
        15_000,
        100_000,
      );
      if (result.code !== 0) {
        throw new Error(cleanSshError(result.stderr || result.stdout));
      }
      await auditLifecycle("app-server-failed-active-writer-retired", {
        host: job.host,
        connectionKey: failedKey,
        sessions: sourceSnapshot.length,
        remoteSessionSignalSent: false,
      });
    }

    await runProfileWrite(
      job.host,
      "activate",
      {
        slug: job.targetProfileRecord.slug,
        name: job.targetProfileRecord.name || job.targetProfileRecord.slug,
      },
      null,
    );
    targetActivated = true;
  } catch (error) {
    // Until activation succeeds, the remote marker still points at the old
    // profile. Reconnect every captured thread to that writer so a failed
    // switch cannot strand otherwise healthy sessions offline.
    if (activeConnectionClosed && !targetActivated) {
      let rollbackFailures = 0;
      for (const previous of sourceSnapshot) {
        try {
          await appServerManager.resumeSession({
            host: job.host,
            sessionId: previous.sessionId,
            path: previous.path,
            cwd: previous.cwd,
            model: previous.model || null,
            effort: previous.effort || null,
            yolo: previous.yolo !== false,
            executable: previous.executable || job.executable || "codex",
            resumeOnRecovery: previous.resumeOnRecovery === true,
            connectionKey: "active",
          });
        } catch {
          rollbackFailures += 1;
        }
      }
      await auditLifecycle("app-server-auth-profile-failover-rolled-back", {
        host: job.host,
        failedProfile: job.failedProfile,
        targetProfile: job.targetProfile,
        restored: sourceSnapshot.length - rollbackFailures,
        failed: rollbackFailures,
        remoteSessionSignalSent: false,
      });
    }
    throw error;
  }

  const results = [];
  for (const previous of sourceSnapshot) {
    const shouldContinue =
      previous.resumeOnRecovery === true ||
      job.interruptedSessions.has(previous.sessionId);
    try {
      await appServerManager.resumeSession({
        host: job.host,
        sessionId: previous.sessionId,
        path: previous.path,
        cwd: previous.cwd,
        model: previous.model || null,
        effort: previous.effort || null,
        yolo: previous.yolo !== false,
        executable: previous.executable || job.executable || "codex",
        resumeOnRecovery: shouldContinue,
        connectionKey: "active",
      });
      if (shouldContinue) {
        await appServerManager.startTurn(job.host, previous.sessionId, "继续", {
          automaticRecovery: true,
          effort: previous.effort || null,
        });
      }
      results.push({
        sessionId: previous.sessionId,
        status: shouldContinue ? "continued" : "migrated",
      });
    } catch (error) {
      results.push({
        sessionId: previous.sessionId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  job.results = results;
  job.continued = results.filter((result) => result.status === "continued").length;
  job.failed = results.filter((result) => result.status === "failed").length;
  await persistAppServerSessions();
  finishActiveAuthProfileFailover(
    job,
    job.failed ? new Error(`${job.failed} 个 Session 在账号轮换后恢复失败`) : null,
  );
}

function beginActiveAuthProfileFailover({ host, sessionId, error }) {
  const current = appServerActiveAuthFailoverJobs.get(host);
  if (current && !["completed", "failed"].includes(current.status)) {
    current.interruptedSessions.add(sessionId);
    current.error = current.error || error || null;
    notifyClients();
    return publicProfileFailoverJob(current);
  }
  const hostSnapshot = snapshot.hosts.find(
    (candidate) => candidate.alias === host && candidate.reachable,
  );
  const job = {
    host,
    executable: hostCodexExecutable(hostSnapshot),
    status: "checking-profiles",
    failedProfile: null,
    targetProfile: null,
    targetProfileRecord: null,
    interruptedSessions: new Set([sessionId]),
    waitingForSessions: new Set(),
    attemptedProfiles: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    nextAttemptAt: null,
    error: error || null,
    timer: null,
    results: [],
  };
  appServerActiveAuthFailoverJobs.set(host, job);
  auditLifecycle("app-server-auth-profile-failover-started", {
    host,
    sessionId,
    authenticationError: error,
    remoteSessionSignalSent: false,
  }).catch(() => {});
  attemptActiveAuthProfileFailover(job).catch((failure) =>
    finishActiveAuthProfileFailover(job, failure),
  );
  notifyClients();
  return publicProfileFailoverJob(job);
}

function publicAuthRestartJob(job) {
  return {
    id: job.id,
    host: job.host,
    status: job.status,
    total: job.total,
    completed: job.completed,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    results: job.results,
    error: job.error,
  };
}

function latestAuthRestartJob(host) {
  return Array.from(authRestartJobs.values())
    .filter((job) => job.host === host)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0] || null;
}

async function loadAuthRestartJobs() {
  try {
    const parsed = JSON.parse(await readFile(AUTH_RESTART_JOBS_FILE, "utf8"));
    for (const stored of Array.isArray(parsed?.jobs) ? parsed.jobs : []) {
      if (!stored?.id || !stored?.host) continue;
      const interrupted = ["queued", "running"].includes(stored.status);
      authRestartJobs.set(stored.id, {
        ...stored,
        status: interrupted ? "failed" : stored.status,
        completedAt: interrupted
          ? stored.completedAt || new Date().toISOString()
          : stored.completedAt,
        error: interrupted
          ? stored.error || "Bridge 重启中断了批量恢复；可从 Inactive 逐项重试"
          : stored.error || null,
      });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error(`无法读取 ${AUTH_RESTART_JOBS_FILE}: ${error.message}`);
    }
  }
}

function persistAuthRestartJobs() {
  const jobs = Array.from(authRestartJobs.values())
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
    .slice(0, 20)
    .map(publicAuthRestartJob);
  const serialized = `${JSON.stringify({ version: 1, jobs }, null, 2)}\n`;
  authRestartWritePromise = authRestartWritePromise
    .catch(() => {})
    .then(async () => {
      await mkdir(STATE_DIR, { recursive: true });
      const temporary = `${AUTH_RESTART_JOBS_FILE}.tmp`;
      await writeFile(temporary, serialized, "utf8");
      await rename(temporary, AUTH_RESTART_JOBS_FILE);
    });
  return authRestartWritePromise;
}

function startAuthRestart(hostAlias) {
  assertNoPendingProfileMigration(hostAlias);
  const existing = Array.from(authRestartJobs.values()).find(
    (job) => job.host === hostAlias && ["queued", "running"].includes(job.status),
  );
  if (existing) return publicAuthRestartJob(existing);
  const host = publicSnapshot().hosts.find(
    (candidate) => candidate.alias === hostAlias && candidate.reachable,
  );
  if (!host) throw new Error(`主机 ${hostAlias} 当前不可连接`);
  const appServerSessions = appServerManager
    .sessionRecords()
    .filter((session) => session.host === hostAlias && !fixedProfileSession(session));
  // Account changes may restart transports owned by this Bridge, but must never
  // terminate CLI processes launched from VS Code or another terminal. Those
  // processes can own foreground evaluations and their lifecycle is external.
  const candidates = appServerSessions.map((session) => ({
    sessionId: session.sessionId,
    transport: "app-server",
    // closeHost mutates the live record to offline. Preserve the pre-restart
    // state so interrupted work can receive one continuation turn afterward.
    session: { ...session },
  }));
  const job = {
    id: randomUUID(),
    host: hostAlias,
    status: "queued",
    total: candidates.length,
    completed: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    results: [],
    error: null,
  };
  authRestartJobs.set(job.id, job);
  persistAuthRestartJobs().catch(() => {});

  (async () => {
    appServerAuthRecoveryHosts.add(hostAlias);
    const reconnectTimer = appServerReconnectTimers.get(hostAlias);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    appServerReconnectTimers.delete(hostAlias);
    appServerReconnectAttempts.delete(hostAlias);
    try {
      job.status = "running";
      persistAuthRestartJobs().catch(() => {});
      const profiles = await listAuthProfiles(hostAlias);
      const writerKeys = new Set(
        appServerSessions
          .map((session) => appServerConnectionKey(session.connectionKey))
          .filter((connectionKey) => connectionKey.startsWith("profile-")),
      );
      if (profiles.activeProfile) writerKeys.add(`profile-${profiles.activeProfile}`);

      // These are only SCOPE-owned app-server tmux daemons. They retain the
      // per-thread writer lock after an SSH proxy disconnect, so force restart
      // must retire them before resuming every thread through the active profile.
      if (appServerSessions.length) closeUnboundHostConnections(hostAlias);
      for (const writerKey of writerKeys) {
        const retired = await runSshCommand(
          hostAlias,
          retireProfileAppServerCommand(writerKey),
          "",
          15_000,
          100_000,
        );
        if (retired.code !== 0) {
          throw new Error(
            `无法终止旧账号 writer ${writerKey}: ${cleanSshError(retired.stderr || retired.stdout)}`,
          );
        }
        await auditLifecycle("app-server-profile-writer-force-restarted", {
          host: hostAlias,
          connectionKey: writerKey,
          remoteSessionSignalSent: false,
        });
      }
      // Persist the target writer before the individual resumes. If a first
      // attempt races daemon startup, the later retry (or a Bridge restart)
      // still goes to the newly selected account instead of reviving pro-lite.
      for (const candidate of candidates) {
        activeProfileMigrationSessions.add(sessionKey(hostAlias, candidate.sessionId));
      }
      await persistAppServerSessions();
      // Give tmux/codex a moment to close the filesystem writer locks before
      // opening the same rollout under the newly active profile.
      await new Promise((resolve) => setTimeout(resolve, 400));

      // Use the real Codex CLI, not the first scanned process executable. A
      // Codex process can be represented as `node .../codex`, which would make
      // a durable daemon invoke `node app-server` and immediately exit.
      const fallbackExecutable = hostCodexExecutable(host);
      for (const candidate of candidates) {
        const { sessionId } = candidate;
        try {
          if (candidate.transport === "app-server") {
            const { session } = candidate;
            const shouldContinue =
              session.resumeOnRecovery === true ||
              ["working", "attention"].includes(session.status);
            const resumed = await appServerManager.resumeSession({
              host: hostAlias,
              sessionId,
              path: session.path,
              cwd: session.cwd,
              model: session.model || null,
              effort: session.effort || null,
              yolo: session.yolo !== false,
              executable: fallbackExecutable,
              resumeOnRecovery: shouldContinue,
              connectionKey: "active",
            });
            if (shouldContinue) {
              await appServerManager.startTurn(hostAlias, resumed.sessionId, "继续", {
                automaticRecovery: true,
                effort: session.effort || null,
              });
            }
            job.results.push({
              sessionId,
              ok: true,
              transport: "app-server",
              target: resumed.sessionId,
              connectionKey: resumed.connectionKey,
              continued: shouldContinue,
            });
          }
        } catch (error) {
          job.results.push({
            sessionId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        job.completed += 1;
        persistAuthRestartJobs().catch(() => {});
        notifyClients();
      }
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      persistAuthRestartJobs().catch(() => {});
      setTimeout(() => scanAll({ hosts: [hostAlias] }).catch(() => {}), 700);
    } finally {
      appServerAuthRecoveryHosts.delete(hostAlias);
      scheduleAppServerReconnects();
    }
  })().catch((error) => {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.completedAt = new Date().toISOString();
    persistAuthRestartJobs().catch(() => {});
  });
  return publicAuthRestartJob(job);
}
appServerManager.on("change", () => {
  persistAppServerSessions().catch((error) =>
    console.error(`app-server Session 清单写入失败：${error.message}`),
  );
  notifyClients();
  syncHumanRequestNotifications().catch((error) =>
    console.error(`邮件通知同步失败：${error.message}`),
  );
  scheduleAppServerReconnects();
});
appServerManager.on(
  "authentication-failure",
  async ({ host, connectionKey, sessionId, error }) => {
    if (!await appServerManager.canAutoContinue(host, sessionId)) return;
    if (profileFromConnection(connectionKey) || sessionProfileAssignment(host, sessionId)?.desiredProfile) return;
    if (appServerConnectionKey(connectionKey) === "active") {
      beginActiveAuthProfileFailover({ host, sessionId, error });
      return;
    }
    recoverAuthenticationFailedSessions(host, { sourceConnectionKey: connectionKey }).catch(
      (recoveryError) =>
        auditLifecycle("app-server-auth-recovery-failed", {
          host,
          sessionId,
          connectionKey,
          error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
          authenticationError: error,
          remoteSessionSignalSent: false,
        }),
    );
  },
);
appServerManager.on("turn-failure", (failure) => {
  auditLifecycle("app-server-turn-failed", {
    ...failure,
    remoteSessionSignalSent: false,
  }).catch(() => {});
});
appServerManager.on("thread-system-error", (failure) => {
  auditLifecycle("app-server-thread-system-error", {
    ...failure,
    remoteSessionSignalSent: false,
  }).catch(() => {});
});
appServerManager.on("thread-archived", ({ host, sessionId, connectionKey }) => {
  const key = sessionKey(host, sessionId);
  // Includes descendants acknowledged by the server; never infer that every child succeeded.
  const existing = managementState.sessions[key]?.archive;
  const agent = findAgent(host, sessionId);
  managementState.sessions[key] = { ...managementState.sessions[key], archive: {
    ...existing, host, sessionId, connectionKey, executable: existing?.executable || hostCodexExecutable(host),
    title: existing?.title || agent?.title || sessionId, cwd: existing?.cwd || agent?.cwd || "",
    phase: "archived", error: null, archivedAt: new Date().toISOString(),
  } };
  persistManagementState().then(notifyClients).catch(error => console.error(`归档记录保存失败：${error.message}`));
});
appServerManager.on("session-release", ({ host, sessionId, reason, record }) => {
  if (["stop", "idle"].includes(reason) && record) {
    const key = sessionKey(host, sessionId);
    managementState.sessions[key] = { ...managementState.sessions[key],
      closedSession: persistedAppServerSession(record) };
    persistManagementState().catch((error) => console.error(`恢复记录保存失败：${error.message}`));
  }
  persistedAppServerSessions.delete(sessionKey(host, sessionId));
  persistAppServerSessions().catch((error) =>
    console.error(`app-server Session 清单删除失败：${error.message}`),
  );
});
syncHumanRequestNotifications().catch((error) =>
  console.error(`邮件通知初始化失败：${error.message}`),
);

function snapshotInvalidationPayload() {
  const sync = snapshotSyncStore.info();
  return `data: ${JSON.stringify({
    type: "snapshot-invalidated",
    generatedAt: snapshot.generatedAt,
    scanning: snapshot.scanning,
    epoch: sync.epoch,
    revision: sync.revision,
  })}\n\n`;
}

function removeEventClient(response) {
  const client = clients.get(response);
  if (client?.onDrain) response.removeListener("drain", client.onDrain);
  clients.delete(response);
}

function writeEventClient(client, payload) {
  const { response } = client;
  if (response.destroyed || response.writableEnded) {
    removeEventClient(response);
    return;
  }
  if (client.blocked) {
    // Keep only the newest invalidation. Never retain repeated multi-megabyte
    // snapshots behind a slow or backgrounded browser tab.
    client.pending = payload;
    return;
  }
  try {
    if (response.write(payload)) return;
    client.blocked = true;
    client.onDrain = () => {
      client.blocked = false;
      client.onDrain = null;
      const pending = client.pending;
      client.pending = null;
      if (pending) writeEventClient(client, pending);
    };
    response.once("drain", client.onDrain);
  } catch {
    removeEventClient(response);
  }
}

function publishSnapshotSync() {
  snapshotSyncStore.publish(publicSnapshot());
}

function flushClientNotification() {
  snapshotNotifyTimer = null;
  publishSnapshotSync();
  const payload = snapshotInvalidationPayload();
  for (const client of clients.values()) writeEventClient(client, payload);
}

function notifyClients() {
  // App-server streaming can emit many changes per second. Coalesce them into
  // one bounded sync revision instead of making every browser re-fetch and
  // parse a multi-megabyte snapshot for every protocol event.
  if (snapshotNotifyTimer) return;
  snapshotNotifyTimer = setTimeout(flushClientNotification, 750);
  snapshotNotifyTimer.unref?.();
}

async function syncHumanRequestNotifications() {
  const events = appServerManager
    .publicState()
    .pendingRequests.map(humanRequestEmailEvent);
  if (!humanRequestNotificationsPrimed) {
    humanRequestNotificationsPrimed = true;
    await emailNotifier.prime(events);
    return;
  }
  await Promise.all(events.map((event) => emailNotifier.notify(event)));
}

async function syncDlcAlertNotifications() {
  const events = aliyunPlugin.snapshot().alerts.map((alert) =>
    dlcAlertEmailEvent(alert, aliyunPlugin.snapshot().scannedAt),
  );
  if (!dlcAlertNotificationsPrimed) {
    dlcAlertNotificationsPrimed = true;
    await emailNotifier.prime(events);
    return;
  }
  await Promise.all(events.map((event) => emailNotifier.notify(event)));
}

function hasConnectedAppServer(alias) {
  return appServerManager
    .publicState()
    .connections.some(
      (connection) =>
        connection.host === alias && connection.status === "connected",
    );
}

async function scanAll({ force = false, hosts: forcedHostList = [] } = {}) {
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
    snapshot = { ...snapshot, scanning: true };
    notifyClients();

    let aliases = [];
    try {
      aliases = parseSshAliases(await readFile(SSH_CONFIG, "utf8")).filter(alias => alias !== LOCAL_HOST);
    } catch (error) {
      snapshot = {
        ...snapshot,
        generatedAt: snapshot.generatedAt || new Date().toISOString(),
        scanning: false,
        sshConfig: SSH_CONFIG,
        error: `无法读取 SSH Config：${error.message}`,
      };
      notifyClients();
      return snapshot;
    }

    const scanStartedAt = Date.now();
    const forcedHosts = new Set(forcedHostList);
    const previousHosts = new Map(
      snapshot.hosts.map((host) => [host.alias, host]),
    );
    const hosts = await mapLimit(aliases, CONCURRENCY, async (alias) => {
      const previous = previousHosts.get(alias);
      const dueAt = hostNextScanAt.get(alias) || 0;
      if (!force && !forcedHosts.has(alias) && previous && dueAt > scanStartedAt) {
        return { ...previous, scanDeferred: true };
      }
      // Management requests use a separate short-lived SSH connection. Do not
      // race a full inventory probe against it or replace healthy data with a
      // transient MaxStartups/timeout failure.
      if ((sshOperationCounts.get(alias) || 0) > 0 && previous) {
        return { ...previous, scanDeferred: true };
      }

      const scanned = parseHost(alias, await runSsh(alias, previous), previous);
      if (scanned.reachable) {
        hostFailureStreaks.delete(alias);
        hostNextScanAt.set(alias, scanStartedAt + POLL_MS);
        return { ...scanned, scanDeferred: false, stale: false };
      }

      const streak = (hostFailureStreaks.get(alias) || 0) + 1;
      hostFailureStreaks.set(alias, streak);
      const appServerConnected = hasConnectedAppServer(alias);
      const retryDelay = appServerConnected
        ? Math.min(60_000, POLL_MS * 2 ** Math.min(streak, 3))
        : Math.min(5 * 60_000, POLL_MS * 2 ** Math.min(streak, 5));
      hostNextScanAt.set(alias, scanStartedAt + retryDelay);
      const lastInventoryAt =
        previous?.inventoryUpdatedAt || snapshot.generatedAt || null;
      const lastInventoryMs = Date.parse(lastInventoryAt || "");
      const withinStaleGrace =
        Number.isFinite(lastInventoryMs) &&
        scanStartedAt - lastInventoryMs <= INVENTORY_STALE_GRACE_MS;
      if (
        previous &&
        (appServerConnected || (previous.reachable && withinStaleGrace))
      ) {
        return {
          ...previous,
          reachable: true,
          hostname: previous.hostname || alias,
          latencyMs: scanned.latencyMs,
          error: null,
          inventoryError: scanned.error,
          inventoryUpdatedAt: lastInventoryAt,
          scanDeferred: false,
          stale: true,
        };
      }
      return preserveHostSessions(previous, { ...scanned, scanDeferred: false, stale: true });
    });
    hosts.unshift(localCodex.host());
    hosts.sort((a, b) => {
      if (a.alias === LOCAL_HOST || b.alias === LOCAL_HOST) return a.alias === LOCAL_HOST ? -1 : 1;
      if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
      if (a.agents.length !== b.agents.length) return b.agents.length - a.agents.length;
      return a.alias.localeCompare(b.alias);
    });

    gpuUsageHistory = updateGpuUsageHistory(
      gpuUsageHistory,
      hosts,
      Date.now(),
    );
    await persistGpuUsageHistory().catch((error) => {
      console.error(`无法保存 GPU 占用历史: ${error.message}`);
    });

    const allAgents = hosts.flatMap((host) => host.agents);
    snapshot = {
      generatedAt: new Date().toISOString(),
      scanning: false,
      cached: false,
      cacheSavedAt: null,
      sshConfig: SSH_CONFIG,
      hosts,
      summary: {
        hosts: hosts.length,
        online: hosts.filter((host) => host.reachable).length,
        codex: allAgents.length,
        tmux: hosts.reduce((total, host) => total + host.panes.length, 0),
        attention: allAgents.filter((agent) => agent.status === "attention").length,
      },
    };
    void sessionCatalog.refresh(force).catch((error) => console.error(`会话目录扫描失败：${error.message}`));
    detectTmuxCapacityFailures(hosts);
    await persistSnapshotCache().catch((error) => {
      console.error(`无法保存 snapshot 缓存: ${error.message}`);
    });
    notifyClients();
    restorePersistedAppServerSessions().catch((error) =>
      console.error(`app-server Session 补连失败：${error.message}`),
    );
    return snapshot;
  })().finally(() => {
    scanPromise = null;
  });
  return scanPromise;
}


const sessionArchives = sessionArchiveService({
  manager: appServerManager, getState: () => managementState, persist: persistManagementState,
  findAgent, getHost: alias => snapshot.hosts.find(h => h.alias === alias),
  executable: hostCodexExecutable,
  connectionKey: async (host, id) => {
    const binding = sessionProfileAssignment(host, id);
    if (profileHandoffPending(binding)) throw new Error("正在交接账号，请完成后再归档");
    const saved = persistedAppServerSessions.get(sessionKey(host, id)) || managementState.sessions[sessionKey(host, id)]?.closedSession;
    const writer = !saved?.connectionKey && !binding?.profile ? await detectRemoteSessionWriter(host, id) : null;
    return boundConnectionKey(binding, saved?.connectionKey || writer?.connectionKey || await newSessionConnectionKey(host));
  }, notify: notifyClients,
  protectedSession: (host, id) => { const state = workbench.store.read(); return state.config.manager.host === host && state.managerSession?.sessionId === id; },
  restored: async (host, sessionId, thread) => { revealUnarchivedSession(host, sessionId, thread); await persistHistoryIndex(); },
});
const handleArchives = archiveRoutes(sessionArchives, { readJsonBody, jsonResponse });
const cliAdapter = remoteCliAdapter(runSshCommand, {
  hostPreLaunch: (host) => hostRuntimeConfig(host).preLaunchCommand,
});
const workbench = new WorkbenchService({
  taskQueueEnabled: deployment.taskQueue,
  store: await new WorkbenchStore(path.join(STATE_DIR, "workbench.json"), { configFile: process.env.SCOPE_WORKBENCH_CONFIG }).load(),
  snapshot: publicSnapshot,
  resolveAttachments: (items, host, expected) =>
    resolveUploadedAttachments(items, host, expected),
  adapters: {
    codex: codexWorkbenchAdapter({ archives: sessionArchives, manager: appServerManager, getHost: alias => snapshot.hosts.find(h => h.alias === alias), readModels: readInstalledModels, connectionKey: newSessionConnectionKey }),
    claude: cliAdapter,
    antigravity: cliAdapter,
    dsh: cliAdapter,
  },
});
function effectiveProviderSettings(provider, host) {
  const base = workbench.state().config.providers[provider] || {};
  const hostSetup = host ? hostRuntimeConfig(host)?.preLaunchCommand?.trim() || "" : "";
  return {
    ...base,
    preLaunchCommand: base.preLaunchCommand?.trim() || hostSetup,
  };
}
function effectiveMaintenanceSettings(provider, host) {
  const base = workbench.state().config.providers[provider] || {};
  const runtime = host ? hostRuntimeConfig(host) : null;
  const hostUpdate = runtime?.updatePreCommand?.trim() || "";
  const hostLaunch = runtime?.preLaunchCommand?.trim() || "";
  return {
    ...base,
    updatePreCommand: hostUpdate || hostLaunch || base.preLaunchCommand?.trim() || "",
    preLaunchCommand: hostLaunch || base.preLaunchCommand?.trim() || "",
  };
}
const maintenance = await new AgentMaintenance({ directory: STATE_DIR, run: runSshCommand,
  getHost: alias => snapshot.hosts.find(h => h.alias === alias),
  settings: effectiveMaintenanceSettings,
}).load();
const sessionCatalog = new SessionCatalog({ hosts: () => snapshot.hosts, run: runSshCommand });
const handleCatalog = catalogRoutes(sessionCatalog, { jsonResponse, readJsonBody, resolveCodex: (entry) => {
  const host = snapshot.hosts.find((item) => item.alias === entry.host);
  if (!host) throw new Error("设备不在当前配置中");
  const existing =
    findAgent(entry.host, entry.sessionId) ||
    historicalSessions.get(sessionKey(entry.host, entry.sessionId));
  const agent = enrichAgentRelations(
    host,
    existing ||
      historicalAgent(host, {
        id: entry.sessionId,
        path: entry.path,
        cwd: entry.cwd,
        model: entry.model,
        reasoningEffort: "",
        mtimeMs: Number(entry.updatedAt) || 0,
        firstUser: entry.title,
        lastUser: entry.title,
        lastAssistant: "",
        userMessages: [entry.title],
        assistantMessages: [],
      }),
  );
  historicalSessions.set(sessionKey(entry.host, entry.sessionId), agent);
  return agent;
} });
const nativeModels = new NativeModels({ hosts: () => snapshot.hosts, run: runSshCommand, settings: effectiveProviderSettings });
const nativeCommands = new NativeCommands({ hosts: () => snapshot.hosts, run: runSshCommand, settings: effectiveProviderSettings });
const cliConversations = await new CliConversations({ filename: path.join(STATE_DIR, "cli-conversations.json"), adapter: cliAdapter, models: nativeModels, commands: nativeCommands, lifecycle: nativeSessionState(runSshCommand),
  hosts: () => snapshot.hosts, settings: effectiveProviderSettings, catalog: sessionCatalog,
  resolveAttachments: (items, host, expected) =>
    resolveUploadedAttachments(items, host, expected),
}).load();
const handleCliConversations = cliConversationRoutes(cliConversations, { readJsonBody, jsonResponse, models: nativeModels, commands: nativeCommands });
const handleSessionCommands = sessionCommandRoutes({manager:appServerManager,jsonResponse});
cliConversations.start();
process.once("exit", () => cliConversations.stop());
const handleMaintenance = maintenanceRoutes(maintenance);
const handleModels = modelRoutes(() => ({appServerManager, auditLifecycle, checkedProfileSlug, findAgent, hostRuntimeConfig, jsonResponse, listAuthProfiles, persistAppServerSessions, readInstalledModels, readJsonBody, selectTmuxModel, sessionProfileAssignment, sessionProfiles, sessionYolo, snapshot}));
const localDialogue = localHistoryReader({ manager: appServerManager,
  findRollout: (host, id, subagentId) => {
    const agent = findAgent(host, id) || historicalSessions.get(sessionKey(host, id));
    if (subagentId) {
      return agent?.subagents?.find((item) => item.id === subagentId) ||
        snapshot.hosts.find((item) => item.alias === host)?.sessions?.find(
          (item) => item.isSubagent && item.id === subagentId && item.parentThreadId === id,
        ) || null;
    }
    return agent?.rollout || sessionCatalog.get(JSON.stringify([host, "codex", id]));
  },
});
const handleDialogue = dialogueRoutes(() => ({localDialogue, DIALOGUE_PROBE, DIALOGUE_TIMEOUT_MS, RAW_CONTEXT_PROBE, cleanSshError, findAgent, getSnapshot: () => snapshot, historicalSessions, jsonResponse, readJsonBody, runSshCommand, sessionKey, shellQuote}));
const handleRuntime = runtimeRoutes(() => ({hostRuntimeConfig, jsonResponse, readJsonBody, saveHostRuntimeConfig, snapshot}));
const accountQuotas = createAccountQuotaService({
  appServerManager,
  localCodex,
  listAuthProfiles,
  hostCodexExecutable,
  hostRuntimeConfig,
  wrapBootstrapAppServer,
  shellQuote,
  mapLimit,
  sshTimeoutMs: SSH_TIMEOUT_MS,
  getSnapshot: () => snapshot,
  runSshCommand,
  providerSettings: effectiveProviderSettings,
});
const handleAccounts = authRoutes(() => ({accountQuotas, appServerActiveAuthFailoverJobs, assertProfileNotBound, auditLifecycle, authProfileManager, authRestartJobs, checkedProfileSlug, deleteAuthProfile, hostCodexExecutable, jsonResponse, latestAuthRestartJob, listAuthProfiles, normalizeProfileName, publicAuthRestartJob, publicProfileFailoverJob, readJsonBody, readLocalAuthProfiles: () => readLocalAuthProfiles({ localCodex }), runProfileWrite, snapshot, startAuthRestart}));
const handleWorkbench = workbenchRoutes(workbench, { readJsonBody, jsonResponse });
const handleDirectories = directoryRoutes({ local: (input, creating) => localDirectories(input, creating, localCodex.defaultCwd), getHost: alias => snapshot.hosts.find(host => host.alias === alias), run: runSshCommand, readJsonBody, jsonResponse, listScript: REMOTE_DIRECTORY_PROBE, shellQuote, cleanError: cleanSshError });
const handleConversation = conversationRoutes(appServerManager, { readJsonBody, jsonResponse, persist: persistAppServerSessions });
const tunnelManager = await new RemoteTunnelManager({
  stateDir: STATE_DIR,
  emailNotifier,
  legacyTunnelHost: deployment.emailTunnelHost,
}).load();
await tunnelManager.start();
const remoteBootstrap = new RemoteBootstrapService({
  run: runSshCommand,
  getHost: (alias) => snapshot.hosts.find((host) => host.alias === alias),
  getOperatorName: () => managementState.operatorName,
  tunnels: tunnelManager,
});
const handleEmail = emailRoutes({
  emailNotifier,
  readJsonBody,
  jsonResponse,
  onChanged: () => notifyClients(),
});
const handleRemoteBootstrap = remoteBootstrapRoutes({
  bootstrap: remoteBootstrap,
  readJsonBody,
  jsonResponse,
});
const handlePlugins = pluginRoutes(plugins);
// Compatibility facade: both old and new endpoints share the plugin store.
const handleSubmissionSettings = submissionSettingsRoutes({
  store: {
    read: () => { const s = aliyunPlugin.store.read(); return { enabled: s.enabled, host: s.config.host }; },
    save: value => { const s = plugins.configure("aliyun-dlc", { enabled: value.enabled, config: { host: value.host } }, aliyunPlugin.store.read().revision); return { enabled: s.enabled, host: s.config.host }; },
  }, isScanning: aliyunPlugin.busy, apply: () => {},
});
const handleSystem = systemRoutes(() => ({
  HISTORY_TIMEOUT_MS,
  appServerManager,
  cachedHistoryResult,
  cleanSshError,
  clients,
  enrichAgentRelations,
  getSnapshot: () => snapshot,
  historicalAgent,
  historicalSessions,
  jsonResponse,
  mapLimit,
  persistHistoryIndex,
  plugins,
  publicSnapshot,
  publishSnapshotSync,
  readJsonBody,
  runSshCommand,
  scanAll,
  sessionKey,
  shellQuote,
  snapshotSyncStore,
  updateHistoryIndex,
}));
const handleSessionLifecycle = sessionLifecycleRoutes(() => ({
  TAKEOVER_TIMEOUT_MS,
  appServerAuthRecoveryHosts,
  appServerManager,
  appServerRestoreFailures,
  auditLifecycle,
  cleanSshError,
  clients,
  codexExecutable,
  codexUpgrades,
  detectRemoteSessionWriter,
  findLiveAgent,
  getManagementState: () => managementState,
  getSnapshot: () => snapshot,
  historicalSessions,
  hostConfigRestarts,
  hostRuntimeConfig,
  jsonResponse,
  localDirectory,
  newSessionConnectionKey,
  notifyClients,
  persistAppServerSessions,
  persistHistoryIndex,
  persistManagementState,
  persistSnapshotCache,
  publishSnapshotSync,
  readJsonBody,
  recoverAuthenticationFailedSessions,
  recoverHostAppServerSessions,
  recoveryAgent,
  rememberTmuxAgent,
  removeEventClient,
  resolveUploadedAttachments,
  resumeAgentInTmux,
  resumeManagedAppServerSession,
  revealUnarchivedSession,
  runSshCommand,
  saveHostRuntimeConfig,
  scanAll,
  sendTmuxText,
  sessionKey,
  sessionProfileAssignment,
  sessionYolo,
  setSnapshot: (next) => { snapshot = next; },
  shellQuote,
  snapshotInvalidationPayload,
  snapshotSyncStore,
  tmuxAgentForDelivery,
  writeEventClient,
}));
const handleManagement = managementRoutes(() => ({
  appServerManager,
  discoverWandbRuns,
  findAgent,
  generateCodexSummary,
  getManagementState: () => managementState,
  jsonResponse,
  notifyClients,
  persistManagementState,
  readJsonBody,
  searchAssistantSessions,
  sessionKey,
  setManagementState: (next) => { managementState = next; },
}));
const handleSessionDelivery = sessionDeliveryRoutes(() => ({
  ATTACHMENT_TTL_MS,
  appServerManager,
  auditLifecycle,
  cancelTmuxCapacityRecovery,
  findAgent,
  getManagementState: () => managementState,
  getSnapshot: () => snapshot,
  jsonResponse,
  localCodex,
  notifyClients,
  persistManagementState,
  readJsonBody,
  recoverHostAppServerSessions,
  renderResourcePrompt,
  resolveUploadedAttachments,
  sendTmuxText,
  sessionKey,
  setManagementState: (next) => { managementState = next; },
  shellQuote,
  storeUploadedAttachment,
  streamAttachmentToHost,
}));
process.once("exit", () => tunnelManager.stop());
process.once("exit", () => plugins.stop());
process.once("exit", () => workbench.stop());
const server = createServer(requestHandler(async (request, response, url) => {
  if (await handleEmail(request, response, url)) return;
  if (await handleRemoteBootstrap(request, response, url)) return;
  if (await handlePlugins(request, response, url)) return;
  if (await handleSubmissionSettings(request, response, url)) return;
  if (await handleCatalog(request, response, url)) return;
  if (await handleCliConversations(request, response, url)) return;
  if (await handleSessionCommands(request, response, url)) return;
  if (await handleMaintenance(request, response, url)) return;
  if (await handleArchives(request, response, url)) return;
  if (await handleConversation(request, response, url)) return;
  if (await handleDirectories(request, response, url)) return;
  if (await handleWorkbench(request, response, url)) return;
  if (await handleModels(request,response,url)) return;
  if (await handleDialogue(request,response,url)) return;
  if (await handleRuntime(request,response,url)) return;
  if (await handleAccounts(request,response,url)) return;
  if (await handleSystem(request, response, url)) return;
  if (await handleSessionLifecycle(request, response, url)) return;
  if (await handleManagement(request, response, url)) return;
  if (await handleSessionDelivery(request, response, url)) return;

  response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Not found" }));
}, { host: HOST, trustedOrigins: TRUSTED_BROWSER_ORIGINS }));

attachTerminalGateway({
  server,
  host: HOST,
  trustedOrigins: TRUSTED_BROWSER_ORIGINS,
  getSnapshot: () => snapshot,
  sshTimeoutMs: SSH_TIMEOUT_MS,
  auditLifecycle,
});

process.once("exit", () => appServerManager.close());
process.once("exit", () => authProfileManager.close());
process.once("exit", () => {
  for (const timer of appServerReconnectTimers.values()) clearTimeout(timer);
  appServerReconnectTimers.clear();
  appServerReconnectInFlight.clear();
});

await Promise.all([
  loadManagementState(),
  loadGpuUsageHistory(),
  loadSnapshotCache(),
  loadHistoryIndex(),
  loadAuthRestartJobs(),
  loadPersistedAppServerSessions(),
]);

server.listen(PORT, HOST, () => {
  workbench.start();
  auditLifecycle("bridge-started", {
    pid: process.pid,
    remoteSessionSignalSent: false,
  });
  console.log(`SCOPE SSH Bridge: http://${HOST}:${PORT}`);
  console.log(`SSH Config: ${SSH_CONFIG}`);
  // Reconnect sessions that belonged to hosts in the persisted snapshot before
  // a slow first inventory pass over every SSH alias. The scan then retries any
  // records skipped because their cached host was offline or missing.
  restorePersistedAppServerSessions()
    .catch((error) =>
      console.error(`app-server Session 快速恢复失败：${error.message}`),
    )
    .then(() => scanAll())
    .then(() => {
      restorePersistedAppServerSessions().catch((error) =>
        console.error(`app-server Session 自动恢复失败：${error.message}`),
      );
      plugins.start();
    })
    .catch((error) => console.error(error));
  setInterval(() => scanAll().catch(() => {}), POLL_MS).unref();
  startIdleSessionReaper(appServerManager, {
    timeoutMs: () => {
      const envVal = process.env.SCOPE_SESSION_IDLE_MINUTES;
      if (envVal !== undefined && envVal !== "") return idleSessionTimeout(envVal);
      const mins = workbench.state().config?.scheduler?.sessionIdleGraceMinutes;
      return Number.isFinite(mins) && mins > 0 ? mins * 60_000 : 15 * 60_000;
    },
    residentLimit: (host) => {
      const override = hostRuntimeConfig(host)?.residentSessionLimit;
      if (Number.isInteger(override) && override >= 0) return override;
      const globalPool = workbench.state().config?.scheduler?.residentSessionsPerHost;
      return Number.isInteger(globalPool) && globalPool >= 0 ? globalPool : 5;
    },
    isReserved: (host, sessionId) => {
      const wb = workbench.store.read();
      if (wb.config?.manager?.host === host && wb.managerSession?.sessionId === sessionId) {
        return true;
      }
      if (Boolean(managementState.sessions[sessionKey(host, sessionId)]?.reserved)) {
        return true;
      }
      const live = findLiveAgent(host, sessionId);
      if (live?.subagents?.some((sub) => sub.turnState === "working")) {
        return true;
      }
      if (Array.isArray(live?.localWorkloads) && live.localWorkloads.length > 0) {
        return true;
      }
      if (
        gpuUsageHistory?.episodes?.some(
          (ep) => ep.active && ep.host === host && ep.ownerSessionId === sessionId,
        )
      ) {
        return true;
      }
      return false;
    },
    onError: (error, session) => console.error(`空闲会话释放失败 ${session.host}/${session.sessionId}: ${error.message}`),
  });

});
