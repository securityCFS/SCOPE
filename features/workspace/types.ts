import type { ArchiveRecord } from "@/features/archive/use-session-archives";
// Shared domain contracts for the remote workspace.
import { type ProfileAssignment } from "@/components/session-profile-control";
import type {
  AccountCredits,
  AccountQuota,
  AccountQuotaGroup,
  AccountQuotaWindow,
} from "@/lib/account-quota";
export type { AccountCredits, AccountQuota, AccountQuotaGroup, AccountQuotaWindow };

export type Rollout = {
  id: string;
  rootSessionId: string;
  parentThreadId: string;
  agentPath: string;
  agentNickname: string;
  isSubagent: boolean;
  cwd: string;
  startedAt: string;
  cliVersion: string;
  path: string;
  mtimeMs: number;
  lastUser: string;
  lastAssistant: string;
  lastAction: string;
  lastError: string;
  firstUser: string;
  userMessages: string[];
  assistantMessages: string[];
  model: string;
  reasoningEffort: string;
  approvalPolicy: string;
  sandboxPolicy: string;
  collaborationMode: string;
  launches?: Array<{
    timestamp: string;
    command: string;
  }>;
  account: {
    planType: string;
    primary: {
      used_percent?: number;
      window_minutes?: number;
      resets_at?: number;
    } | null;
    secondary?: {
      used_percent?: number;
      window_minutes?: number;
      resets_at?: number;
    } | null;
    credits: {
      has_credits?: boolean;
      unlimited?: boolean;
      balance?: string;
    } | null;
  } | null;
  tokenUsage: {
    modelContextWindow?: number;
  } | null;
  turnState: "working" | "idle";
  lastEventAt: string;
  archived?: boolean;
};

export type SessionSummary = {
  theme: string;
  category: "research" | "training" | "evaluation" | "engineering" | "other";
  objective: string;
  progress: string;
  result: string;
  nextStep: string;
  source: "rollout" | "codex" | "manual";
  updatedAt: string | null;
};

export type DialogueEvent = {
  id: string;
  kind:
    | "user"
    | "assistant"
    | "reasoning"
    | "intermediate"
    | "command"
    | "tool"
    | "error"
    | "system";
  category: "dialogue" | "operations" | "reasoning" | "subagent";
  title: string;
  text: string;
  timestamp: string | null;
  phase?: string;
  toolName?: string;
  command?: string;
  output?: string;
  status?: string;
  turnId?: string;
};

export type DialogueCategory = DialogueEvent["category"];

export type DialogueSnapshot = {
  host: string;
  sessionId: string;
  path: string;
  loadedAt: string;
  totalLines: number;
  totalBytes: number;
  scannedBytes: number;
  events: DialogueEvent[];
  counts: Partial<Record<DialogueEvent["kind"], number>>;
  toolEventCount: number;
  omittedToolEvents: number;
  hiddenReasoningCount: number;
  pageSize: number;
  hasMore: boolean;
  nextBefore: number | null;
};

export type SessionManagement = {
  archive?: ArchiveRecord;
  priority?: "P0" | "P1" | "P2" | "P3" | "paused";
  priorityUpdatedAt?: string;
  reserved?: boolean;
  reservedUpdatedAt?: string;
  displayName?: string;
  displayNameUpdatedAt?: string;
  summary?: SessionSummary;
  lastPromptSyncedAt?: string;
  experiments?: {
    source: "wandb-local";
    discoveredAt: string;
    root: string;
    runs: Array<{
      id: string;
      name: string;
      path: string;
      updatedAt: number;
      live: boolean;
      confidence: "high" | "cwd";
      summary: Record<string, string | number | boolean | null>;
      metadata: {
        program: string;
        host: string;
        gpuCount?: number;
        codePath: string;
      };
    }>;
  };
};

export type ManagementState = {
  operatorName: string;
  sessions: Record<string, SessionManagement>;
  projects?: Array<{ host: string; cwd: string; name: string }>;
  hostRuntimeConfigs: Record<
    string,
    {
      preLaunchCommand: string;
      updatePreCommand?: string;
      yolo: boolean;
      residentSessionLimit?: number | null;
      updatedAt: string | null;
    }
  >;
  resourcePolicy: {
    prompt: string;
    updatedAt: string | null;
    version: number;
  };
};

export type Pane = {
  session: string;
  pane: string;
  command: string;
  cwd: string;
  tty: string;
  pid: number;
  activityAt: number | null;
  dead: boolean;
  exitStatus: number | null;
  preview: string;
};

