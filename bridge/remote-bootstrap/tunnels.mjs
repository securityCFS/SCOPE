import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createAgentEmailRelayServer,
  loadOrCreateAgentEmailRelayState,
} from "../agent-email-relay.mjs";

const DEFAULT_LOCAL_RELAY_PORT = Number(
  process.env.SCOPE_AGENT_EMAIL_LOCAL_PORT || 4822,
);
const DEFAULT_REMOTE_RELAY_PORT = 4922;

function validHostAlias(host) {
  return (
    typeof host === "string" &&
    /^[a-zA-Z0-9_][a-zA-Z0-9_.:@-]*$/.test(host)
  );
}

function validPort(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65_535;
}

export class RemoteTunnelManager {
  constructor({
    stateDir,
    emailNotifier,
    legacyTunnelHost = "",
    localRelayPort = DEFAULT_LOCAL_RELAY_PORT,
    spawnProcess = spawn,
    sshBinary = process.platform === "win32" ? "ssh.exe" : "ssh",
    createRelayServer = createAgentEmailRelayServer,
  }) {
    this.stateDir = stateDir;
    this.configFile = path.join(stateDir, "remote-tunnels.json");
    this.relayStateFile = path.join(stateDir, "agent-email-relay.json");
    this.emailNotifier = emailNotifier;
    this.legacyTunnelHost = validHostAlias(legacyTunnelHost)
      ? legacyTunnelHost
      : "";
    this.localRelayPort = validPort(localRelayPort)
      ? localRelayPort
      : 4822;
    this.spawnProcess = spawnProcess;
    this.sshBinary = sshBinary;
    this.createRelayServer = createRelayServer;

    this.hosts = new Map();
    this.tunnels = new Map();
    this.relayState = null;
    this.relayServer = null;
    this.relayExternal = false;
    this.relayError = null;
    this.stopping = false;
    this.writes = Promise.resolve();
  }

  async load() {
    let loaded = null;
    try {
      loaded = JSON.parse(await readFile(this.configFile, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    this.hosts.clear();
    if (loaded?.hosts && typeof loaded.hosts === "object") {
      for (const [host, entry] of Object.entries(loaded.hosts)) {
        if (!validHostAlias(host)) continue;
        const remotePort = Number(entry?.remotePort) || DEFAULT_REMOTE_RELAY_PORT;
        this.hosts.set(host, {
          enabled: Boolean(entry?.enabled),
          remotePort: validPort(remotePort)
            ? remotePort
            : DEFAULT_REMOTE_RELAY_PORT,
          updatedAt: entry?.updatedAt || null,
        });
      }
    } else if (this.legacyTunnelHost) {
      this.hosts.set(this.legacyTunnelHost, {
        enabled: true,
        remotePort: DEFAULT_REMOTE_RELAY_PORT,
        updatedAt: new Date().toISOString(),
      });
    }
    return this;
  }

  save() {
    const payload = {
      version: 1,
      hosts: Object.fromEntries(this.hosts),
    };
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        await mkdir(this.stateDir, { recursive: true });
        const temporary = `${this.configFile}.tmp`;
        await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporary, this.configFile);
      });
    return this.writes;
  }

