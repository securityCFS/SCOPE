import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LOCAL_HOST } from "../../lib/execution-host.js";
import { shellQuote } from "../transport/ssh-command.mjs";
import { MAINTAINED_PROVIDERS, installCommand } from "./install-command.mjs";

function cleanRemoteLog(stdout, stderr) {
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  return combined
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^bash: cannot set terminal process group \(\d+\): Inappropriate ioctl for device$/.test(line.trim()) &&
        line.trim() !== "bash: no job control in this shell",
    )
    .join("\n")
    .trim()
    .slice(-8000);
}
export class AgentMaintenance {
  constructor({ directory, run, getHost, settings }) {
    Object.assign(this, { directory, run, getHost, settings });
    this.jobs = [];
    this.tail = Promise.resolve();
    this.script = readFile(
      new URL("../providers/remote-job.py", import.meta.url),
      "utf8",
    );
  }
  async load() {
    try {
      this.jobs = JSON.parse(
        await readFile(
          path.join(this.directory, "agent-installations.json"),
          "utf8",
        ),
      );
      if (!Array.isArray(this.jobs)) throw new Error("安装记录格式无效");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return this;
  }
  async save() {
    await mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, "agent-installations.json");
    await writeFile(
      `${file}.tmp`,
      JSON.stringify(this.jobs.filter(job => !["completed", "failed"].includes(job.status) || this.jobs.slice(-150).includes(job)), null, 2),
      { mode: 0o600 },
    );
    await rename(`${file}.tmp`, file);
  }
  transaction(operation) {
    const job = this.tail.then(operation);
    this.tail = job.catch(() => {});
    return job;
  }
  async call(host, payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const result = await this.run(
      host,
      `python3 - ${shellQuote(encoded)}`,
      await this.script,
      20_000,
      2_000_000,
    );
    if (result.code !== 0)
      throw new Error((result.stderr || result.stdout).slice(-2000));
    return JSON.parse(result.stdout.trim());
  }
  async start(host, provider, action) {
    if (host === LOCAL_HOST)
      throw new Error("此入口管理远端工具；本机 Codex 沿用本机安装");
    if (!this.getHost(host)?.reachable) throw new Error("设备当前不可连接");
    if (!MAINTAINED_PROVIDERS.includes(provider)) throw new Error("未知 Agent");
    const command = installCommand(
      provider,
      action,
      this.settings(provider, host),
    );
    const { job, created } = await this.transaction(async () => {
      const previous = this.jobs.findLast(
        (j) => j.host === host && j.provider === provider,
      );
      if (
        previous &&
        ["starting", "running", "unknown"].includes(previous.status)
      )
        return { job: previous, created: false };
      const job = {
        id: randomUUID(),
        host,
        provider,
        action,
        status: "starting",
        startedAt: new Date().toISOString(),
        info: previous?.info || null,
      };
      this.jobs.push(job);
      await this.save();
      return { job, created: true };
    });
    if (created)
      void this.call(host, {
        operation: "launch",
        id: job.id,
        command,
        input: "",
      })
        .then(
          (result) => this.accept(job.id, result),
          (error) =>
            this.accept(job.id, { status: "unknown", error: error.message }),
        )
        .catch(() => {});
    return structuredClone(job);
  }
  async accept(id, result) {
    return this.transaction(async () => {
      const job = this.jobs.find((j) => j.id === id);
      if (!job || ["completed", "failed"].includes(job.status)) return;
      job.status = result.status;
      job.log = cleanRemoteLog(result.stdout, result.stderr);
      job.error =
        result.error ||
        (result.status === "failed"
          ? `命令退出：${result.code ?? "未知"}`
          : null);
      const line = result.stdout
        ?.split(/\r?\n/)
        .findLast((line) => line.startsWith("SCOPE_INSTALL_RESULT="));
      if (line) {
        try {
          job.info = JSON.parse(line.slice("SCOPE_INSTALL_RESULT=".length));
        } catch {
          job.error = "版本回执无法解析";
        }
      }
      if (result.status === "completed" && (!line || job.error)) {
        job.status = "failed";
        job.error ||= "缺少安装版本回执，请检查日志";
      }
      if (["completed", "failed"].includes(job.status))
        job.finishedAt = new Date().toISOString();
      await this.save();
    });
  }
  async view(host) {
    const pending = this.jobs.filter(
      (j) =>
        j.host === host &&
        ["starting", "running", "unknown"].includes(j.status),
    );
    await Promise.all(
      pending.map(async (job) => {
        try {
          await this.accept(
            job.id,
            await this.call(host, { operation: "status", id: job.id }),
          );
        } catch {
          /* Preserve unknown work and its receipt; never retry an install automatically. */
        }
      }),
    );
    return MAINTAINED_PROVIDERS.map((provider) => ({
      provider,
      job:
        this.jobs.findLast((j) => j.host === host && j.provider === provider) ||
        null,
    }));
  }
}
