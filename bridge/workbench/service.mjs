import { taskArchiveActions } from "./task-archive.mjs";
import { randomUUID } from "node:crypto";
import {
  PROVIDERS,
  validateWorkbenchConfig,
} from "../../lib/workbench-config.js";
import { HELD_STATES, placement, validateTask } from "./scheduler.mjs";
import { managerPrompt } from "./manager-context.mjs";
import { formatUserPromptPreview } from "../session-attachments.mjs";

const timestamp = () => new Date().toISOString();
export class WorkbenchService {
  constructor({ store, snapshot, adapters, taskQueueEnabled = true, resolveAttachments = null }) {
    this.taskQueueEnabled = taskQueueEnabled;
    this.store = store;
    this.snapshot = snapshot;
    this.adapters = adapters;
    this.resolveAttachments = resolveAttachments;
    this.archiveTask = taskArchiveActions({ store, adapters });
    this.launching = new Set();
    this.ticking = false;
    this.error = null;
  }
  state() {
    const state = this.store.read();
    const snapshot = this.snapshot();
    return {
      ...state,
      providers: PROVIDERS,
      features: { taskQueue: this.taskQueueEnabled },
      error: this.error,
      tasks: state.tasks.map((task) => ({
        ...task,
        queueReason:
          task.status === "queued"
            ? (!this.taskQueueEnabled && task.kind !== "manager" ? "实验任务队列未启用" : placement(task, state, snapshot).reason || "准备执行")
            : null,
      })),
    };
  }
  async configure(config, revision) {
    const valid = validateWorkbenchConfig(config);
    await this.store.update((state) => {
      if (revision !== (state.configRevision || 0))
        throw new Error("配置已变化，请重新载入后保存");
      const changed =
        JSON.stringify(valid.manager) !== JSON.stringify(state.config.manager);
      if (
        changed &&
        state.tasks.some(
          (t) =>
            t.kind === "manager" &&
            (HELD_STATES.has(t.status) || t.status === "queued"),
        )
      )
        throw new Error("总调度仍有未结束的消息，请等待结果后更改设置");
      if (
        valid.manager.host !== state.config.manager.host ||
        valid.manager.cwd !== state.config.manager.cwd
      )
        state.managerSession = null;
      state.config = valid;
      state.configRevision = (state.configRevision || 0) + 1;
    });
  }
  async enqueue(body, kind = "task") {
    if (kind !== "manager" && !this.taskQueueEnabled) throw new Error("实验任务队列未启用，请先配置 deployment.json");
    if (
      typeof body.requestId !== "string" ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId)
    )
      throw new Error("缺少有效的请求标识");
    const state = this.store.read();
    const existing = state.tasks.find((t) => t.requestId === body.requestId);
    const rawAttachments =
      Array.isArray(body.attachments) && body.attachments.length
        ? body.attachments
        : [];
    const targetHost =
      kind === "manager" ? state.config.manager.host : body.host;
    const attachments = rawAttachments.length
      ? this.resolveAttachments
        ? this.resolveAttachments(rawAttachments, targetHost, {
            scope: kind === "manager" ? "manager" : "task",
          })
        : rawAttachments
      : [];
    const input =
      kind === "manager"
        ? {
            provider: "codex",
            host: state.config.manager.host,
            cwd: state.config.manager.cwd,
            prompt: body.prompt ?? "",
            ...(attachments.length ? { attachments } : {}),
          }
        : {
            ...body,
            ...(attachments.length ? { attachments } : {}),
          };
    const taskInput = validateTask(input);
    const signature = JSON.stringify({ ...taskInput, kind });
    if (existing) {
      if (existing.signature !== signature)
        throw new Error("同一请求标识不能用于不同任务");
      return existing;
    }
    if (!state.config.providers[taskInput.provider].enabled)
      throw new Error("请先在设置中启用此 Agent");
    if (!this.snapshot().hosts.some((h) => h.alias === taskInput.host))
      throw new Error("所选主机尚未被 SCOPE 发现");
    const task = {
      ...taskInput,
      id: randomUUID(),
      requestId: body.requestId,
      signature,
      kind,
      status: "queued",
      createdAt: timestamp(),
      updatedAt: timestamp(),
      remote: null,
      gpuIndices: [],
    };
    return this.store.update((current) => {
      const duplicate = current.tasks.find(
        (t) => t.requestId === body.requestId,
      );
      if (duplicate) {
        if (duplicate.signature !== signature) throw new Error("请求标识冲突");
        return duplicate;
      }
      if (kind !== "manager" && current.tasks.filter((t) => t.kind !== "manager" && !t.archivedAt).length >= 500)
        throw new Error("未归档任务已达 500 条，请在左侧归档已结束的任务后继续");
      if (!current.config.providers[task.provider].enabled)
        throw new Error("此 Agent 的配置已变化，请重新载入后派发");
      if (
        kind === "manager" &&
        (current.config.manager.host !== task.host ||
          current.config.manager.cwd !== task.cwd)
      )
        throw new Error("总调度配置已变化，请重新载入后发送");
      current.tasks.push(task);
      if (kind === "manager")
        current.messages.push({
          id: randomUUID(),
          role: "user",
          text: formatUserPromptPreview(task.prompt, task.attachments),
          taskId: task.id,
          createdAt: task.createdAt,
        });
      return task;
    });
  }
  async action(id, action) {
    if (["archive", "restore"].includes(action))
      return this.archiveTask(id, action);
    await this.store.update((state) => {
      const task = state.tasks.find((t) => t.id === id);
      if (!task) throw new Error("任务不存在");
      if (action === "cancel" && task.status === "queued")
        task.status = "cancelled";
      else if (action === "release" && task.status === "unknown")
        task.status = "released";
      else throw new Error("当前状态不支持此操作");
      task.updatedAt = timestamp();
      task.note =
        action === "release"
          ? "用户核实远端后释放工作台占用；未向远端发送终止信号"
          : "排队任务已取消";
    });
  }
  async checkpoint(id, remote) {
    await this.store.update((state) => {
      const task = state.tasks.find((t) => t.id === id);
      task.remote = remote;
      if (task.kind === "manager") state.managerSession = remote;
    });
  }
  async launch(task, config) {
    this.launching.add(task.id);
    try {
      const adapter = this.adapters[task.provider];
      const remote = await adapter.launch(task, config, (value) =>
        this.checkpoint(task.id, value),
      );
      await this.store.update((state) => {
        const record = state.tasks.find((t) => t.id === task.id);
        record.remote = remote;
        record.status = "running";
        record.updatedAt = timestamp();
        if (record.kind === "manager") state.managerSession = remote;
      });
    } catch (error) {
      // The transport may have accepted the request before the connection failed.
      // Keep the slot and receipt for reconciliation; never silently relaunch.
      await this.store.update((state) => {
        const record = state.tasks.find((t) => t.id === task.id);
        record.status = error.beforeLaunch === true ? "failed" : "unknown";
        record.error = error.message;
        record.updatedAt = timestamp();
        if (record.kind === "manager" && record.status === "failed")
          state.messages.push({
            id: randomUUID(),
            role: "assistant",
            text: error.message,
            taskId: task.id,
            createdAt: timestamp(),
          });
      });
    } finally {
      this.launching.delete(task.id);
    }
  }
  async poll(task) {
    if (this.launching.has(task.id)) return;
    let result;
    try {
      result = await this.adapters[task.provider].poll(task);
    } catch (error) {
      result = { status: "unknown", error: error.message };
    }
    const previous = JSON.stringify({
      status: task.status,
      result: task.result,
    });
    if (previous === JSON.stringify({ status: result.status, result })) return;
    await this.store.update((state) => {
      const record = state.tasks.find((t) => t.id === task.id);
      if (!HELD_STATES.has(record.status)) return;
      record.status = result.status;
      record.result = result;
      record.error = result.error || null;
      record.updatedAt = timestamp();
      if (
        record.kind === "manager" &&
        ["completed", "failed"].includes(result.status)
      ) {
        state.messages.push({
          id: randomUUID(),
          role: "assistant",
          text: result.text || result.error || "本次没有返回文本。",
          taskId: task.id,
          createdAt: timestamp(),
        });
      }
    });
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const active = this.store
        .read()
        .tasks.filter((t) => HELD_STATES.has(t.status));
      // A failed host must not prevent reconciliation on the other hosts.
      await Promise.all(active.map((t) => this.poll(t)));
      for (const candidate of this.store
        .read()
        .tasks.filter((t) => t.status === "queued" && (this.taskQueueEnabled || t.kind === "manager"))) {
        let launch;
        await this.store.update((state) => {
          const task = state.tasks.find((t) => t.id === candidate.id);
          if (task.status !== "queued") return;
          const selected = placement(task, state, this.snapshot());
          if (selected.reason) return;
          task.status = "starting";
          task.gpuIndices = selected.gpuIndices;
          task.updatedAt = timestamp();
          if (task.kind === "manager") task.remote = state.managerSession;
          if (task.provider !== "codex")
            task.remote = { kind: "remote-cli", id: task.id };
          const effective = structuredClone(task);
          if (task.kind === "manager")
            effective.prompt = managerPrompt(
              task.prompt,
              state,
              this.snapshot(),
              this.taskQueueEnabled,
            );
          launch = { task: effective, config: structuredClone(state.config) };
        });
        if (launch)
          void this.launch(launch.task, launch.config).catch((error) => {
            this.error = error.message;
          });
      }
      this.error = null;
    } catch (error) {
      this.error = error.message;
    } finally {
      this.ticking = false;
    }
  }
  start() {
    this.timer = setInterval(() => void this.tick(), 3000);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
  }
}