export type LocalWorkload = {
  pid: number;
  ppid: number;
  pgid: number;
  sid: number;
  groupId: number;
  elapsedSeconds: number;
  tty: string;
  stat: string;
  command: string;
  cmdline: string;
  cwd: string;
  workerPids: number[];
  ancestorPids: number[];
  gpus: Array<{
    index: number | null;
    memoryMiB: number;
    pid: number;
  }>;
  gpuMemoryMiB: number;
  kind: "training" | "evaluation";
  pane: Pick<Pane, "session" | "pane" | "tty" | "cwd" | "command"> | null;
  ownerSessionId: string | null;
  ownerConfidence: "exact" | "strong" | "inferred" | "unmatched";
  ownerScore: number;
  ownerEvidence: string[];
};

export type CapacityRecovery = {
  kind?: "capacity" | "backend";
  status:
    | "scheduled"
    | "waiting"
    | "sending"
    | "sent"
    | "recovered"
    | "failed"
    | "exhausted";
  attempt: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  lastContinueAt: string | null;
};

export type RemoteDirectoryListing = {
  host: string;
  cwd: string;
  parent: string | null;
  directories: Array<{ name: string; path: string }>;
  truncated: boolean;
};

export type Agent = {
  id: string;
  host: string;
  hostname: string;
  pid: number;
  tty: string;
  cwd: string;
  executable: string;
  elapsedSeconds: number;
  status: "working" | "idle" | "attention";
  pane: Pane | null;
  rollout: Rollout | null;
  subagents: Rollout[];
  localWorkloads?: LocalWorkload[];
  remoteJobs?: SubmissionItem[];
  relatedPanes?: Pane[];
  historical?: boolean;
  appServerManaged?: boolean;
  transport?: "app-server";
  capacityRecovery?: CapacityRecovery | null;
  mapping: {
    rollout: "open-fd" | "unmatched" | "history" | "app-server";
    tmux: "tty" | "unmatched";
  };
  lastActivityAt: number | null;
  suggestedSummary: SessionSummary;
  title: string;
};

export type Gpu = {
  index: number;
  uuid?: string;
  name: string;
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
};

export type GpuUsageEpisode = {
  id: string;
  host: string;
  gpuIndex: number;
  gpuUuid: string;
  gpuName: string;
  pid: number;
  groupId: number;
  workerPids: number[];
  kind: "training" | "evaluation";
  command: string;
  cmdline: string;
  cwd: string;
  paneSession: string;
  pane: string;
  ownerSessionId: string | null;
  ownerConfidence: "exact" | "strong" | "inferred" | "unmatched";
  ownerEvidence: string[];
  sessionTheme: string;
  sessionCwd: string;
  sessionActive: boolean;
  startedAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  active: boolean;
  samples: number;
  lastMemoryMiB: number;
  maxMemoryMiB: number;
};

export type Host = {
  kind?: "local" | "ssh";
  defaultCwd?: string;
  alias: string;
  reachable: boolean;
  latencyMs: number;
  error: string | null;
  inventoryError?: string | null;
  inventoryUpdatedAt?: string | null;
  stale?: boolean;
  hostname: string | null;
  processes: unknown[];
  panes: Pane[];
  sessions: Rollout[];
  agents: Agent[];
  workloads?: LocalWorkload[];
  gpus: Gpu[];
};

export type SubmissionItem = {
  jobId: string;
  name: string;
  status: string;
  reason: string;
  message: string;
  duration: number | null;
  submittedAt: string;
  host: string;
  sessionId: string;
  sessionTheme: string;
  sessionObjective: string;
  cwd: string;
  rolloutPath: string;
  line: number;
  evidence: string;
  ownershipSource?: "tool-call" | "output-only";
  active: boolean;
  isSubagent?: boolean;
  parentThreadId?: string;
};

export type ResearchAssistantCandidate = {
  host: string;
  sessionId: string;
  sourceSessionId: string;
  parentThreadId: string;
  theme: string;
  objective: string;
  cwd: string;
  active: boolean;
  historical: boolean;
  lastActivityAt: number | null;
  score: number;
  coverage: number;
  matchedTerms: string[];
  evidence: Array<{
    kind: string;
    timestamp: string | null;
    text: string;
    terms: string[];
    sourceSessionId: string;
  }>;
  agent: Agent | null;
};

export type ResearchAssistantMessage = {
  scans?: { host: string; error: string | null; filesScanned: number; totalFiles: number; matches: number }[];
  id: string;
  role: "user" | "assistant";
  text: string;
  candidates?: ResearchAssistantCandidate[];
  model?: "codex" | "retrieval-only";
  warning?: string | null;
};

