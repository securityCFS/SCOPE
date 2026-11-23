import { workingDirectory } from "./execution-host.js";
import { EFFORT_LABELS } from "./model-effort.js";
export const PROVIDERS = Object.freeze({
  codex: {
    name: "Codex",
    transport: "app-server",
    conversation: true,
    approvals: true,
    gpuIsolation: false,
  },
  claude: {
    name: "Claude Code",
    transport: "remote-cli",
    conversation: true,
    approvals: true,
    gpuIsolation: true,
  },
  antigravity: {
    name: "Antigravity",
    transport: "remote-cli",
    conversation: true,
    approvals: true,
    gpuIsolation: true,
  },
  dsh: {
    name: "DeepSeek Harness",
    transport: "remote-cli",
    conversation: false,
    approvals: false,
    gpuIsolation: true,
  },
});

export function defaultWorkbenchConfig() {
  return {
    version: 1,
    manager: { host: "", cwd: "", model: "", effort: "" },
    scheduler: {
      paused: false,
      maxRunning: 3,
      maxPerHost: 2,
      maxPerProject: 1,
      inventoryMaxAgeSeconds: 60,
      residentSessionsPerHost: 5,
      sessionIdleGraceMinutes: 15,
    },
    providers: {
      codex: {
        enabled: true,
        executable: "codex",
        preLaunchCommand: "",
        model: "",
      },
      claude: {
        enabled: false,
        executable: "claude",
        preLaunchCommand: "",
        model: "",
      },
      antigravity: {
        enabled: false,
        executable: "agy",
        preLaunchCommand: "",
        model: "",
      },
      dsh: {
        enabled: false,
        executable: "dsh",
        preLaunchCommand: "",
        model: "",
      },
    },
  };
}

function object(value, keys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${field} 必须是对象`);
  for (const key of Object.keys(value))
    if (!keys.includes(key))
      throw new Error(`${field}.${key} 不是支持的配置项`);
}
function string(value, field, max = 4000) {
  if (typeof value !== "string" || value.length > max || /\0/.test(value))
    throw new Error(`${field} 格式无效`);
  return value.trim();
}
export function remoteDirectory(value) {
  const cwd = string(value, "远端目录");
  if (!cwd.startsWith("/") || /[\r\n]/.test(cwd))
    throw new Error("请输入远端 Linux 绝对目录");
  return cwd.replace(/\/+$/, "") || "/";
}
export function validateWorkbenchConfig(value) {
  object(value, ["version", "manager", "scheduler", "providers"], "配置");
  if (value.version !== 1) throw new Error("不支持的配置版本");
  object(value.manager, ["host", "cwd", "model", "effort"], "manager");
  object(
    value.scheduler,
    [
      "paused",
      "maxRunning",
      "maxPerHost",
      "maxPerProject",
      "inventoryMaxAgeSeconds",
      "residentSessionsPerHost",
      "sessionIdleGraceMinutes",
    ],
    "scheduler",
  );
  object(value.providers, Object.keys(PROVIDERS), "providers");
  const config = structuredClone(value);
  const defaults = defaultWorkbenchConfig();
  // Version 1 installations predate Antigravity and resident session pooling; migrate defaults safely.
  if (!Object.hasOwn(config.providers, "antigravity"))
    config.providers.antigravity = defaults.providers.antigravity;
  if (!Object.hasOwn(config.scheduler, "residentSessionsPerHost"))
    config.scheduler.residentSessionsPerHost =
      defaults.scheduler.residentSessionsPerHost;
  if (!Object.hasOwn(config.scheduler, "sessionIdleGraceMinutes"))
    config.scheduler.sessionIdleGraceMinutes =
      defaults.scheduler.sessionIdleGraceMinutes;
  for (const key of ["host", "cwd", "model"])
    config.manager[key] = string(value.manager[key], `manager.${key}`);
  config.manager.effort = string(
    value.manager.effort ?? "",
    "manager.effort",
    40,
  );
  if (
    config.manager.effort &&
    !Object.hasOwn(EFFORT_LABELS, config.manager.effort)
  )
    throw new Error("推理强度无效");
  if (config.manager.cwd)
    config.manager.cwd = workingDirectory(
      config.manager.host,
      config.manager.cwd,
    );
  const schedulerBounds = {
    maxRunning: [1, 32],
    maxPerHost: [1, 32],
    maxPerProject: [1, 32],
    inventoryMaxAgeSeconds: [1, 300],
    residentSessionsPerHost: [0, 64],
    sessionIdleGraceMinutes: [1, 1440],
  };
  for (const [key, [min, max]] of Object.entries(schedulerBounds)) {
    const num = config.scheduler[key];
    if (!Number.isInteger(num) || num < min || num > max)
      throw new Error(`scheduler.${key} 超出允许范围`);
  }
  if (typeof value.scheduler.paused !== "boolean")
    throw new Error("scheduler.paused 必须是布尔值");
  for (const id of Object.keys(PROVIDERS)) {
    const provider = config.providers[id];
    object(
      provider,
      ["enabled", "executable", "preLaunchCommand", "model"],
      `providers.${id}`,
    );
    if (typeof provider.enabled !== "boolean")
      throw new Error(`${id}.enabled 必须是布尔值`);
    for (const key of ["executable", "preLaunchCommand", "model"])
      config.providers[id][key] = string(provider[key], `${id}.${key}`);
    if (!/^(?:[a-zA-Z0-9_.-]+|\/[^\r\n]+)$/.test(provider.executable))
      throw new Error(`${id} 需要一个可执行文件名或绝对路径`);
  }
  if (config.providers.dsh.model)
    throw new Error("DSH 模型由远端 headless profile 管理，请在远端配置");
  return config;
}
