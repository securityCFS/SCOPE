import { PROVIDERS } from "../../lib/workbench-config.js";
import { LOCAL_HOST, workingDirectory } from "../../lib/execution-host.js";
import { normalizeTurnAttachments } from "../session-attachments.mjs";

export const HELD_STATES = new Set([
  "starting",
  "running",
  "waiting",
  "unknown",
]);
export function validateTask(value) {
  if (!value || typeof value !== "object") throw new Error("任务不能为空");
  const text = (key, max) => {
    if (
      typeof value[key] !== "string" ||
      !value[key].trim() ||
      value[key].length > max ||
      value[key].includes("\0")
    )
      throw new Error(`${key} 格式无效`);
    return value[key].trim();
  };
  const provider = text("provider", 20);
  const host = text("host", 200);
  if (host === LOCAL_HOST && provider !== "codex") throw new Error("本机目前支持 Codex；其他 Agent 请选择远端设备");
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error("未知 Agent 类型");
  const attachments = normalizeTurnAttachments(value.attachments);
  let prompt;
  if (attachments.length > 0) {
    if (
      typeof value.prompt !== "string" ||
      value.prompt.length > 16000 ||
      value.prompt.includes("\0")
    )
      throw new Error("prompt 格式无效");
    prompt = value.prompt.trim();
  } else {
    prompt = text("prompt", 16000);
  }
  const gpuCount = value.gpuCount ?? 0;
  const minMemoryMiB = value.minMemoryMiB ?? 0;
  if (
    !Number.isInteger(gpuCount) ||
    gpuCount < 0 ||
    gpuCount > 16 ||
    !Number.isInteger(minMemoryMiB) ||
    minMemoryMiB < 0 ||
    minMemoryMiB > 1_000_000
  )
    throw new Error("GPU 需求格式无效");
  if (gpuCount && !PROVIDERS[provider].gpuIsolation)
    throw new Error(
      "Codex 共用 app-server 暂不支持逐任务 GPU 环境隔离，请通过资源视图分配或选择 CLI Agent",
    );
  return {
    provider,
    host,
    cwd: workingDirectory(host, value.cwd),
    prompt,
    ...(attachments.length ? { attachments } : {}),
    gpuCount,
    minMemoryMiB,
  };
}

export function placement(task, state, snapshot, now = Date.now()) {
  const policy = state.config.scheduler;
  if (policy.paused) return { reason: "调度已暂停" };
  if (!state.config.providers[task.provider]?.enabled)
    return { reason: "此 Agent 尚未启用" };
  const host = snapshot.hosts.find((h) => h.alias === task.host);
  if (!host?.reachable) return { reason: "等待主机上线" };
  const active = state.tasks.filter((t) => HELD_STATES.has(t.status));
  if (active.length >= policy.maxRunning) return { reason: "等待全局空位" };
  if (active.filter((t) => t.host === task.host).length >= policy.maxPerHost)
    return { reason: "等待主机空位" };
  if (
    active.filter((t) => t.host === task.host && t.cwd === task.cwd).length >=
    policy.maxPerProject
  )
    return { reason: "该项目已有任务，等待工作目录空闲" };
  if (task.kind === "manager" && active.some((t) => t.kind === "manager"))
    return { reason: "总调度正在回答上一条消息" };
  const managedIds = new Set(
    active.map((t) => t.remote?.sessionId).filter(Boolean),
  );
  if (
    task.kind !== "manager" &&
    (host.agents || []).some(
      (agent) =>
        agent.cwd === task.cwd &&
        ["working", "attention"].includes(agent.status) &&
        !managedIds.has(agent.rollout?.id),
    )
  )
    return { reason: "该目录有工作台之外的活动会话，等待其结束" };
  if (!task.gpuCount) return { host, gpuIndices: [] };
  const inventoryTime = Date.parse(
    host.inventoryUpdatedAt || snapshot.generatedAt || "",
  );
  if (
    host.stale ||
    host.inventoryError ||
    !Number.isFinite(inventoryTime) ||
    now - inventoryTime > policy.inventoryMaxAgeSeconds * 1000
  )
    return { reason: "等待新鲜的 GPU 数据" };
  const reserved = new Set(
    active
      .filter((t) => t.host === task.host)
      .flatMap((t) => t.gpuIndices || []),
  );
  const available = (host.gpus || [])
    .filter(
      (g) =>
        !reserved.has(g.index) &&
        Number.isFinite(g.memoryTotal) &&
        Number.isFinite(g.memoryUsed) &&
        g.memoryTotal - g.memoryUsed >= task.minMemoryMiB &&
        g.utilization <= 10,
    )
    .sort(
      (a, b) => b.memoryTotal - b.memoryUsed - (a.memoryTotal - a.memoryUsed),
    );
  if (available.length < task.gpuCount)
    return { reason: "等待满足显存要求的空闲 GPU" };
  return {
    host,
    gpuIndices: available.slice(0, task.gpuCount).map((g) => g.index),
  };
}
