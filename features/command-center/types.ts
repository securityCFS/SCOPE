import type { defaultWorkbenchConfig } from "@/lib/workbench-config";

export type Section = "manager" | "projects" | "resources" | "settings";
export type ProviderId = "codex" | "claude" | "antigravity" | "dsh";
export type WorkbenchConfig = ReturnType<typeof defaultWorkbenchConfig>;
export type TaskDraft = {
  provider: ProviderId;
  host: string;
  cwd: string;
  prompt: string;
  gpuCount: number;
  minMemoryMiB: number;
};
export type TaskRecord = TaskDraft & {
  id: string;
  kind: "task" | "manager";
  status: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  archiveError?: string | null;
  queueReason?: string;
  error?: string;
  note?: string;
  gpuIndices: number[];
  remote?: { sessionId?: string; remotePath?: string };
  result?: {
    activity?: import("@/features/workspace/types").DialogueEvent[];
    text?: string;
    stderr?: string;
    stdout?: string;
    remotePath?: string;
    truncated?: boolean;
  };
};
export type ManagerMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  taskId: string;
  createdAt: string;
};
export type WorkbenchState = {
  features?: { taskQueue: boolean };
  version: number;
  revision: number;
  configRevision: number;
  config: WorkbenchConfig;
  tasks: TaskRecord[];
  messages: ManagerMessage[];
  managerSession?: { sessionId: string } | null;
  error: string | null;
};

export const taskStatus: Record<string, string> = {
  queued: "排队中",
  starting: "正在启动",
  running: "执行中",
  waiting: "等待回应",
  unknown: "需要核实",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
  released: "占用已释放",
};
