import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { LOCAL_HOST } from "../../lib/execution-host.js";
import { discoverRemotePorts } from "./probe.mjs";

const RESERVED_LOCAL_PORTS = new Set([3000, 4815, 4822, 4880]);
const MAX_AUTO_FORWARDS_PER_HOST = 8;

function validHostAlias(host) {
  return (
    typeof host === "string" &&
    host !== LOCAL_HOST &&
    /^[a-zA-Z0-9_][a-zA-Z0-9_.:@-]*$/.test(host)
  );
}

function validRemotePort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function validLocalPort(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65_535;
}

function forwardKey(host, remotePort) {
  return `${host}:${remotePort}`;
}

function defaultCheckLocalPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

function defaultPickEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        if (validLocalPort(port)) resolve(port);
        else reject(new Error("无法分配可用的本地监听端口"));
      });
    });
  });
}

function defaultProbeTcpListening(port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export class PortForwardManager {
  constructor({
    stateDir,
    getHost,
    runSsh,
    spawnProcess = spawn,
    sshBinary = process.platform === "win32" ? "ssh.exe" : "ssh",
    checkLocalPortFree = defaultCheckLocalPortFree,
    pickEphemeralPort = defaultPickEphemeralPort,
    probeTcpListening = defaultProbeTcpListening,
    discoverPorts = discoverRemotePorts,
  }) {
    this.stateDir = stateDir;
    this.configFile = path.join(stateDir, "port-forwards.json");
    this.getHost = getHost;
    this.runSsh = runSsh;
    this.spawnProcess = spawnProcess;
    this.sshBinary = sshBinary;
    this.checkLocalPortFree = checkLocalPortFree;
    this.pickEphemeralPort = pickEphemeralPort;
    this.probeTcpListening = probeTcpListening;
    this.discoverPorts = discoverPorts;

    /** @type {Set<string>} */
    this.autoForwardHosts = new Set();
    /** @type {Map<string, Set<number>>} */
    this.dismissedPorts = new Map();
    /** @type {Map<string, any>} */
    this.forwards = new Map();
    /** @type {Map<string, { ports: any[], scannedAt: string, error: string | null }>} */
    this.discoveryCache = new Map();
    /** @type {Map<string, Promise<any>>} */
    this.scanInFlight = new Map();

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
    this.autoForwardHosts.clear();
    if (Array.isArray(loaded?.autoForwardHosts)) {
      for (const host of loaded.autoForwardHosts) {
        if (validHostAlias(host)) this.autoForwardHosts.add(host);
      }
    }
    return this;
  }

  save() {
    const payload = {
      version: 1,
      autoForwardHosts: [...this.autoForwardHosts].sort(),
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

  #requireRemoteHost(host) {
    if (!validHostAlias(host)) {
      throw new Error("仅支持对远端 SSH 主机执行端口转发");
    }
    const candidate = this.getHost?.(host);
    if (!candidate) {
      throw new Error(`找不到 SSH 主机配置：${host}`);
    }
    return candidate;
  }

  #usedLocalPorts() {
    const used = new Set(RESERVED_LOCAL_PORTS);
    for (const entry of this.forwards.values()) {
      if (entry.status !== "stopped" && entry.localPort) {
        used.add(entry.localPort);
      }
    }
    return used;
  }

  async pickAvailableLocalPort(remotePort, preferredLocalPort = null) {
    const used = this.#usedLocalPorts();
    const candidates = [];
    if (validLocalPort(preferredLocalPort)) candidates.push(preferredLocalPort);
    if (validLocalPort(remotePort) && !candidates.includes(remotePort)) {
      candidates.push(remotePort);
    }
    const offsetCandidate =
      remotePort < 55_000 ? remotePort + 10_000 : remotePort - 10_000;
    if (validLocalPort(offsetCandidate) && !candidates.includes(offsetCandidate)) {
      candidates.push(offsetCandidate);
    }
    const base = validLocalPort(preferredLocalPort)
      ? preferredLocalPort
      : validLocalPort(remotePort)
        ? remotePort
        : 18_000;
    for (let step = 1; step <= 30; step += 1) {
      const next = base + step;
      if (validLocalPort(next) && !candidates.includes(next)) {
        candidates.push(next);
      }
    }
    for (const port of candidates) {
      if (used.has(port)) continue;
      if (await this.checkLocalPortFree(port)) return port;
    }
    return this.pickEphemeralPort();
  }

  publicForward(entry) {
    return {
      host: entry.host,
      remotePort: entry.remotePort,
      localPort: entry.localPort,
      localUrl: `http://127.0.0.1:${entry.localPort}`,
      status: entry.status,
      label: entry.label || `Port ${entry.remotePort}`,
      auto: Boolean(entry.auto),
      connectedAt: entry.connectedAt || null,
      lastError: entry.lastError || null,
    };
  }

  state(host = "") {
    if (!host) {
      const allForwards = [...this.forwards.values()]
        .filter((e) => e.status !== "stopped")
        .map((e) => this.publicForward(e))
        .sort((a, b) =>
          a.host === b.host
            ? a.remotePort - b.remotePort
            : a.host.localeCompare(b.host),
        );
      return {
        autoForwardHosts: [...this.autoForwardHosts].sort(),
        forwards: allForwards,
      };
    }
    const cached = this.discoveryCache.get(host) || {
      ports: [],
      scannedAt: null,
      error: null,
    };
    const hostForwards = [...this.forwards.values()]
      .filter((e) => e.host === host && e.status !== "stopped")
      .map((e) => this.publicForward(e))
      .sort((a, b) => a.remotePort - b.remotePort);
    return {
      host,
      autoForward: this.autoForwardHosts.has(host),
      discovered: cached.ports,
      forwards: hostForwards,
      scannedAt: cached.scannedAt,
      error: cached.error,
    };
  }

  async setAutoForward(host, enabled, { cwd = "" } = {}) {
    this.#requireRemoteHost(host);
    if (enabled) {
      this.autoForwardHosts.add(host);
      this.dismissedPorts.delete(host);
    } else {
      this.autoForwardHosts.delete(host);
    }
    await this.save();
    if (enabled) {
      await this.scan(host, { cwd, force: true });
    }
    return this.state(host);
  }

  async scan(host, { cwd = "", force = false } = {}) {
    this.#requireRemoteHost(host);
    const cached = this.discoveryCache.get(host);
    const ageMs = cached?.scannedAt
      ? Date.now() - Date.parse(cached.scannedAt)
      : Number.POSITIVE_INFINITY;
    if (!force && cached && ageMs < 4_000) {
      return this.state(host);
    }
    const pending = this.scanInFlight.get(host);
    if (pending) {
      await pending;
      return this.state(host);
    }
    const task = (async () => {
      try {
        const ports = await this.discoverPorts({
          host,
          cwd,
          run: this.runSsh,
        });
        this.discoveryCache.set(host, {
          ports,
          scannedAt: new Date().toISOString(),
          error: null,
        });
        await this.#reconcileAutoForwards(host, ports);
      } catch (error) {
        const prev = this.discoveryCache.get(host);
        this.discoveryCache.set(host, {
          ports: prev?.ports || [],
          scannedAt: new Date().toISOString(),
          error: error.message || "远端端口扫描失败",
        });
      } finally {
        this.scanInFlight.delete(host);
      }
    })();
    this.scanInFlight.set(host, task);
    await task;
    return this.state(host);
  }

  async #reconcileAutoForwards(host, discoveredPorts) {
    const activeSet = new Set(discoveredPorts.map((p) => p.port));
    // Reclaim auto-forwarded tunnels whose remote port stopped listening for 2 consecutive scans.
    for (const entry of [...this.forwards.values()]) {
      if (entry.host !== host || !entry.auto || entry.status === "stopped") {
        continue;
      }
      if (activeSet.has(entry.remotePort)) {
        entry.missedScans = 0;
      } else {
        entry.missedScans = (entry.missedScans || 0) + 1;
        if (entry.missedScans >= 2) {
          this.#stopEntry(entry);
          this.forwards.delete(forwardKey(entry.host, entry.remotePort));
        }
      }
    }
    if (!this.autoForwardHosts.has(host) || this.stopping) return;
    const dismissed = this.dismissedPorts.get(host) || new Set();
    let autoCount = [...this.forwards.values()].filter(
      (e) => e.host === host && e.auto && e.status !== "stopped",
    ).length;
    for (const item of discoveredPorts) {
      if (autoCount >= MAX_AUTO_FORWARDS_PER_HOST) break;
      if (dismissed.has(item.port)) continue;
      const key = forwardKey(host, item.port);
      const existing = this.forwards.get(key);
      if (existing && existing.status !== "stopped") continue;
      try {
        await this.forward({
          host,
          remotePort: item.port,
          label: item.label,
          auto: true,
        });
        autoCount += 1;
      } catch {
        /* ignore single port auto-forward errors */
      }
    }
  }

  async forward({
    host,
    remotePort,
    localPort = null,
    label = "",
    auto = false,
  }) {
    this.#requireRemoteHost(host);
    const parsedRemote = Number(remotePort);
    if (!validRemotePort(parsedRemote)) {
      throw new Error("远端端口必须是 1–65535 之间的整数");
    }
    const parsedLocal =
      localPort != null && localPort !== "" ? Number(localPort) : null;
    if (parsedLocal !== null && !validLocalPort(parsedLocal)) {
      throw new Error("本地端口必须是 1024–65535 之间的整数");
    }

    const key = forwardKey(host, parsedRemote);
    const dismissed = this.dismissedPorts.get(host);
    if (dismissed && !auto) dismissed.delete(parsedRemote);

    const existing = this.forwards.get(key);
    if (
      existing &&
      (existing.status === "connected" || existing.status === "connecting") &&
      existing.child
    ) {
      if (label && !existing.label) existing.label = label;
      return { alreadyActive: true, forward: this.publicForward(existing) };
    }
    if (existing) {
      this.#stopEntry(existing);
    }

    const chosenLocal = await this.pickAvailableLocalPort(
      parsedRemote,
      parsedLocal,
    );
    const discoveredMatch = this.discoveryCache
      .get(host)
      ?.ports?.find((p) => p.port === parsedRemote);
    const entry = {
      host,
      remotePort: parsedRemote,
      localPort: chosenLocal,
      label: label || discoveredMatch?.label || `Port ${parsedRemote}`,
      auto: Boolean(auto),
      status: "connecting",
      failures: 0,
      missedScans: 0,
      connectedAt: null,
      lastError: null,
      child: null,
      timer: null,
      manualStop: false,
    };
    this.forwards.set(key, entry);
    await this.#spawnForward(entry, { waitForReady: true });
    if (entry.status === "error" || entry.status === "stopped") {
      this.forwards.delete(key);
      throw new Error(entry.lastError || "SSH 端口转发启动失败");
    }
    return { alreadyActive: false, forward: this.publicForward(entry) };
  }

  async #spawnForward(entry, { waitForReady = false } = {}) {
    if (this.stopping || entry.manualStop) return;
    const startedAt = Date.now();
    entry.status = entry.failures > 0 ? "reconnecting" : "connecting";
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
          "-L",
          `127.0.0.1:${entry.localPort}:127.0.0.1:${entry.remotePort}`,
          "--",
          entry.host,
        ],
        { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
      );
    } catch (error) {
      entry.status = "error";
      entry.lastError = error.message;
      return;
    }

    entry.child = child;
    let stderr = "";
    let exitedEarly = false;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2_000);
    });
    child.on("error", (error) => {
      entry.lastError = error.message;
    });
    child.once("close", (code) => {
      exitedEarly = true;
      if (entry.child !== child) return;
      entry.child = null;
      if (this.stopping || entry.manualStop) {
        entry.status = "stopped";
        return;
      }
      const cleanErr = stderr.trim();
      entry.lastError = cleanErr || `SSH 转发退出（code ${code ?? 1}）`;
      if (entry.status === "connecting" && Date.now() - startedAt < 5_000) {
        entry.status = "error";
        return;
      }
      entry.failures =
        Date.now() - startedAt > 60_000 ? 0 : entry.failures + 1;
      if (entry.failures > 5) {
        entry.status = "error";
        return;
      }
      entry.status = "reconnecting";
      const delay = Math.min(30_000, 1_500 * 2 ** Math.min(entry.failures, 4));
      entry.timer = setTimeout(() => {
        entry.timer = null;
        void this.#spawnForward(entry, { waitForReady: false });
      }, delay);
      entry.timer.unref?.();
    });

    if (!waitForReady) {
      const healthyTimer = setTimeout(() => {
        if (entry.child === child && !this.stopping && !entry.manualStop) {
          entry.status = "connected";
          entry.connectedAt = new Date().toISOString();
          entry.lastError = null;
        }
      }, 1_200);
      healthyTimer.unref?.();
      return;
    }

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (exitedEarly || entry.child !== child || this.stopping) break;
      if (await this.probeTcpListening(entry.localPort, 220)) {
        entry.status = "connected";
        entry.connectedAt = new Date().toISOString();
        entry.lastError = null;
        return;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    if (!exitedEarly && entry.child === child && !this.stopping) {
      entry.status = "connected";
      entry.connectedAt = new Date().toISOString();
      entry.lastError = null;
    }
  }

  #stopEntry(entry) {
    entry.manualStop = true;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    const child = entry.child;
    entry.child = null;
    entry.status = "stopped";
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }

  stopForward(host, remotePort) {
    const parsedRemote = Number(remotePort);
    const key = forwardKey(host, parsedRemote);
    const entry = this.forwards.get(key);
    if (entry) {
      if (entry.auto) {
        let dismissed = this.dismissedPorts.get(host);
        if (!dismissed) {
          dismissed = new Set();
          this.dismissedPorts.set(host, dismissed);
        }
        dismissed.add(parsedRemote);
      }
      this.#stopEntry(entry);
      this.forwards.delete(key);
    }
    return this.state(host);
  }

  stop() {
    this.stopping = true;
    for (const entry of this.forwards.values()) {
      this.#stopEntry(entry);
    }
    this.forwards.clear();
  }
}
