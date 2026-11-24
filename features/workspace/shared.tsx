// Shared presentation helpers for the remote workspace.
import { MarkdownContent } from "@/components/markdown-body";
import type {
  Agent,
  CapacityRecovery,
  DialogueCategory,
  DialogueEvent,
  DlcCall,
  Experiment,
  GpuUsageEpisode,
  Host,
  LocalWorkload,
  ManagementState,
  Pane,
  Snapshot,
} from "@/features/workspace/types";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  CirclePause,
  Copy,
  Cpu,
  ExternalLink,
  Folder,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

export const MAX_INSTRUCTION_ATTACHMENTS = 8;

export const MAX_INSTRUCTION_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export const MAX_INSTRUCTION_ATTACHMENTS_TOTAL_BYTES = 100 * 1024 * 1024;

export const LOCAL_BRIDGE = "http://127.0.0.1:4815";

export const INSPECTOR_WIDTH_KEY = "scope:inspector-width";

export const DEFAULT_INSPECTOR_WIDTH = 470;

export const SESSION_RENDER_BATCH = 32;

export const DIALOGUE_RENDER_BATCH = 60;

export const MIN_INSPECTOR_WIDTH = 260;

export const MIN_SESSION_PANE_WIDTH = 220;

export const MAX_INSPECTOR_ARIA_WIDTH = 4096;

export const COLUMN_RESIZER_WIDTH = 7;

export function gpuKey(host: string, index: number) {
  return `${encodeURIComponent(host)}:${index}`;
}

export function parseGpuKey(value: string) {
  const match = value.match(/^(.*):(\d+)$/);
  if (!match) return null;
  return {
    host: decodeURIComponent(match[1]),
    index: Number(match[2]),
  };
}

export function bridgeUrl(path: string) {
  if (typeof window === "undefined") return `${LOCAL_BRIDGE}${path}`;
  const override = document
    .querySelector<HTMLMetaElement>('meta[name="scope-bridge-url"]')
    ?.content?.trim();
  if (override) {
    return override === "/scope-api"
      ? `/scope-api${path}`
      : `${override.replace(/\/+$/, "")}${path}`;
  }
  const hostname = window.location.hostname;
  const local =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  return local ? `${LOCAL_BRIDGE}${path}` : `/scope-api${path}`;
}

export function clampInspectorWidth(
  width: number,
  containerWidth: number,
  viewportWidth: number,
  hostSidebarCollapsed = false,
) {
  const hostWidth =
    viewportWidth <= 880
      ? 0
      : hostSidebarCollapsed
        ? 54
        : viewportWidth <= 1080
          ? 232
          : 248;
  const availableWidth =
    containerWidth - hostWidth - MIN_SESSION_PANE_WIDTH - COLUMN_RESIZER_WIDTH;
  const maximumWidth = Math.max(MIN_INSPECTOR_WIDTH, availableWidth);

  return Math.min(
    maximumWidth,
    Math.max(MIN_INSPECTOR_WIDTH, Math.round(width)),
  );
}

export const emptySnapshot: Snapshot = {
  generatedAt: null,
  scanning: true,
  sshConfig: "",
  hosts: [],
  summary: { hosts: 0, online: 0, codex: 0, tmux: 0, attention: 0 },
  management: {
    operatorName: "Operator",
    sessions: {},
    hostRuntimeConfigs: {},
    resourcePolicy: { prompt: "", updatedAt: null, version: 0 },
  },
  appServer: {
    experimental: true,
    connections: [],
    sessions: [],
    pendingRequests: [],
    pendingInputs: [],
  },
  submissionTracker: {
    scannedAt: null,
    scanning: false,
    windowDays: 1,
    targetHostname: "",
    items: [],
    calls: [],
    launches: [],
    alerts: [],
    hosts: [],
    error: null,
  },
  gpuUsage: {
    updatedAt: null,
    retentionHours: 168,
    episodes: [],
  },
  notifications: {
    email: {
      enabled: false,
      configured: false,
      to: [],
      provider: "",
      credentialSource: null,
      lastSentAt: null,
      lastError: null,
    },
  },
};

