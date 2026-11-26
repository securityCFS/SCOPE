import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LOCAL_HOST, workingDirectory } from "../../lib/execution-host.js";
import {
  formatUserPromptPreview,
  normalizeTurnAttachments,
  renderInstructionWithAttachments,
} from "../session-attachments.mjs";

import { normalizeAgyProfile } from "./native-models.mjs";

/** Persistent CLI conversations. One durable spool job per turn; polling never launches work. */
export class CliConversations {
  constructor({ filename, adapter, hosts, settings, catalog, models, commands, lifecycle, resolveAttachments = null, allowLocal = false }) {
    Object.assign(this, { filename, adapter, hosts, settings, catalog, models, commands, lifecycle, resolveAttachments, allowLocal });
    this.sessions = new Map(); this.pending = new Map(); this.writes = Promise.resolve();
  }
  async load() {
    try { for (const session of JSON.parse(await readFile(this.filename, "utf8"))) this.sessions.set(session.key, session); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return this;
  }
  save() {
    const data = JSON.stringify([...this.sessions.values()]);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.tmp`;
      await writeFile(temporary, data, { mode: 0o600 });
      await rename(temporary, this.filename);
    });
    return this.writes;
  }
  entries() {
    return [...this.sessions.values()].map(({ key, host, provider, sessionId, cwd, title, model, status, updatedAt, phase, subagents, agyProfile }) => ({
      key,
      host,
      provider,
      sessionId,
      cwd,
      title,
      model,
      status,
      updatedAt,
      phase,
      managed: true,
      ...(agyProfile ? { profile: agyProfile } : {}),
      activeSubagents: Array.isArray(subagents) ? subagents.filter((item) => item?.status === "working").length : 0,
    }));
  }
  hostAvailable(host) {
    if (host === LOCAL_HOST) {
      if (!this.allowLocal) return false;
      return this.hosts().some((item) => item.alias === LOCAL_HOST);
    }
    return this.hosts().some((item) => item.alias === host && item.reachable);
  }
  start() {
    this.timer = setInterval(() => { void this.refresh(); }, 5000);
    this.timer.unref();
    void this.refresh();
  }
  stop() { clearInterval(this.timer); }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const queue = [...this.sessions.values()].filter((session) => session.job && ["launching", "running", "waiting_permission", "stopping", "finishing", "unknown"].includes(session.status) && this.hostAvailable(session.host));
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
        for (let session; (session = queue.shift());) await this.read(session.key);
      }));
    } finally { this.refreshing = false; }
  }
  async send(body) {
    const rawPrompt = String(body.prompt || "").trim();
    if (rawPrompt.length > 60_000) throw new Error("请输入消息（不超过 60000 字符）");
    let session = body.key ? this.sessions.get(body.key) : null;
    const existing = body.key && !session ? this.catalog.get(body.key) : null;
    if (body.key && !session && !existing) throw new Error("找不到会话，请重新扫描");
    const provider = session?.provider || existing?.provider || body.provider;
    const hasRawAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
    if (!rawPrompt && !hasRawAttachments) throw new Error("请输入消息（不超过 60000 字符）");
    if (!["claude", "antigravity"].includes(provider)) throw new Error("不支持此 Agent");
    const host = session?.host || existing?.host || body.host;
    if (host === LOCAL_HOST && !this.allowLocal) throw new Error("Claude / Antigravity 网页会话暂需选择远程设备；本机历史可浏览");
    if (!this.hostAvailable(host)) throw new Error("设备当前离线");
    const agyProfile = provider === "antigravity"
      ? normalizeAgyProfile(body.agyProfile ?? session?.agyProfile ?? existing?.profile ?? "")
      : "";
    const cwd = workingDirectory(host, session?.cwd || existing?.cwd || body.cwd);
    const scopeKey = String(body.attachmentScope || body.key || "new-session");
    const attachments = hasRawAttachments
      ? (this.resolveAttachments
          ? this.resolveAttachments(body.attachments, host, { scope: scopeKey })
          : normalizeTurnAttachments(body.attachments))
      : [];
    if (!rawPrompt && !attachments.length) throw new Error("请输入消息（不超过 60000 字符）");
    if (rawPrompt) await this.commands?.validate(host, provider, cwd, rawPrompt);
    if (session && ["launching", "running", "waiting_permission", "stopping", "finishing", "unknown"].includes(session.status)) throw new Error("上一轮尚未结束或状态待确认，请稍后重试");
    if (session?.turns.length && !session.sessionId) throw new Error("上一轮未返回可续接的会话标识，请新建会话；不会悄悄丢失上下文继续");
    let model = String(body.model ?? session?.model ?? "").trim();
    if (model.length > 200 || /[\x00-\x1f]/.test(model)) throw new Error("模型名称无效");
    const config = { ...this.settings(provider, host), model };
    const permissionMode = body.permissionMode ?? session?.permissionMode ?? (provider === "claude" ? "auto" : "default");
    if (!["auto", "default", "workspace", "plan", ...(provider === "antigravity" ? ["full"] : [])].includes(permissionMode)) throw new Error("不支持此权限设置");
    const effort = String(body.effort ?? session?.effort ?? "");
    if (effort && !["low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error("不支持此推理强度");
    await this.models?.validate(host, provider, model, agyProfile ? { agyProfile } : undefined);
    if (provider === "claude") await this.models?.validateClaudeOptions?.(host, model, effort, permissionMode);
    if (provider === "antigravity" && this.models?.validateAgyOptions) {
      model = await this.models.validateAgyOptions(host, model, effort, permissionMode, agyProfile ? { agyProfile } : undefined);
      config.model = model;
    }
    const resumeId = session?.sessionId || existing?.sessionId;
    if (resumeId) await this.lifecycle?.(host, resumeId, "check", provider, agyProfile ? { agyProfile } : undefined);
    // Model discovery is asynchronous. Recheck the session after it so two
    // sends cannot claim the same native conversation while discovery runs.
    session = body.key ? this.sessions.get(body.key) || session : session;
    if (session && ["launching", "running", "waiting_permission", "stopping", "finishing", "unknown"].includes(session.status)) throw new Error("上一轮尚未结束或状态待确认，请稍后重试");
    const displayPrompt = formatUserPromptPreview(rawPrompt, attachments);
    const effectivePrompt = renderInstructionWithAttachments(rawPrompt, attachments);
    if (!session) {
      const key = existing?.key || `cli:${randomUUID()}`;
      session = { key, host, cwd, provider, sessionId: existing?.sessionId || null, ...(agyProfile ? { agyProfile } : {}), title: (rawPrompt || attachments.map((a) => a.name).join(", ")).slice(0, 120), turns: [] };
      this.sessions.set(key, session);
    } else if (agyProfile && !session.agyProfile) {
      session.agyProfile = agyProfile;
    }
    const task = { id: randomUUID(), host, cwd, provider, interactive: true, prompt: effectivePrompt, permissionMode, effort, resumeSessionId: session.sessionId || null, ...(agyProfile ? { agyProfile } : {}) };
    session.effort = effort;
    session.permissionMode = permissionMode;
    session.model = model; session.status = "launching"; session.updatedAt = Date.now();
    session.turns.push({ id: task.id, prompt: displayPrompt, text: "", status: "launching", createdAt: session.updatedAt });
    session.job = task;
    try {
      await this.save();
      await this.adapter.launch(task, { providers: { [provider]: config } });
      session.status = "running";
      session.turns.at(-1).status = "running";
    } catch (error) {
      // A lost launch response may still mean the remote job started. Never retry automatically.
      session.status = "unknown";
      session.turns.at(-1).error = error.message;
    }
    await this.save();
    return this.view(session);
  }
  view(session) {
    const { job, ...value } = session;
    return { ...value, interactive: job?.interactive === true };
  }
  async control(body) {
    const session = this.sessions.get(body.key);
    if (!session?.job?.interactive) throw new Error("此会话没有可用交互通道");
    if (!["running", "waiting_permission"].includes(session.status)) throw new Error("会话未在运行或正在结束，请刷新后重试");
    if (!this.hostAvailable(session.host)) throw new Error("设备当前离线，未发送控制请求");
    const control = { id: String(body.id || randomUUID()), action: body.action };
    if (!/^[a-f0-9-]{36}$/.test(control.id)) throw new Error("请求标识无效");
    if (body.action === "message") {
      const rawPrompt = String(body.prompt || "").trim();
      const hasRawAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
      const attachments = hasRawAttachments
        ? (this.resolveAttachments
            ? this.resolveAttachments(body.attachments, session.host, { scope: session.key })
            : normalizeTurnAttachments(body.attachments))
        : [];
      if ((!rawPrompt && !attachments.length) || rawPrompt.length > 60000) throw new Error("请输入消息（不超过 60000 字符）");
      if (rawPrompt) await this.commands?.validate(session.host, session.provider, session.cwd, rawPrompt, session.commands);
      control.prompt = renderInstructionWithAttachments(rawPrompt, attachments);
    } else if (body.action === "permission") {
      if (!["allow", "deny", ...(session.provider === "antigravity" ? ["cancel"] : [])].includes(body.decision)) throw new Error("无效审批结果");
      control.requestId = String(body.requestId || ""); control.decision = body.decision;
      if (body.optionId !== undefined) control.optionId = String(body.optionId);
      if (body.content !== undefined) {
        if (!body.content || typeof body.content !== "object" || Array.isArray(body.content) || JSON.stringify(body.content).length > 60000) throw new Error("表单内容无效");
        control.content = body.content;
      }
      if (body.answers) {
        if (typeof body.answers !== "object" || Array.isArray(body.answers) || Object.values(body.answers).some(v => typeof v !== "string" || v.length > 10000)) throw new Error("回答格式无效");
        control.answers = body.answers;
      }
    } else if (body.action !== "stop") throw new Error("不支持的控制操作");
    await this.adapter.control(session.job, control);
    return { controlId: control.id, status: "queued" };
  }
  async changeState({ key, action }) {
    if (!["archive", "delete", "restore"].includes(action)) throw new Error("无效操作");
    const entry = this.sessions.get(key) || this.catalog.get(key);
    if (!entry || !["claude", "antigravity"].includes(entry.provider) || !entry.sessionId) throw new Error("仅支持已有 Claude / Antigravity 会话");
    if (["launching", "running", "waiting_permission", "stopping", "finishing", "unknown"].includes(entry.status)) throw new Error("会话仍在运行或状态待确认");
    if (!this.hostAvailable(entry.host)) throw new Error("主机离线，未修改归档状态");
    if (!this.lifecycle) throw new Error("远端归档服务不可用");
    const agyProfile = entry.provider === "antigravity" ? (entry.agyProfile || entry.profile || "") : "";
    const result = await this.lifecycle(entry.host, entry.sessionId, action, entry.provider, agyProfile ? { agyProfile } : undefined);
    for (const item of this.sessions.values()) if (item.host === entry.host && item.provider === entry.provider && item.sessionId === entry.sessionId) item.phase = result.phase;
    // Update the cached catalog immediately, then reconcile against remote state.
    for (const item of this.catalog.records?.values() || []) if (item.host === entry.host && item.provider === entry.provider && item.sessionId === entry.sessionId) item.phase = result.phase;
    await this.save();
    void this.catalog.refresh(true);
    return result;
  }
  async read(key) {
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.job && ["launching", "running", "waiting_permission", "stopping", "finishing", "unknown"].includes(session.status)) {
      if (!this.pending.has(key)) {
        this.pending.set(key, this.poll(session).finally(() => this.pending.delete(key)));
      }
      await this.pending.get(key);
    }
    return this.view(session);
  }
  async poll(session) {
    try {
      const result = await this.adapter.poll(session.job);
      const turn = session.turns.at(-1);
      if (session.job.interactive) {
        session.sessionId = result.sessionId || session.sessionId;
        turn.events = result.events || turn.events || [];
        turn.partial = result.partial || "";
        turn.truncated = Boolean(result.truncated);
        session.permissions = result.permissions || [];
        session.controlResults = result.controlResults || [];
        if (Array.isArray(result.commands)) session.commands = result.commands;
        if (Array.isArray(result.subagents)) {
          session.subagents = result.subagents;
          turn.subagents = result.subagents;
        }
      }
      if (["completed", "failed", "stopped"].includes(result.status)) {
        session.status = result.status;
        session.sessionId = result.sessionId || session.sessionId;
        turn.status = result.status; turn.text = (result.text || "").slice(-120_000); turn.error = result.error || null; turn.errorCode = result.errorCode || null;
        if (["stopped", "failed"].includes(result.status) && Array.isArray(session.subagents)) {
          session.subagents = session.subagents.map((item) =>
            item?.status === "working" ? { ...item, status: result.status } : item,
          );
          turn.subagents = session.subagents;
        }
        session.updatedAt = Date.now();
        await this.save();
        void this.catalog.refresh(true);
      } else {
        session.status = ["running", "waiting_permission", "stopping", "finishing"].includes(result.status) ? result.status : "unknown";
        turn.status = session.status;
        turn.error = result.error || null;
      }
    } catch (error) { session.turns.at(-1).error = `读取进度失败：${error.message}`; }
  }
}