export type DlcCall = {
  id: string;
  timestamp: string;
  host: string;
  sessionId: string;
  sessionTheme: string;
  sessionObjective: string;
  cwd: string;
  rolloutPath: string;
  line: number;
  toolName: string;
  callId: string;
  invocationKind:
    "direct-shell" | "programmatic" | "submit-script" | "output-only";
  syntacticInvocations: number;
  observedInvocations: number;
  inspection: boolean;
  dryRun: boolean;
  explicitSubmit: boolean;
  outcome:
    | "pending"
    | "submitted"
    | "failed"
    | "unresolved"
    | "unknown"
    | "inspection"
    | "dry-run";
  exitCode: number | null;
  jobIds: string[];
  jobNames: string[];
  resultLine: number | null;
  resultEvidence: string;
  command: string;
  isSubagent: boolean;
  parentThreadId: string;
  active: boolean;
};

export type SubmissionTracker = {
  scannedAt: string | null;
  scanning: boolean;
  windowDays: number;
  targetHostname: string;
  items: SubmissionItem[];
  calls: DlcCall[];
  launches: Array<{
    kind: "dlc" | "scheduler" | "training";
    timestamp: string;
    host: string;
    sessionId: string;
    sessionObjective: string;
    cwd: string;
    command: string;
  }>;
  alerts: Array<{
    host: string;
    sessionId: string;
    sessionTheme: string;
    cwd: string;
    total: number;
    failed: number;
    queued: number;
    running: number;
  }>;
  hosts: Array<{
    host: string;
    filesScanned: number;
    totalFiles: number;
    submissions: number;
    calls: number;
    launches: number;
    error: string | null;
  }>;
  error: string | null;
};

export type PlanInputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{
    label: string;
    description: string;
  }> | null;
};

export type HumanRequestKind =
  | "user-input"
  | "command-approval"
  | "file-change-approval"
  | "permissions-approval"
  | "mcp-elicitation"
  | "legacy-command-approval"
  | "legacy-file-change-approval";

export type DecisionOption = {
  id: string;
  label: string;
  description: string;
  value: unknown;
  tone: "accept" | "persistent" | "danger";
};

export type ElicitationField = {
  name: string;
  title: string;
  description: string;
  type: "string" | "number" | "integer" | "boolean" | "array" | "unsupported";
  format: string | null;
  required: boolean;
  default: unknown;
  minimum: number | null;
  maximum: number | null;
  minLength: number | null;
  maxLength: number | null;
  minItems: number | null;
  maxItems: number | null;
  options: Array<{ value: unknown; label: string }> | null;
};

export type PendingHumanRequest = {
  key: string;
  kind: HumanRequestKind;
  method: string;
  title: string;
  host: string;
  requestId: string | number;
  threadId: string;
  turnId: string | null;
  itemId: string | null;
  receivedAt: string;
  expiresAt: string | null;
  status: "pending" | "responding" | "disconnected";
  error: string | null;
  questions?: PlanInputQuestion[];
  autoResolutionMs?: number | null;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  grantRoot?: string | null;
  networkApprovalContext?: unknown;
  commandActions?: unknown[];
  additionalPermissions?: unknown;
  permissions?: unknown;
  environmentId?: string | null;
  decisionOptions?: DecisionOption[];
  serverName?: string;
  mode?: string;
  message?: string;
  url?: string | null;
  elicitationId?: string | null;
  fields?: ElicitationField[] | null;
  renderable?: boolean;
  meta?: unknown;
  fileChanges?: Array<{
    path: string;
    type: string;
    preview: string;
    movePath: string | null;
  }>;
};

export type AppServerState = {
  experimental: boolean;
  connections: Array<{
    host: string;
    connectionKey?: string;
    status: "connecting" | "connected" | "offline";
    error: string | null;
    serverInfo: {
      userAgent: string;
      codexHome: string;
      platformFamily: string;
      platformOs: string;
    } | null;
    rateLimits?: AccountQuota | null;
    sessionIds: string[];
  }>;
  sessions: Array<{
    host: string;
    sessionId: string;
    path: string | null;
    cwd: string;
    model: string;
    effort?: string;
    yolo?: boolean;
    connectionKey?: string;
    status: "working" | "idle" | "attention" | "offline";
    resumeOnRecovery?: boolean;
    connectedAt: string;
    lastEventAt: string;
    capacityRecovery?: CapacityRecovery | null;
    profileAssignment?: ProfileAssignment | null;
    rateLimits?: AccountQuota | null;
  }>;
  pendingRequests: PendingHumanRequest[];
  pendingInputs: PendingHumanRequest[];
  restorePending?: Array<{
    host: string;
    sessionId: string;
    cwd: string;
    error: string | null;
    attempt: number;
    retryAt: string | null;
  }>;
};

export type InstructionAttachment = {
  localId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "file";
  status: "uploading" | "ready" | "error";
  token: string;
  remotePath: string;
  previewUrl: string;
  error: string;
};