export const statusLabel = {
  working: "工作中",
  idle: "空闲",
  attention: "需检查",
};

export const categoryLabel = {
  research: "调研",
  training: "训练",
  evaluation: "评测",
  engineering: "工程",
  other: "其他",
};

export const dlcInvocationLabel: Record<DlcCall["invocationKind"], string> = {
  "direct-shell": "直接 CLI",
  programmatic: "程序化调用",
  "submit-script": "提交脚本入口",
  "output-only": "历史输出证据",
};

export const dlcOutcomeLabel: Record<DlcCall["outcome"], string> = {
  pending: "等待输出",
  submitted: "已返回 Job",
  failed: "调用失败",
  unresolved: "已开始但未解析",
  unknown: "未确认 Job",
  inspection: "仅查看帮助",
  "dry-run": "Dry run",
};

export const dialogueCategoryLabel: Record<DialogueCategory, string> = {
  dialogue: "纯对话",
  operations: "指令操作",
  reasoning: "思考过程",
  subagent: "Subagent",
};

export const priorityLabel = {
  P0: "P0 紧急",
  P1: "P1 高",
  P2: "P2 正常",
  P3: "P3 低",
  paused: "暂停",
};

export const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3, paused: 4 };

export function managementKey(agent: Agent) {
  return `${agent.host}:${agent.rollout?.id || `pid-${agent.pid}`}`;
}

export function managementRecord(agent: Agent, management: ManagementState) {
  return management?.sessions[managementKey(agent)] || {};
}

export function hostRuntimeConfig(management: ManagementState, host: string) {
  return (
    management.hostRuntimeConfigs?.[host] || {
      preLaunchCommand: "",
      updatePreCommand: "",
      yolo: true,
      residentSessionLimit: null,
      updatedAt: null,
    }
  );
}

export function rolloutUsesYolo(agent: Agent, management: ManagementState) {
  if (
    agent.rollout?.approvalPolicy === "never" &&
    ["danger-full-access", "dangerFullAccess"].includes(
      agent.rollout?.sandboxPolicy || "",
    )
  ) {
    return true;
  }
  if (agent.rollout?.approvalPolicy || agent.rollout?.sandboxPolicy) {
    return false;
  }
  return hostRuntimeConfig(management, agent.host).yolo;
}

export function resolvedSummary(agent: Agent, management: ManagementState) {
  const record = managementRecord(agent, management);
  const summary = record.summary ||
    agent.suggestedSummary || {
      theme: agent.title || agent.rollout?.firstUser || "新会话",
      category: "other" as const,
      objective: "",
      progress: "",
      result: "",
      nextStep: "",
      source: "rollout" as const,
      updatedAt: null,
    };
  if (!record.displayName) return summary;
  return {
    ...summary,
    theme: record.displayName,
    source: "manual" as const,
  };
}

