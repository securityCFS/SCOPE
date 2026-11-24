import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { LOCAL_HOST } from "../../lib/execution-host.js";
import { shellQuote } from "../transport/ssh-command.mjs";
import { runLocalPython } from "../local/python-probe.mjs";
import { activityTime } from "../../lib/session-activity.js";

export const catalogKey = (host, provider, id) => JSON.stringify([host, provider, id]);

export class SessionCatalog {
  constructor({ hosts, run, local = runLocalPython }) {
    this.hosts = hosts; this.run = run; this.local = local;
    this.records = new Map(); this.scans = new Map(); this.pending = null; this.lastScan = 0;
    this.script = readFile(new URL("./probe.py", import.meta.url), "utf8");
    this.agyScript = readFile(new URL("./agy-history.py", import.meta.url), "utf8");
  }
  async probe(host, payload, script = this.script) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const result = host === LOCAL_HOST
      ? await this.local(await script, [encoded], 60_000, 16_000_000)
      : await this.run(host, `python3 - ${shellQuote(encoded)}`, await script, 60_000, 16_000_000);
    if (result.code !== 0) throw new Error(result.stderr || "会话扫描失败");
    return JSON.parse(result.stdout);
  }
  refresh(force = false) {
    if (this.pending) return this.pending;
    if (!force && Date.now() - this.lastScan < 60_000) return Promise.resolve();
    this.lastScan = Date.now();
    const queue = this.hosts().filter((host) => host.reachable || host.alias === LOCAL_HOST);
    const worker = async () => {
      for (let host; (host = queue.shift());) {
        try {
          const result = await this.probe(host.alias, { operation: "scan" });
          if (!Array.isArray(result.entries)) throw new Error("扫描结果格式无效");
          const entries = result.entries.filter((entry) => entry.sessionId && ["codex", "claude", "antigravity"].includes(entry.provider)).map((entry) => ({ ...entry, host: host.alias, key: catalogKey(host.alias, entry.provider, entry.sessionId) }));
          for (const [key, entry] of this.records) if (entry.host === host.alias) this.records.delete(key);
          for (const entry of entries) {
            const previous = this.records.get(entry.key);
            if (!previous || activityTime(entry.updatedAt) >= activityTime(previous.updatedAt)) this.records.set(entry.key, entry);
          }
          this.scans.set(host.alias, { host: host.alias, count: new Set(entries.map((entry) => entry.key)).size, errors: result.errors || [], roots: result.roots, updatedAt: new Date().toISOString() });
        } catch (error) {
          this.scans.set(host.alias, { ...this.scans.get(host.alias), host: host.alias, errors: [error.message], stale: true });
        }
      }
    };
    this.pending = Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker)).finally(() => { this.pending = null; });
    return this.pending;
  }
  get(key) { return this.records.get(key); }
  state() {
    const entries = [...this.records.values()].map(({ path: _path, ...entry }) => entry);
    const state = { entries, scans: [...this.scans.values()], scanning: Boolean(this.pending) };
    const body = JSON.stringify(state);
    return { state, body, etag: `"${createHash("sha1").update(body).digest("hex")}"` };
  }
  async dialogue(key, paging = {}) {
    const entry = this.get(key);
    if (!entry) {
      let parsed;
      try {
        parsed = JSON.parse(key);
      } catch {
        parsed = null;
      }
      if (
        Array.isArray(parsed) &&
        parsed[1] === "antigravity" &&
        typeof parsed[0] === "string" &&
        typeof parsed[2] === "string" &&
        parsed[2] &&
        this.hosts().some(
          (item) =>
            item.alias === parsed[0] &&
            (item.reachable || item.alias === LOCAL_HOST),
        )
      ) {
        const result = await this.probe(
          parsed[0],
          { sessionId: parsed[2], ...paging },
          this.agyScript,
        );
        return { ...result, summary: "" };
      }
      throw new Error("未找到会话，请刷新扫描");
    }
    if (entry.provider === "antigravity") {
      const result = await this.probe(entry.host, { sessionId: entry.sessionId, ...paging }, this.agyScript);
      return { ...result, summary: entry.preview || entry.title };
    }
    return this.probe(entry.host, { operation: "dialogue", provider: entry.provider, path: entry.path });
  }
  async subagentWorkflow(key, { subagentId, version } = {}) {
    if (!subagentId || typeof subagentId !== "string") {
      throw new Error("缺少子代理标识");
    }
    const entry = this.get(key);
    if (!entry) throw new Error("未找到会话，请刷新扫描");
    if (entry.provider !== "claude" || !entry.path) {
      throw new Error("当前会话不支持 Claude 子代理工作流读取");
    }
    return this.probe(entry.host, {
      operation: "subagent_workflow",
      provider: "claude",
      path: entry.path,
      subagentId: subagentId.trim(),
      ...(version ? { version: String(version) } : {}),
    });
  }
}