  async ensureRelay() {
    this.relayState = await loadOrCreateAgentEmailRelayState(
      this.relayStateFile,
      { localPort: this.localRelayPort },
    );
    if (this.relayServer || this.relayExternal || this.stopping) {
      return {
        token: this.relayState.token,
        localPort: this.localRelayPort,
      };
    }

    const server = this.createRelayServer({
      token: this.relayState.token,
      notifier: this.emailNotifier,
    });
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.localRelayPort, "127.0.0.1", resolve);
      });
      this.relayServer = server;
      this.relayError = null;
      this.relayExternal = false;
    } catch (error) {
      if (error?.code === "EADDRINUSE") {
        this.relayExternal = true;
        this.relayError = null;
      } else {
        this.relayError = error.message;
        throw error;
      }
    }
    return {
      token: this.relayState.token,
      localPort: this.localRelayPort,
    };
  }

  async start() {
    this.stopping = false;
    const anyEnabled = [...this.hosts.values()].some((item) => item.enabled);
    if (anyEnabled || existsSync(this.relayStateFile)) {
      await this.ensureRelay().catch((error) => {
        this.relayError = error.message;
      });
    }
    for (const [host, entry] of this.hosts) {
      if (entry.enabled) {
        this.#ensureTunnel(host, entry.remotePort);
      }
    }
  }

  async enable(host, remotePort = DEFAULT_REMOTE_RELAY_PORT) {
    if (!validHostAlias(host)) throw new Error("SSH 主机名无效");
    const port = Number(remotePort) || DEFAULT_REMOTE_RELAY_PORT;
    if (!validPort(port)) throw new Error("远端转发端口必须在 1024 到 65535 之间");
    const relay = await this.ensureRelay();
    const previous = this.hosts.get(host);
    this.hosts.set(host, {
      enabled: true,
      remotePort: port,
      updatedAt: new Date().toISOString(),
    });
    await this.save();
    if (!previous?.enabled || previous.remotePort !== port) {
      this.#stopTunnel(host);
    }
    this.#ensureTunnel(host, port);
    return relay;
  }

  async disable(host) {
    this.#stopTunnel(host);
    if (this.hosts.has(host)) {
      const entry = this.hosts.get(host);
      this.hosts.set(host, {
        ...entry,
        enabled: false,
        updatedAt: new Date().toISOString(),
      });
      await this.save();
    }
  }

  #ensureTunnel(host, remotePort) {
    if (this.stopping) return;
    const existing = this.tunnels.get(host);
    if (existing && (existing.child || existing.timer)) return;
    const state = existing || {
      host,
      remotePort,
      status: "connecting",
      failures: 0,
      lastError: null,
      connectedAt: null,
      child: null,
      timer: null,
    };
    // A stopped runtime entry survives a configuration change. Reconnect with
    // the newly saved port rather than the previous entry's forwarding target.
    state.remotePort = remotePort;
    this.tunnels.set(host, state);
    this.#connectTunnel(state);
  }

  #connectTunnel(state) {
    if (this.stopping) return;
    const entry = this.hosts.get(state.host);
    if (!entry?.enabled) return;
    const startedAt = Date.now();
    state.status = state.failures > 0 ? "reconnecting" : "connecting";
    let child;
    try {
      child = this.spawnProcess(
        this.sshBinary,
        [
          "-NT",
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          "ConnectTimeout=10",
          "-o",
          "ExitOnForwardFailure=yes",
          "-o",
          "ServerAliveInterval=30",
          "-o",
          "ServerAliveCountMax=3",
          "-R",
          `127.0.0.1:${state.remotePort}:127.0.0.1:${this.localRelayPort}`,
          "--",
          state.host,
        ],
        { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
      );
    } catch (error) {
      state.status = "error";
      state.lastError = error.message;
      return;
    }

    state.child = child;
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2_000);
    });
    const healthyTimer = setTimeout(() => {
      if (state.child === child && !this.stopping) {
        state.status = "connected";
        state.connectedAt = new Date().toISOString();
        state.lastError = null;
      }
    }, 1_500);
    healthyTimer.unref?.();

    child.on("error", (error) => {
      state.lastError = error.message;
    });
    child.once("close", (code) => {
      clearTimeout(healthyTimer);
      if (state.child !== child) return;
      state.child = null;
      if (this.stopping || !this.hosts.get(state.host)?.enabled) {
        state.status = "stopped";
        return;
      }
      state.failures = Date.now() - startedAt > 60_000 ? 0 : state.failures + 1;
      const cleanErr = stderr.trim();
      state.lastError = cleanErr || `SSH 隧道退出（code ${code ?? 1}）`;
      state.status = "reconnecting";
      const delay = Math.min(60_000, 1_000 * 2 ** Math.min(state.failures, 6));
      state.timer = setTimeout(() => {
        state.timer = null;
        this.#connectTunnel(state);
      }, delay);
      state.timer.unref?.();
    });
  }

  #stopTunnel(host) {
    const state = this.tunnels.get(host);
    if (!state) return;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const child = state.child;
    state.child = null;
    state.status = "stopped";
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }

  hostStatus(host) {
    const config = this.hosts.get(host);
    const runtime = this.tunnels.get(host);
    return {
      enabled: Boolean(config?.enabled),
      remotePort: config?.remotePort || DEFAULT_REMOTE_RELAY_PORT,
      status: !config?.enabled
        ? "disabled"
        : runtime?.status || "stopped",
      connectedAt: runtime?.connectedAt || null,
      lastError: runtime?.lastError || null,
    };
  }

  status(host = "") {
    return {
      relayListening: Boolean(this.relayServer) || this.relayExternal,
      relayExternal: this.relayExternal,
      relayPort: this.localRelayPort,
      relayError: this.relayError,
      relayTokenReady: Boolean(this.relayState?.token || existsSync(this.relayStateFile)),
      ...(host ? { host: this.hostStatus(host) } : {}),
    };
  }

  stop() {
    this.stopping = true;
    for (const host of this.tunnels.keys()) {
      this.#stopTunnel(host);
    }
    if (this.relayServer) {
      this.relayServer.closeAllConnections?.();
      this.relayServer.close();
      this.relayServer = null;
    }
  }
}