export function relativeTime(value: number | string | null | undefined) {
  if (!value) return "暂无记录";
  const timestamp =
    typeof value === "number" ? value : new Date(value).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function capacityRecoveryLabel(recovery: CapacityRecovery) {
  const attempt = `${recovery.attempt}/${recovery.maxAttempts}`;
  const reason =
    recovery.kind === "backend" ? "Codex 服务暂时异常" : "模型临时繁忙";
  if (recovery.status === "scheduled") {
    const seconds = recovery.nextRetryAt
      ? Math.max(
          0,
          Math.ceil((Date.parse(recovery.nextRetryAt) - Date.now()) / 1_000),
        )
      : 0;
    return `${reason} · ${seconds} 秒后自动发送“继续” · ${attempt}`;
  }
  if (recovery.status === "waiting") {
    return `${reason} · 等待当前 Turn 空闲后自动继续 · ${attempt}`;
  }
  if (recovery.status === "sending") return `正在自动发送“继续” · ${attempt}`;
  if (recovery.status === "sent")
    return `已自动发送“继续” · 等待回复 · ${attempt}`;
  if (recovery.status === "recovered") return `已自动恢复 · ${attempt}`;
  if (recovery.status === "exhausted") return `自动继续已达上限 · ${attempt}`;
  return `自动继续失败 · ${attempt}`;
}

export function absoluteTime(value: number | string | null) {
  if (!value) return "未知";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

export function duration(seconds: number) {
  if (!Number.isFinite(seconds)) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.max(1, seconds)}s`;
}

export function gpuEpisodeDuration(episode: GpuUsageEpisode) {
  const start = Date.parse(episode.firstSeenAt);
  const end = Date.parse(
    episode.active ? episode.lastSeenAt : episode.endedAt || episode.lastSeenAt,
  );
  return duration(Math.max(1, Math.round((end - start) / 1_000)));
}

export function submissionStatusClass(status: string) {
  if (/fail|fault|stopp|cancel|kill/i.test(status || "")) return "failed";
  if (/queu|enqueued|pending/i.test(status || "")) return "queued";
  if (/running/i.test(status || "")) return "running";
  return "unknown";
}

export const workloadConfidenceLabel: Record<
  LocalWorkload["ownerConfidence"],
  string
> = {
  exact: "进程级精确",
  strong: "启动证据",
  inferred: "目录推断",
  unmatched: "未归属",
};

export function formatTimestamp(seconds?: number) {
  if (!seconds) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(seconds * 1000));
}

export function experimentMetrics(
  summary: Record<string, string | number | boolean | null>,
) {
  const preferred = [
    "_step",
    "step",
    "epoch",
    "loss",
    "train/loss",
    "val/loss",
    "accuracy",
    "success_rate",
  ];
  return Object.entries(summary)
    .sort(([a], [b]) => {
      const aIndex = preferred.indexOf(a);
      const bIndex = preferred.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    })
    .slice(0, 6);
}

export function pathName(value: string) {
  if (!value) return "未知目录";
  const parts = value.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) || value;
}

export function temporaryRemoteCwd(value: string) {
  return /^\/(?:tmp|var\/tmp)(?:\/|$)/.test(value);
}

export function recoveryCwdOptions(agent: Agent, hosts: Host[]) {
  const host = hosts.find((candidate) => candidate.alias === agent.host);
  if (!host) return [];
  const sourceName = pathName(agent.cwd);
  const projectHint = sourceName.split("-")[0].toLowerCase();
  const sourceTokens = new Set(
    sourceName
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((token) => token.length >= 3),
  );
  const candidates = Array.from(
    new Set([
      ...host.agents.map((candidate) => candidate.cwd),
      ...host.sessions.map((session) => session.cwd),
    ]),
  ).filter(
    (cwd): cwd is string =>
      Boolean(cwd) && cwd !== agent.cwd && !temporaryRemoteCwd(cwd),
  );
  const scored = candidates.map((cwd) => {
    const candidateName = pathName(cwd).toLowerCase();
    const candidateTokens = new Set(
      candidateName.split(/[^a-z0-9_]+/).filter((token) => token.length >= 3),
    );
    const commonTokens = [...sourceTokens].filter((token) =>
      candidateTokens.has(token),
    ).length;
    const exactProject = projectHint && candidateName === projectHint;
    const containsProject =
      projectHint && cwd.toLowerCase().includes(projectHint);
    return {
      cwd,
      score:
        (exactProject ? 100 : 0) +
        (containsProject ? 40 : 0) +
        commonTokens * 10,
    };
  });
  scored.sort(
    (left, right) =>
      right.score - left.score || left.cwd.length - right.cwd.length,
  );
  const relevant = scored.filter((candidate) => candidate.score > 0);
  if (!temporaryRemoteCwd(agent.cwd)) {
    relevant.unshift({ cwd: agent.cwd, score: Number.POSITIVE_INFINITY });
  }
  return Array.from(new Set(relevant.map((candidate) => candidate.cwd)));
}

export function compactText(value: string, fallback: string) {
  if (!value) return fallback;
  if (value.startsWith("<") && value.includes("_context>")) return fallback;
  return value;
}

export function sessionModelCatalogKey(
  host: string,
  sessionId: string,
  connectionKey?: string | null,
) {
  return `${host}::${sessionId}::${connectionKey || "active"}`;
}

export function displayCommandError(value: string) {
  const collect = (input: unknown): string[] => {
    if (typeof input === "string") return [input];
    if (Array.isArray(input)) return input.flatMap(collect);
    if (input && typeof input === "object") {
      const record = input as Record<string, unknown>;
      if (typeof record.text === "string") return [record.text];
      if ("content" in record) return collect(record.content);
      if ("output" in record) return collect(record.output);
    }
    return [];
  };
  try {
    const extracted = collect(JSON.parse(value));
    if (extracted.length) return extracted.join("\n").trim();
  } catch {
    // Older rollouts sometimes persist Python repr instead of JSON.
  }
  const pythonTexts = Array.from(
    value.matchAll(/['"]text['"]\s*:\s*'((?:\\.|[^'])*)'/g),
    (match) =>
      match[1]
        .replaceAll("\\n", "\n")
        .replaceAll("\\r", "")
        .replaceAll("\\t", "\t")
        .replaceAll("\\'", "'")
        .replaceAll("\\\\", "\\"),
  );
  return (pythonTexts.length ? pythonTexts.join("\n") : value).trim();
}

export function posixShellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function attachCommand(agent: Agent) {
  if (agent.pane) {
    return `ssh ${agent.host} -t "tmux attach -t ${agent.pane.session}"`;
  }
  return `ssh ${agent.host}`;
}

export function resumeInTmuxCommand(agent: Agent) {
  if (!agent.rollout?.id) return `ssh ${agent.host}`;
  const executable = agent.executable || "codex";
  const tmuxName = `scope-${agent.rollout.id.slice(0, 8)}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );
  const resumedCodex = [
    "exec",
    posixShellQuote(executable),
    "resume",
    posixShellQuote(agent.rollout.id),
  ].join(" ");
  const remoteCommand = [
    "tmux new-session -A",
    "-s",
    posixShellQuote(tmuxName),
    "-c",
    posixShellQuote(agent.cwd || "."),
    posixShellQuote(resumedCodex),
  ].join(" ");
  return `ssh ${agent.host} -t "${remoteCommand}"`;
}

