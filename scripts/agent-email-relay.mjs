import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentEmailRelayServer,
  loadOrCreateAgentEmailRelayState,
} from "../bridge/agent-email-relay.mjs";
import { createEmailNotifier } from "../bridge/email-notifier.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDirectory = path.join(repoRoot, ".scope");
const relayStatePath = path.join(stateDirectory, "agent-email-relay.json");
const logPath = path.join(stateDirectory, "agent-email-relay.log");
const localHost = "127.0.0.1";
const localPort = Number(process.env.SCOPE_AGENT_EMAIL_LOCAL_PORT || 4822);
const remotePort = Number(process.env.SCOPE_AGENT_EMAIL_REMOTE_PORT || 4922);
const remoteHost = process.env.SCOPE_AGENT_EMAIL_REMOTE_HOST || "";

await mkdir(stateDirectory, { recursive: true });
const relayState = await loadOrCreateAgentEmailRelayState(relayStatePath, {
  remoteHost,
  localPort,
  remotePort,
});
const notifier = await createEmailNotifier({
  configPath: path.join(stateDirectory, "email-notifications.json"),
  statePath: path.join(stateDirectory, "agent-email-notification-state.json"),
});
if (!notifier.publicState().configured) {
  throw new Error(notifier.publicState().lastError || "SCOPE email is not configured");
}

const server = createAgentEmailRelayServer({ token: relayState.token, notifier });
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(localPort, localHost, resolve);
});
console.log(`[scope-agent-email] relay listening on http://${localHost}:${localPort}`);
if (remoteHost) {
  console.log(`[scope-agent-email] forwarding ${remoteHost}:127.0.0.1:${remotePort}`);
} else {
  console.log("[scope-agent-email] running local relay without standalone SSH tunnel (use SCOPE Web UI or SCOPE_AGENT_EMAIL_REMOTE_HOST to forward hosts)");
}

let stopping = false;
let tunnel = null;
let retryTimer = null;
let failures = 0;

async function log(message) {
  const line = `${new Date().toISOString()} ${String(message).trim()}\n`;
  await appendFile(logPath, line, "utf8").catch(() => {});
}

function launchTunnel() {
  if (stopping) return;
  const startedAt = Date.now();
  tunnel = spawn(
    "ssh",
    [
      "-N",
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      "-R",
      `127.0.0.1:${remotePort}:127.0.0.1:${localPort}`,
      remoteHost,
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );
  tunnel.stderr.setEncoding("utf8");
  tunnel.stderr.on("data", (chunk) => log(chunk));
  tunnel.once("error", (error) => log(`ssh error: ${error.message}`));
  tunnel.once("exit", (code, signal) => {
    tunnel = null;
    if (stopping) return;
    failures = Date.now() - startedAt > 60_000 ? 0 : failures + 1;
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6));
    log(`ssh exited (${signal || `code ${code ?? 1}`}); retry in ${delay}ms`);
    retryTimer = setTimeout(launchTunnel, delay);
  });
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (retryTimer) clearTimeout(retryTimer);
  if (tunnel && !tunnel.killed) tunnel.kill("SIGTERM");
  server.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 1_500).unref();
}

if (remoteHost) {
  launchTunnel();
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