export type ModelOption = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
};

export type PublicAccount = {
  type: "chatgpt" | "apiKey" | "amazonBedrock";
  email: string;
  planType: string;
} | null;

export type AuthProfile = {
  slug: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  account: PublicAccount;
  ready: boolean;
  active: boolean;
};

export type HostProfileQuotaEntry = {
  quota: AccountQuota | null;
  error: string | null;
};

export type HostQuotasResponse = {
  host: string;
  local: boolean;
  fetchedAt: string;
  currentAccount: PublicAccount | null;
  currentQuota: AccountQuota | null;
  profileQuotas: Record<string, HostProfileQuotaEntry>;
  error: string | null;
};

export type ClaudeAuthStatus = {
  installed: boolean;
  executable: string;
  loggedIn: boolean;
  email: string;
  authMethod: string;
  subscriptionType: string;
  planTier: string;
  orgName: string;
  loginExpiresAt: string;
  quota?: AccountQuota | null;
  quotaError?: string | null;
  error: string | null;
};

export type AntigravityAuthStatus = {
  installed: boolean;
  executable: string;
  loggedIn: boolean;
  email: string;
  authMethod: string;
  defaultModel: string;
  useG1Credits: boolean;
  quota?: AccountQuota | null;
  quotaError?: string | null;
  error: string | null;
};

export type ProviderAuthStatusesResponse = {
  host: string;
  local: boolean;
  fetchedAt: string;
  claude: ClaudeAuthStatus | null;
  antigravity: AntigravityAuthStatus | null;
};

export type AuthProfilesState = {
  host: string;
  local?: boolean;
  profiles: AuthProfile[];
  activeProfile: string | null;
  defaultAuthPresent: boolean;
  currentAccount: PublicAccount;
  runningSessions: number;
  restartJob?: AuthRestartJob | null;
  automaticFailover?: AuthProfileFailoverJob | null;
};

export type AuthProfileFailoverJob = {
  host: string;
  status:
    | "checking-profiles"
    | "waiting-for-turns"
    | "switching"
    | "completed"
    | "failed";
  failedProfile: string | null;
  targetProfile: string | null;
  interruptedSessions: string[];
  waitingForSessions: string[];
  attemptedProfiles: string[];
  nextAttemptAt: string | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
};

export type DeviceLoginJob = {
  id: string;
  host: string;
  profile: { name: string; slug: string };
  status: "starting" | "waiting" | "completed" | "failed" | "cancelled";
  verificationUrl: string;
  userCode: string;
  error: string | null;
  account: PublicAccount;
  startedAt: string;
  completedAt: string | null;
};

export type AuthRestartJob = {
  id: string;
  host: string;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  completed: number;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  results: Array<{
    sessionId: string;
    ok: boolean;
    skipped?: boolean;
    transport?: string;
    target?: string;
    error?: string;
  }>;
};

export type Snapshot = {
  generatedAt: string | null;
  scanning: boolean;
  sshConfig: string;
  error?: string;
  hosts: Host[];
  summary: {
    hosts: number;
    online: number;
    codex: number;
    tmux: number;
    attention: number;
  };
  management: ManagementState;
  appServer: AppServerState;
  submissionTracker: SubmissionTracker;
  gpuUsage: {
    updatedAt: string | null;
    retentionHours: number;
    episodes: GpuUsageEpisode[];
  };
  notifications?: {
    email: {
      enabled: boolean;
      configured: boolean;
      to: string[];
      provider: string;
      credentialSource: string | null;
      lastSentAt: string | null;
      lastError: string | null;
    };
  };
};

export type SnapshotSyncPayload = {
  protocol: number;
  epoch: string;
  revision: number;
  reset: boolean;
  overview?: Omit<Snapshot, "gpuUsage" | "submissionTracker">;
  gpuUsage?:
    | Snapshot["gpuUsage"]
    | {
        meta: Omit<Snapshot["gpuUsage"], "episodes">;
        upserts: GpuUsageEpisode[];
        removes: string[];
      };
  submissionTracker?: SubmissionTracker;
};

export type CachedSnapshotSync = {
  protocol: 1;
  epoch: string;
  revision: number;
  savedAt: number;
  snapshot: Snapshot;
};

export type Experiment = Pane & {
  id: string;
  host: string;
  hostname: string;
  status: "working" | "idle" | "attention";
  progress: string | null;
  eta: string | null;
  lastLine: string;
  gpus: Gpu[];
};

export type HistoryResult = {
  cached?: boolean;
  scope: string;
  scannedAt: string | null;
  sessions: Agent[];
  hosts: Array<{
    host: string;
    totalFiles: number;
    truncated: boolean;
    returned: number;
    error: string | null;
  }>;
};