export function RemoteWorkdirLink({
  host,
  cwd,
  className = "",
}: {
  host: string;
  cwd: string;
  className?: string;
}) {
  const displayPath = cwd || "未记录工作目录";

  async function openWorkspace() {
    if (!cwd) return;
    try {
      await requestVscodeOpen({ host, cwd });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "无法打开 VS Code");
    }
  }

  return (
    <button
      type="button"
      className={`remote-workdir-link ${className}`.trim()}
      title={`由本机 SCOPE Bridge 在 VS Code Remote SSH 中打开 ${host}:${displayPath}`}
      disabled={!cwd}
      onClick={(event) => {
        event.stopPropagation();
        void openWorkspace();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Folder size={13} />
      <code>{displayPath}</code>
      <ExternalLink size={12} />
    </button>
  );
}

export function dialogueTime(value: string | null) {
  if (!value) return "";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

export function dialoguePreview(event: DialogueEvent) {
  const value = event.command || event.text || event.output || "等待输出";
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

export async function requestVscodeOpen({
  host,
  cwd,
  file,
  line,
  column,
}: {
  host: string;
  cwd: string;
  file?: string;
  line?: number | null;
  column?: number | null;
}) {
  const response = await fetch(bridgeUrl("/api/vscode/open"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host, cwd, file, line, column }),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(result.error || `HTTP ${response.status}`);
  }
  return result;
}

export function RemoteMarkdownFileLink({
  host,
  cwd,
  remotePath,
  line,
  column,
  className = "",
  children,
}: {
  host: string;
  cwd: string;
  remotePath: string;
  line: number | null;
  column: number | null;
  className?: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<"idle" | "opening" | "error">("idle");
  const [error, setError] = useState("");

  async function openInVscode() {
    if (state === "opening") return;
    setState("opening");
    setError("");
    try {
      await requestVscodeOpen({ host, cwd, file: remotePath, line, column });
      setState("idle");
    } catch (openError) {
      setError(
        openError instanceof Error ? openError.message : "无法打开 VS Code",
      );
      setState("error");
    }
  }

  const title =
    state === "error"
      ? error
      : `点击后由本机 SCOPE Bridge 打开 VS Code Remote SSH 工作区 ${host}:${cwd}，再定位 ${remotePath}${line ? `:${line}${column ? `:${column}` : ""}` : ""}`;

  return (
    <button
      type="button"
      className={`remote-markdown-link ${state === "error" ? "has-error" : ""} ${className}`.trim()}
      title={title}
      aria-label={`${title}${state === "opening" ? "，正在打开" : ""}`}
      aria-busy={state === "opening"}
      onClick={(event) => {
        event.stopPropagation();
        void openInVscode();
      }}
    >
      <span>{children}</span>
      {state === "opening" ? (
        <LoaderCircle aria-hidden="true" size={11} className="is-spinning" />
      ) : state === "error" ? (
        <AlertTriangle aria-hidden="true" size={11} />
      ) : (
        <ExternalLink aria-hidden="true" size={11} />
      )}
    </button>
  );
}

export function MarkdownBody({
  value,
  className = "",
  remoteHost,
  remoteCwd,
}: {
  value: string;
  className?: string;
  remoteHost?: string;
  remoteCwd?: string;
}) {
  return (
    <MarkdownContent
      value={value}
      className={className}
      remoteHost={remoteHost}
      remoteCwd={remoteCwd}
      RemoteFileLink={RemoteMarkdownFileLink}
    />
  );
}

export function InspectorModule({
  title,
  meta,
  defaultOpen = false,
  className = "",
  children,
}: {
  title: string;
  meta?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className={`detail-section inspector-collapsible ${className}`.trim()}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="section-title-row collapsible-section-summary">
        <span className="detail-label">{title}</span>
        {meta && <span>{meta}</span>}
        <ChevronRight size={15} className="section-chevron" />
      </summary>
      {open && children}
    </details>
  );
}

export function resourcePrompt(agent: Agent, management: ManagementState) {
  const record = managementRecord(agent, management);
  const policy = management.resourcePolicy.prompt.trim();
  return [
    `[SCOPE 资源调度指令 v${management.resourcePolicy.version}]`,
    `本会话优先级：${record.priority || "P2"}。`,
    policy ? `全局资源策略：${policy}` : "全局资源策略：尚未填写。",
    "请先汇报当前运行中的训练/评测作业、占用的 GPU/CPU、可安全暂停点和预计完成时间。",
    "发生资源冲突时按上述优先级与策略安排；不要终止不属于本会话的进程。若需要抢占资源，先明确列出将暂停或终止的作业及影响。",
  ].join("\n");
}

export function paneAttachCommand(experiment: Experiment) {
  return `ssh ${experiment.host} -t "tmux attach -t ${experiment.session}"`;
}

export function relatedPaneAttachCommand(
  host: string,
  pane: Pick<Pane, "session">,
) {
  return `ssh ${host} -t "tmux attach -t ${pane.session}"`;
}

export function summarizePane(host: Host, pane: Pane): Experiment {
  const lines = pane.preview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const text = lines.slice(-20).join("\n");
  const errorPattern =
    /traceback|error:|failed|fatal|out of memory|killed|address already in use|nan\b/i;
  const completionPattern =
    /\bcomplete(?:d)?\b|finished|100(?:\.0+)?%|pane is dead|exit(?:ed)?\s+0/i;
  const progressMatches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
  const etaMatch = text.match(/\bETA[=: ]+([^\s,;]+)/i);
  const lastLine = lines.at(-1) || "尚未采集到终端输出";

  let status: Experiment["status"] = "working";
  if (pane.dead || completionPattern.test(text)) status = "idle";
  if ((pane.dead && pane.exitStatus !== 0) || errorPattern.test(text)) {
    status = "attention";
  }
  const gpuIndices = new Set(
    (host.workloads || [])
      .filter(
        (workload) =>
          workload.pane?.session === pane.session &&
          workload.pane?.pane === pane.pane,
      )
      .flatMap((workload) =>
        workload.gpus
          .map((gpu) => gpu.index)
          .filter((index): index is number => index !== null),
      ),
  );

  return {
    ...pane,
    id: `${host.alias}:${pane.session}:${pane.pane}`,
    host: host.alias,
    hostname: host.hostname || host.alias,
    status,
    progress: progressMatches.at(-1)?.[1]
      ? `${progressMatches.at(-1)?.[1]}%`
      : null,
    eta: etaMatch?.[1] || null,
    lastLine,
    gpus: host.gpus.filter((gpu) => gpuIndices.has(gpu.index)),
  };
}

export function ExperimentInspector({
  experiment,
  copied,
  terminating,
  onCopy,
  onTerminate,
}: {
  experiment: Experiment;
  copied: string;
  terminating: boolean;
  onCopy: (value: string, key: string) => void;
  onTerminate: (host: string, tmuxSession: string) => void;
}) {
  const command = paneAttachCommand(experiment);

  return (
    <>
      <div className="inspector-head">
        <div className={`large-state ${experiment.status}`}>
          {experiment.status === "working" ? (
            <Activity size={18} />
          ) : experiment.status === "attention" ? (
            <AlertTriangle size={18} />
          ) : (
            <CirclePause size={18} />
          )}
        </div>
        <div className="inspector-head-copy">
          <span>{statusLabel[experiment.status]}</span>
          <h2>{experiment.session}</h2>
          <small>{experiment.host}</small>
        </div>
        <div className="inspector-head-actions">
          <button
            type="button"
            className="inspector-terminate-action"
            disabled={terminating}
            onClick={() => onTerminate(experiment.host, experiment.session)}
            title={`精确终止 tmux ${experiment.session}；保留 Codex Session 日志`}
          >
            {terminating ? (
              <LoaderCircle size={14} className="is-spinning" />
            ) : (
              <Trash2 size={14} />
            )}
            终止 tmux
          </button>
        </div>
      </div>

      <div className="inspector-scroll">
        <InspectorModule
          key={`${experiment.id}:overview`}
          title="实验概览"
          defaultOpen
        >
          <div className="process-grid">
            <div>
              <span>进度</span>
              <strong>{experiment.progress || "实时"}</strong>
            </div>
            <div>
              <span>ETA</span>
              <strong>{experiment.eta || "—"}</strong>
            </div>
            <div>
              <span>PID</span>
              <strong>{experiment.pid}</strong>
            </div>
            <div>
              <span>状态</span>
              <strong>
                {experiment.dead
                  ? `退出 ${experiment.exitStatus ?? "?"}`
                  : experiment.command}
              </strong>
            </div>
          </div>
          <RemoteWorkdirLink
            className="cwd-row"
            host={experiment.host}
            cwd={experiment.cwd}
          />
        </InspectorModule>

        <InspectorModule
          key={`${experiment.id}:terminal`}
          title="实验终端实时尾部"
          meta={`tmux:${experiment.session} · ${experiment.pane}`}
          defaultOpen
        >
          <div className="terminal-preview experiment-terminal">
            <div className="terminal-preview-head">
              <span>
                <i />
                {experiment.host}
              </span>
              <span>只读采集</span>
            </div>
            <pre>{experiment.preview || "该 pane 暂无可见输出"}</pre>
          </div>
        </InspectorModule>

        <InspectorModule key={`${experiment.id}:attach`} title="进入实验终端">
          <div className="attach-command">
            <code>{command}</code>
            <button
              aria-label="复制实验连接命令"
              onClick={() => onCopy(command, "experiment-attach")}
            >
              {copied === "experiment-attach" ? (
                <Check size={14} />
              ) : (
                <Copy size={14} />
              )}
            </button>
          </div>
        </InspectorModule>

        {experiment.gpus.length > 0 && (
          <InspectorModule key={`${experiment.id}:gpu`} title="主机 GPU">
            <div className="gpu-list">
              {experiment.gpus.map((gpu) => (
                <div key={gpu.index}>
                  <span>
                    <Cpu size={13} /> GPU {gpu.index}
                  </span>
                  <strong>{gpu.utilization}%</strong>
                  <i>
                    <b style={{ width: `${gpu.utilization}%` }} />
                  </i>
                  <small>
                    {gpu.memoryUsed} / {gpu.memoryTotal} MiB
                  </small>
                </div>
              ))}
            </div>
          </InspectorModule>
        )}
      </div>
    </>
  );
}
