#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "start";
const rest = argv[0] && !argv[0].startsWith("-") ? argv.slice(1) : argv;

function printHelp() {
  console.log(`SCOPE — One monitor for all agent sessions (v${pkg.version})
Zero telemetry, zero cloud relay, 100% self-hosted on 127.0.0.1.

Usage:
  scope [start] [options]                    Start Web UI + Bridge (optionally + Private Gateway)
  scope gateway [options]                    Start standalone Private Access Gateway (127.0.0.1:4820)
  scope token [--show] [--rotate] [--url U]  Inspect/rotate the gateway token; --url prints a single-use login URL
  scope devices [list | revoke <id|--all>]   List or revoke trusted mobile/browser devices
  scope expose tailscale [options]           Expose Private Gateway privately over Tailscale Serve
  scope expose cloudflare --domain <fqdn> [--port-domain <fqdn>] [--share-domain <fqdn>]
                                             Configure Cloudflare Named Tunnel (+ Access & WAF checklist)
  scope service <install|status|restart|uninstall> [options]
                                             Manage Linux systemd --user persistent services
  scope preview [--en]                       Launch isolated zero-SSH preview mode
  scope bootstrap <action> <host|@local>     Run remote inspect / deploy / sync-protocol / remove
  scope plugin <subcommand> [args...]        Inspect, install, call, or remove SCOPE plugins
  scope --version                            Print version
  scope --help                               Show this help

Start options:
  --port <port>          Web UI port (default: 3000, env: SCOPE_UI_PORT)
  --bridge-port <port>   Bridge API port (default: 4815, env: SCOPE_BRIDGE_PORT)
  --gateway              Also start Private Access Gateway (127.0.0.1:4820) under one supervisor
  --gateway-port <port>  Private Gateway port (default: 4820, env: SCOPE_PRIVATE_PORT)
  --port-origin <url>    Serve forwarded ports from an isolated origin, e.g. https://scope-ports.example.com (env: SCOPE_PORT_ORIGIN)
  --share-origin <url>   Serve opt-in public read-only static doc shares from an isolated origin, e.g. https://share.example.com (env: SCOPE_SHARE_ORIGIN)
  --state-dir <dir>      State directory (default: ./.scope in repo or ~/.scope globally)
  --skip-build           Use prebuilt UI bundle without rebuilding
  --build                Force rebuild UI before starting (source checkout only)
  --dev                  Start Vite/vinext development server (source checkout only)

Quick Remote Access Examples:
  scope start --gateway && scope expose tailscale
  scope expose cloudflare --domain scope.yourdomain.com --dry-run
  scope service install --with-gateway --with-cloudflared --tunnel scope-hub

Docs: https://github.com/securityCFS/SCOPE/blob/main/docs/remote-access.md`);
}

if (argv.includes("--version") || argv.includes("-v")) {
  console.log(`${pkg.name} v${pkg.version}`);
  process.exit(0);
}

if (argv.includes("--help") || argv.includes("-h") || command === "help") {
  printHelp();
  process.exit(0);
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
}

function runScript(relativeScript, args, extraEnv = {}) {
  const target = path.join(packageRoot, relativeScript);
  const child = spawn(process.execPath, [target, ...args], {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      if (!child.killed) child.kill(sig);
    });
  }
}

function defaultStateDir(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.SCOPE_STATE_DIR) return path.resolve(process.env.SCOPE_STATE_DIR);
  const cwdScope = path.resolve(process.cwd(), ".scope");
  if (existsSync(cwdScope) || path.resolve(process.cwd()) === path.resolve(packageRoot)) {
    return cwdScope;
  }
  return path.join(os.homedir(), ".scope");
}

if (command === "start") {
  const uiPort = readFlag(rest, "--port");
  const bridgePort = readFlag(rest, "--bridge-port");
  const gatewayPort = readFlag(rest, "--gateway-port");
  const portOrigin = readFlag(rest, "--port-origin");
  const shareOrigin = readFlag(rest, "--share-origin");
  const withGateway = rest.includes("--gateway") || rest.includes("--private-gateway");
  const stateDir = defaultStateDir(readFlag(rest, "--state-dir"));
  const forwardArgs = [];
  if (rest.includes("--dev")) forwardArgs.push("--dev");
  if (rest.includes("--skip-build")) forwardArgs.push("--skip-build");
  if (rest.includes("--build")) forwardArgs.push("--build");
  if (withGateway) forwardArgs.push("--gateway");
  const prebuiltReady = existsSync(path.join(packageRoot, "dist", "server", "index.js"));
  if (prebuiltReady && !forwardArgs.includes("--dev") && !forwardArgs.includes("--build") && !forwardArgs.includes("--skip-build")) {
    forwardArgs.push("--skip-build");
  }
  runScript("bridge/start.mjs", forwardArgs, {
    SCOPE_STATE_DIR: stateDir,
    ...(uiPort ? { SCOPE_UI_PORT: uiPort } : {}),
    ...(bridgePort ? { SCOPE_BRIDGE_PORT: bridgePort } : {}),
    ...(gatewayPort ? { SCOPE_PRIVATE_PORT: gatewayPort } : {}),
    ...(portOrigin ? { SCOPE_PORT_ORIGIN: portOrigin } : {}),
    ...(shareOrigin ? { SCOPE_SHARE_ORIGIN: shareOrigin } : {}),
    ...(withGateway ? { SCOPE_WITH_GATEWAY: "1" } : {}),
  });
} else if (command === "gateway") {
  const gatewayPort = readFlag(rest, "--port") || readFlag(rest, "--gateway-port");
  const uiPort = readFlag(rest, "--ui-port");
  const bridgePort = readFlag(rest, "--bridge-port");
  const portOrigin = readFlag(rest, "--port-origin");
  const shareOrigin = readFlag(rest, "--share-origin");
  const stateDir = defaultStateDir(readFlag(rest, "--state-dir"));
  runScript("bridge/private-start.mjs", [], {
    SCOPE_STATE_DIR: stateDir,
    ...(gatewayPort ? { SCOPE_PRIVATE_PORT: gatewayPort } : {}),
    ...(uiPort ? { SCOPE_UI_PORT: uiPort } : {}),
    ...(bridgePort ? { SCOPE_BRIDGE_PORT: bridgePort } : {}),
    ...(portOrigin ? { SCOPE_PORT_ORIGIN: portOrigin } : {}),
    ...(shareOrigin ? { SCOPE_SHARE_ORIGIN: shareOrigin } : {}),
  });
} else if (command === "token" || command === "devices" || command === "expose" || command === "service") {
  const stateDir = defaultStateDir(readFlag(rest, "--state-dir"));
  runScript("scripts/remote-expose-cli.mjs", [command, ...rest], {
    SCOPE_STATE_DIR: stateDir,
  });
} else if (command === "preview") {
  const isEn = rest.includes("--en") || rest.includes("--english");
  runScript("scripts/preview-workbench.mjs", [], isEn ? { SCOPE_PREVIEW_LOCALE: "en" } : {});
} else if (command === "bootstrap") {
  runScript("scripts/remote-bootstrap-cli.mjs", rest, {
    SCOPE_STATE_DIR: defaultStateDir(null),
  });
} else if (command === "plugin") {
  runScript("scripts/plugin-cli.mjs", rest, {
    SCOPE_STATE_DIR: defaultStateDir(null),
  });
} else {
  console.error(`[scope] Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
