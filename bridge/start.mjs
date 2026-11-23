import { spawn } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

const UI_PORT = 3000;
const BRIDGE_PORT = 4815;
const developmentMode = process.argv.includes("--dev");
const skipBuild = process.argv.includes("--skip-build");

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(800);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function isScopeBridge() {
  try {
    const healthResponse = await fetch(
      `http://127.0.0.1:${BRIDGE_PORT}/api/health`,
      {
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      if (health?.service === "scope-bridge") return true;
    }

    const response = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/snapshot`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const snapshot = await response.json();
    return (
      typeof snapshot?.sshConfig === "string" && Array.isArray(snapshot?.hosts)
    );
  } catch {
    return false;
  }
}

async function isScopeUi() {
  try {
    const response = await fetch(`http://127.0.0.1:${UI_PORT}/`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const html = await response.text();
    return html.includes("SCOPE") && (html.includes("跨项目 Agent 工作台") || html.includes("SSH Codex Monitor"));
  } catch {
    return false;
  }
}

const [uiPortOpen, bridgePortOpen] = await Promise.all([
  portIsOpen(UI_PORT),
  portIsOpen(BRIDGE_PORT),
]);

if (uiPortOpen || bridgePortOpen) {
  const [scopeUi, scopeBridge] = await Promise.all([
    uiPortOpen ? isScopeUi() : false,
    bridgePortOpen ? isScopeBridge() : false,
  ]);
  if (scopeUi && scopeBridge) {
    console.log(
      `SCOPE 已在运行：http://localhost:${UI_PORT}（Bridge ${BRIDGE_PORT}）`,
    );
    process.exit(0);
  }

  const occupied = [
    uiPortOpen ? UI_PORT : null,
    bridgePortOpen ? BRIDGE_PORT : null,
  ].filter(Boolean);
  console.error(
    `[scope] 无法启动：本机端口 ${occupied.join(", ")} 已被其他或不完整的服务占用。`,
  );
  process.exit(1);
}

const bridgeEntry = fileURLToPath(new URL("./server.mjs", import.meta.url));
const vinextEntry = fileURLToPath(
  new URL("../node_modules/vinext/dist/cli.js", import.meta.url),
);
const uiEntry = fileURLToPath(new URL("./ui-server.mjs", import.meta.url));

if (!developmentMode && !skipBuild) {
  console.log("[scope] Building the stable local UI...");
  const buildCode = await new Promise((resolve, reject) => {
    const build = spawn(process.execPath, [vinextEntry, "build"], {
      stdio: "inherit",
    });
    build.once("error", reject);
    build.once("exit", (code) => resolve(code ?? 1));
  });
  if (buildCode !== 0) {
    console.error(`[scope] UI build failed with exit code ${buildCode}`);
    process.exit(buildCode);
  }
}

const childSpecs = [
  { name: "Bridge", args: [bridgeEntry] },
  {
    name: "UI",
    args: developmentMode
      ? [
          vinextEntry,
          "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(UI_PORT),
        ]
      : [
          uiEntry,
          "--hostname",
          "127.0.0.1",
          "--port",
          String(UI_PORT),
        ],
  },
];
let stopping = false;
const children = new Set();
const restartAttempts = new Map();
const restartTimers = new Set();

function launchChild(spec) {
  if (stopping) return;
  const startedAt = Date.now();
  const child = spawn(process.execPath, spec.args, { stdio: "inherit" });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    const previousAttempts =
      Date.now() - startedAt >= 60_000
        ? 0
        : restartAttempts.get(spec.name) || 0;
    const attempts = previousAttempts + 1;
    restartAttempts.set(spec.name, attempts);
    if (attempts > 5) {
      console.error(
        `[scope] ${spec.name} 连续退出 ${attempts} 次；停止 SCOPE 以避免重启循环`,
      );
      stop(code ?? 1);
      return;
    }
    const delay = Math.min(10_000, 1_000 * 2 ** (attempts - 1));
    console.error(
      `[scope] ${spec.name} exited (${signal || `code ${code ?? 1}`}); ` +
        `${Math.round(delay / 1_000)} 秒后自动重启`,
    );
    const timer = setTimeout(() => {
      restartTimers.delete(timer);
      launchChild(spec);
    }, delay);
    restartTimers.add(timer);
  });
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  for (const timer of restartTimers) clearTimeout(timer);
  restartTimers.clear();
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(exitCode), 1_000);
}

for (const spec of childSpecs) launchChild(spec);

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
