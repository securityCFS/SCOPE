import { readFileSync } from "node:fs";
import path from "node:path";

/** Machine-specific integrations are opt-in, outside the tracked repository. */
export function loadDeploymentProfile({
  env = process.env,
  filename = env.SCOPE_STATE_DIR
    ? path.resolve(env.SCOPE_STATE_DIR, "deployment.json")
    : path.resolve(".scope/deployment.json"),
} = {}) {
  let value = {};
  try {
    value = JSON.parse(readFileSync(filename, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(`Invalid deployment profile: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Deployment profile must be an object");
  const keys = [
    "taskQueue",
    "dlcHostname",
    "proxyBootstrapHosts",
    "emailTunnelHost",
  ];
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Unknown deployment profile field");
  if (value.taskQueue !== undefined && typeof value.taskQueue !== "boolean")
    throw new Error("taskQueue must be boolean");
  if (
    env.SCOPE_ENABLE_TASK_QUEUE !== undefined &&
    !["0", "1"].includes(env.SCOPE_ENABLE_TASK_QUEUE)
  )
    throw new Error("SCOPE_ENABLE_TASK_QUEUE must be 0 or 1");
  const host = (input) => {
    if (
      typeof input !== "string" ||
      (input && !/^[a-zA-Z0-9_][a-zA-Z0-9_.:@-]*$/.test(input))
    )
      throw new Error("Invalid host in deployment profile");
    return input;
  };
  const proxyHosts =
    env.SCOPE_PROXY_BOOTSTRAP_HOSTS !== undefined
      ? env.SCOPE_PROXY_BOOTSTRAP_HOSTS.split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : (value.proxyBootstrapHosts ?? []);
  if (!Array.isArray(proxyHosts))
    throw new Error("proxyBootstrapHosts must be an array");
  return {
    taskQueue:
      env.SCOPE_ENABLE_TASK_QUEUE !== undefined
        ? env.SCOPE_ENABLE_TASK_QUEUE === "1"
        : (value.taskQueue ?? false),
    dlcHostname: host(
      env.SCOPE_DLC_SSH_HOSTNAME?.trim() ?? value.dlcHostname ?? "",
    ),
    proxyBootstrapHosts: proxyHosts.map(host),
    emailTunnelHost: host(
      env.SCOPE_EMAIL_TUNNEL_HOST?.trim() ?? value.emailTunnelHost ?? "",
    ),
  };
}
