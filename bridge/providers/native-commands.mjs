import { readFile } from "node:fs/promises";
import { shellQuote } from "./cli-command.mjs";
import { workingDirectory } from "../../lib/execution-host.js";

export function commandName(text) { return /^\/([\w:-]+)(?:\s|$)/.exec(text.trim())?.[1] || null; }
export function normalizeCommands(items) {
  return [...new Map((Array.isArray(items) ? items : []).flatMap(item => {
    const name = typeof item === "string" ? item : item.name;
    return /^[\w:-]+$/.test(name || "") ? [[name, { name, description: String(item.description || "").slice(0, 500), argumentHint: item.argumentHint || item.input?.hint || "", kind: "native" }]] : [];
  })).values()];
}
export class NativeCommands {
  constructor({run, hosts, settings, allowLocal = false}) { Object.assign(this, {run, hosts, settings, allowLocal}); this.cache = new Map(); this.pending = new Map(); }
  async list(host, provider, cwd, force = false) {
    const localAllowed = this.allowLocal && host === "@local";
    const hostEntry = this.hosts().find(h => h.alias === host);
    if (!["claude", "antigravity"].includes(provider) || (!hostEntry?.reachable && !localAllowed) || (host === "@local" && !this.allowLocal)) throw new Error("请选择在线远程 Agent");
    cwd = workingDirectory(host, cwd);
    // ACP session/new persists an empty native conversation. A read-only menu
    // must not create one; use commands reported by an actual owned turn.
    if (provider === "antigravity") throw new Error("AGY 在首次建立会话后提供命令目录；可直接输入命令，由原生协议校验");
    const config = this.settings(provider, host) || {};
    const key = JSON.stringify([host, provider, cwd, config.executable || "", config.preLaunchCommand || ""]);
    const cached = this.cache.get(key);
    if (!force && cached && Date.now() - cached.at < 300000) return cached.commands;
    if (this.pending.has(key)) return this.pending.get(key);
    const request = (async () => {
      const code = (await readFile(new URL("./native-commands.py", import.meta.url))).toString("base64");
      const config = this.settings(provider, host) || {};
      const executable = config.executable || (provider === "claude" ? "claude" : "agy");
      const setup = String(config.preLaunchCommand || "").trim();
      const bootstrap = setup ? `${setup}\nscope_proxy_status=$?\nif [ "$scope_proxy_status" -ne 0 ]; then exit "$scope_proxy_status"; fi\n` : "";
      const script = `${bootstrap}python3 -c ${shellQuote(`import base64;exec(base64.b64decode('${code}'))`)} ${shellQuote(provider)} ${shellQuote(executable)} ${shellQuote(cwd)}`;
      const result = await this.run(host, `bash -ic ${shellQuote(script)}`, "", 35000, 512000);
      if (result.code !== 0) throw new Error("无法读取命令目录，请检查远端版本、代理与登录状态");
      const line = result.stdout.trim().split("\n").findLast(line => line.startsWith('{"commands":'));
      if (!line) throw new Error("Agent 未返回命令目录");
      const commands = normalizeCommands(JSON.parse(line).commands);
      this.cache.set(key, {at:Date.now(), commands}); return commands;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, request); return request;
  }
  async validate(host, provider, cwd, prompt, liveCommands) {
    const name = commandName(prompt);
    if (!name) return;
    if (provider === "antigravity" && !Array.isArray(liveCommands)) return; // ACP validates before dispatch, in the actual session.
    const commands = Array.isArray(liveCommands) ? normalizeCommands(liveCommands) : await this.list(host, provider, cwd);
    if (!commands.some(c => c.name === name)) throw new Error(`/${name} 不在当前 Agent 的网页命令目录中；请使用下方设置或在原终端执行`);
  }
}
