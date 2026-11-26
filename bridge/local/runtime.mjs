import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { LOCAL_HOST } from "../../lib/execution-host.js";
import { LocalJsonlChild } from "./transport.mjs";
import { resolveCodexExecutable } from "./executable.mjs";
export { resolveCodexExecutable } from "./executable.mjs";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function ready(url) {
  try {
    return (
      await fetch(url.replace("ws:", "http:") + "/readyz", {
        signal: AbortSignal.timeout(700),
      })
    ).ok;
  } catch {
    return false;
  }
}

export class LocalCodexRuntime {
  constructor(
    stateDir,
    { defaultCwd = process.cwd(), executable = resolveCodexExecutable() } = {},
  ) {
    this.directory = path.join(stateDir, "local-codex");
    this.executable = executable;
    this.defaultCwd = defaultCwd;
  }
  host() {
    return {
      alias: LOCAL_HOST,
      label: "本机",
      kind: "local",
      defaultCwd: this.defaultCwd,
      reachable: !!this.executable,
      nativeCliSupported: process.platform !== "win32",
      hostname: os.hostname(),
      latencyMs: 0,
      error: this.executable
        ? null
        : "未找到本机 Codex，请安装 CLI 或设置 SCOPE_LOCAL_CODEX 为可执行文件路径",
      processes: [],
      panes: [],
      sessions: [],
      agents: [],
      gpus: [],
      stale: false,
      inventoryUpdatedAt: new Date().toISOString(),
    };
  }
  probe() {
    if (!this.executable) throw new Error(this.host().error);
    return spawn(this.executable, ["app-server", "--listen", "stdio://"], {
      cwd: this.defaultCwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  connect() {
    return new LocalJsonlChild(() => this.endpoint());
  }
  async endpoint() {
    if (!this.executable) throw new Error(this.host().error);
    if (this.starting) return this.starting;
    this.starting = this.ensureEndpoint().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  async ensureEndpoint() {
    await mkdir(this.directory, { recursive: true });
    const lock = path.join(this.directory, "startup.lock");
    let handle;
    for (let i = 0; i < 100; i++) {
      try {
        handle = await open(lock, "wx", 0o600);
        await handle.writeFile(String(process.pid));
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const owner = Number(await readFile(lock, "utf8").catch(() => ""));
        if (owner && !alive(owner)) await unlink(lock).catch(() => {});
        else await delay(200);
      }
    }
    if (!handle) throw new Error("本机 Codex 正在启动，请稍后重试");
    try {
      const metadataFile = path.join(this.directory, "runtime.json");
      const saved = JSON.parse(
        await readFile(metadataFile, "utf8").catch((e) => {
          if (e.code === "ENOENT") return "null";
          throw e;
        }),
      );
      if (saved && alive(saved.pid)) {
        if (!/^ws:\/\/127\.0\.0\.1:\d+$/.test(saved.url) || !saved.token)
          throw new Error("本机 Codex 运行记录无效");
        if (!(await ready(saved.url)))
          throw new Error(
            "已有本机 Codex 进程尚未就绪；保留运行中的会话，请稍后重试",
          );
        return saved;
      }
      const token = randomBytes(32).toString("hex");
      const url = `ws://127.0.0.1:${await freePort()}`;
      const log = openSync(
        path.join(this.directory, "app-server.log"),
        "a",
        0o600,
      );
      let child;
      try {
        child = spawn(
          this.executable,
          [
            "app-server",
            "--listen",
            url,
            "--ws-auth",
            "capability-token",
            "--ws-token-sha256",
            createHash("sha256").update(token).digest("hex"),
          ],
          {
            cwd: this.defaultCwd,
            windowsHide: true,
            detached: true,
            stdio: ["ignore", log, log],
          },
        );
      } finally {
        closeSync(log);
      }
      let startupError;
      child.once("error", (error) => {
        startupError = error;
      });
      child.unref();
      if (!child.pid) {
        await delay(10);
        throw startupError || new Error("本机 Codex 启动失败");
      }
      const record = {
        pid: child.pid,
        url,
        token,
        executable: this.executable,
      };
      await writeFile(metadataFile, JSON.stringify(record), { mode: 0o600 });
      for (let i = 0; i < 60; i++) {
        if (startupError || !alive(child.pid))
          throw (
            startupError ||
            new Error("本机 Codex 启动失败，请查看 local-codex/app-server.log")
          );
        if (await ready(url)) return record;
        await delay(200);
      }
      throw new Error("本机 Codex 启动超时；进程已保留，请稍后重试");
    } finally {
      await handle.close();
      await unlink(lock);
    }
  }
}
