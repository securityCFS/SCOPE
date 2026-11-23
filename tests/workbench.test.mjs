import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultWorkbenchConfig,
  validateWorkbenchConfig,
} from "../lib/workbench-config.js";
import { managerPlans } from "../lib/manager-plan.js";
import { placement, validateTask } from "../bridge/workbench/scheduler.mjs";
import { WorkbenchStore } from "../bridge/workbench/store.mjs";
import { WorkbenchService } from "../bridge/workbench/service.mjs";
import {
  cliCommand,
  parseCliResult,
} from "../bridge/providers/cli-command.mjs";
import { codexWorkbenchAdapter } from "../bridge/providers/codex-workbench.mjs";
import { managerPrompt } from "../bridge/workbench/manager-context.mjs";

const snapshot = () => ({
  generatedAt: new Date().toISOString(),
  management: { projects: [] },
  hosts: ["alpha", "beta"].map((alias) => ({
    alias,
    reachable: true,
    inventoryUpdatedAt: new Date().toISOString(),
    agents: [],
    gpus: [0, 1].map((index) => ({
      index,
      utilization: 0,
      memoryUsed: 100,
      memoryTotal: 24000,
    })),
  })),
});
const draft = (overrides = {}) => ({
  host: "alpha",
  cwd: "/work/one",
  provider: "codex",
  prompt: "Implement the feature",
  ...overrides,
});
async function settle(f) {
  for (let i = 0; i < 200; i++) {
    await f.store.tail;
    if (!f.service.launching.size) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("launch did not settle");
}
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "scope-workbench-test-"));
  t.after(async () => {
    if (
      path.dirname(dir) === path.resolve(tmpdir()) &&
      path.basename(dir).startsWith("scope-workbench-test-")
    )
      await rm(dir, { recursive: true, force: true });
  });
  const filename = path.join(dir, "workbench.json");
  const store = await new WorkbenchStore(filename).load();
  let launches = 0;
  let done = false;
  const adapter = {
    async launch(task, _config, checkpoint) {
      launches++;
      const remote = {
        sessionId: task.remote?.sessionId || "manager-1",
        turnId: task.id,
      };
      await checkpoint(remote);
      return remote;
    },
    async poll() {
      return {
        status: done ? "completed" : "running",
        text: done ? "A useful answer" : "",
      };
    },
  };
  const service = new WorkbenchService({
    store,
    snapshot,
    adapters: { codex: adapter, claude: adapter, dsh: adapter },
  });
  return {
    dir,
    filename,
    store,
    service,
    adapter,
    launches: () => launches,
    finish: () => {
      done = true;
    },
  };
}

test("versioned configuration fails closed on typos and invalid limits while allowing optional pre-launch commands", () => {
  const config = defaultWorkbenchConfig();
  assert.equal(config.manager.model, "");
  assert.equal(config.providers.claude.preLaunchCommand, "");
  assert.equal(config.providers.claude.enabled, false);
  assert.deepEqual(validateWorkbenchConfig(config), config);
  assert.throws(
    () => validateWorkbenchConfig({ ...config, token: "secret" }),
    /配置项/,
  );
  const withSetup = structuredClone(config);
  withSetup.providers.claude.preLaunchCommand = "source ~/.proxy.sh";
  assert.equal(validateWorkbenchConfig(withSetup).providers.claude.preLaunchCommand, "source ~/.proxy.sh");
  assert.throws(
    () =>
      validateWorkbenchConfig({
        ...config,
        scheduler: { ...config.scheduler, maxRunning: 0 },
      }),
    /范围/,
  );
  assert.throws(
    () =>
      validateWorkbenchConfig({
        ...config,
        scheduler: { ...config.scheduler, residentSessionsPerHost: 99 },
      }),
    /范围/,
  );
  const legacy = structuredClone(config);
  delete legacy.scheduler.residentSessionsPerHost;
  delete legacy.scheduler.sessionIdleGraceMinutes;
  const migrated = validateWorkbenchConfig(legacy);
  assert.equal(migrated.scheduler.residentSessionsPerHost, 5);
  assert.equal(migrated.scheduler.sessionIdleGraceMinutes, 15);
  assert.throws(() => validateTask(draft({ cwd: "relative" })), /绝对/);
  assert.throws(() => validateTask(draft({ provider: "unknown" })), /未知/);
  assert.throws(() => validateTask(draft({ gpuCount: 1 })), /GPU/);
});

test("placement enforces project/host slots, freshness and exclusive workbench GPU claims", () => {
  const config = defaultWorkbenchConfig();
  config.providers.claude.enabled = true;
  const state = { config, tasks: [] };
  const inventory = snapshot();
  const task = validateTask(
    draft({ provider: "claude", gpuCount: 1, minMemoryMiB: 16000 }),
  );
  assert.deepEqual(placement(task, state, inventory).gpuIndices, [0]);
  state.tasks.push({
    ...task,
    cwd: "/other",
    status: "unknown",
    gpuIndices: [0],
  });
  assert.deepEqual(placement(task, state, inventory).gpuIndices, [1]);
  state.tasks[0].cwd = task.cwd;
  assert.match(placement(task, state, inventory).reason, /项目/);
  state.tasks = [];
  inventory.hosts[0].inventoryUpdatedAt = "2020-01-01";
  assert.match(placement(task, state, inventory).reason, /新鲜/);
  inventory.hosts[0].reachable = false;
  assert.match(placement(task, state, inventory).reason, /上线/);
  assert.deepEqual(
    placement({ ...task, host: "beta" }, state, inventory).gpuIndices,
    [0],
  );
  config.scheduler.paused = true;
  assert.match(placement(task, state, inventory).reason, /暂停/);
});

test("concurrent duplicate submissions persist exactly one task and launch exactly once", async (t) => {
  const f = await fixture(t);
  const request = { ...draft(), requestId: "request-one" };
  const [a, b] = await Promise.all([
    f.service.enqueue(request),
    f.service.enqueue(request),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(f.store.read().tasks.length, 1);
  await assert.rejects(
    f.service.enqueue({ ...request, prompt: "different" }),
    /标识/,
  );
  await f.service.tick();
  await settle(f);
  await f.service.tick();
  assert.equal(f.launches(), 1);
  assert.equal(f.store.read().tasks[0].status, "running");
  const restored = await new WorkbenchStore(f.filename).load();
  assert.equal(restored.read().tasks[0].remote.sessionId, "manager-1");
  f.finish();
  const restarted = new WorkbenchService({
    store: restored,
    snapshot,
    adapters: { codex: f.adapter },
  });
  await restarted.tick();
  assert.equal(restored.read().tasks[0].status, "completed");
  assert.equal(f.launches(), 1, "restart must reconcile, not repeat launch");
});

test("same-project tasks wait and separate projects can run; cancellation never terminates running work", async (t) => {
  const f = await fixture(t);
  const a = await f.service.enqueue({ ...draft(), requestId: "request-a" });
  const b = await f.service.enqueue({ ...draft(), requestId: "request-b" });
  await f.service.enqueue({
    ...draft({ host: "beta" }),
    requestId: "request-c",
  });
  await f.service.tick();
  await settle(f);
  assert.equal(f.launches(), 2);
  assert.equal(
    f.store.read().tasks.find((t) => t.id === b.id).status,
    "queued",
  );
  await assert.rejects(f.service.action(a.id, "cancel"), /当前状态/);
  await f.service.action(b.id, "cancel");
  assert.equal(
    f.store.read().tasks.find((t) => t.id === b.id).status,
    "cancelled",
  );
});

test("ambiguous launch holds its slot and cannot be automatically retried", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  f.service.adapters.codex = {
    async launch() {
      calls++;
      throw new Error("connection lost after send");
    },
    async poll(task) {
      return { status: "unknown", error: task.error };
    },
  };
  const task = await f.service.enqueue({
    ...draft(),
    requestId: "request-ambiguous",
  });
  await f.service.tick();
  await settle(f);
  await f.service.tick();
  assert.equal(calls, 1);
  assert.equal(f.store.read().tasks[0].status, "unknown");
  await f.service.action(task.id, "release");
  assert.equal(f.store.read().tasks[0].status, "released");
});

test("manager conversation and session survive restart; config writes use optimistic revisions", async (t) => {
  const f = await fixture(t);
  const config = defaultWorkbenchConfig();
  config.manager = { ...config.manager, host: "alpha", cwd: "/control" };
  await f.service.configure(config, 0);
  await assert.rejects(f.service.configure(config, 0), /已变化/);
  await f.service.enqueue(
    { prompt: "Across all projects, what is next?", requestId: "manager-one" },
    "manager",
  );
  await f.service.tick();
  await settle(f);
  assert.equal(f.store.read().managerSession.sessionId, "manager-1");
  f.finish();
  await f.service.tick();
  await f.service.tick();
  const restored = await new WorkbenchStore(f.filename).load();
  assert.deepEqual(
    restored.read().messages.map((m) => m.role),
    ["user", "assistant"],
  );
  assert.equal(restored.read().messages[1].text, "A useful answer");
});

test("corrupted workbench state is preserved and reported, not replaced with defaults", async (t) => {
  const f = await fixture(t);
  await writeFile(f.filename, "{broken");
  await assert.rejects(new WorkbenchStore(f.filename).load());
  assert.equal(await readFile(f.filename, "utf8"), "{broken");
});

test("Claude uses proxy failure gate and quoted arguments; DSH uses documented headless profile", () => {
  const config = defaultWorkbenchConfig();
  const command = cliCommand(
    draft({ provider: "claude", cwd: "/a'b", gpuIndices: [1, 3] }),
    { ...config.providers.claude, preLaunchCommand: "source ~/.proxy.sh" },
  );
  assert.ok(command.indexOf("source ~/.proxy.sh") < command.indexOf("exec 'claude'"));
  assert.match(command, /scope_proxy_status/);
  assert.match(command, /exit "\$scope_proxy_status"/);
  assert.match(command, /CUDA_VISIBLE_DEVICES='1,3'/);
  assert.match(command, /--output-format json/);
  assert.equal(command.includes("dangerously-skip-permissions"), false);
  assert.doesNotMatch(
    cliCommand(draft({ provider: "claude" }), {
      ...config.providers.claude,
      preLaunchCommand: "",
    }),
    /scope_proxy_status/,
  );
  assert.match(
    cliCommand(
      draft({ provider: "dsh", prompt: "don't run $(touch bad)" }),
      config.providers.dsh,
    ),
    /--profile headless 'don'"'"'t/,
  );
  assert.equal(
    parseCliResult("claude", {
      status: "completed",
      stdout: '{"type":"result","is_error":true,"result":"permission denied"}',
    }).status,
    "failed",
  );
  assert.equal(
    parseCliResult("claude", { status: "completed", stdout: "not json" })
      .status,
    "failed",
  );
  assert.equal(
    parseCliResult("claude", {
      status: "completed",
      stdout: 'banner\n{"type":"result","result":"done","session_id":"s1"}',
    }).sessionId,
    "s1",
  );
});

test("manager plans ignore malformed proposals and never treat arbitrary text as an action", () => {
  assert.deepEqual(managerPlans("dispatch everything now"), []);
  assert.deepEqual(
    managerPlans('```scope-plan\n{"provider":"codex"}\n```'),
    [],
  );
  assert.equal(
    managerPlans("```scope-plan\n" + JSON.stringify([draft()]) + "\n```")
      .length,
    1,
  );
});

test("Codex adapter validates model before creating a session and checkpoints before turn", async () => {
  const order = [];
  const config = defaultWorkbenchConfig();
  const manager = {
    async createSession(options) {
      order.push(options.readOnly ? "readonly" : "worker");
      return { sessionId: "s1" };
    },
    async startTurn() {
      order.push("turn");
      return { turn: { id: "t1" } };
    },
  };
  const adapter = codexWorkbenchAdapter({
    manager,
    getHost: () => ({ reachable: true }),
    readModels: async () => ({ models: [{ id: "gpt-5-codex" }] }),
    connectionKey: async () => "active",
  });
  const result = await adapter.launch(
    { ...draft(), kind: "manager" },
    config,
    async () => order.push("checkpoint"),
  );
  assert.deepEqual(order, ["readonly", "checkpoint", "turn"]);
  assert.equal(result.turnId, "t1");
  config.manager.model = "missing";
  await assert.rejects(
    adapter.launch({ ...draft(), kind: "manager" }, config, () => {}),
    /没有模型/,
  );
  assert.equal(order.length, 3);
});

test("manager keeps the entire request within the app-server prompt limit", () => {
  const question = "q".repeat(15990) + "END";
  const inventory = snapshot();
  inventory.hosts[0].agents = [{ title: "x".repeat(30000) }];
  const prompt = managerPrompt(
    question,
    { config: defaultWorkbenchConfig(), tasks: [] },
    inventory,
  );
  assert.ok(prompt.length <= 20000);
  assert.ok(prompt.endsWith(question));
});

test("external busy sessions block directory writes but do not block read-only manager", () => {
  const state = { config: defaultWorkbenchConfig(), tasks: [] };
  const inventory = snapshot();
  inventory.hosts[0].agents.push({
    cwd: "/work/one",
    status: "working",
    rollout: { id: "external" },
  });
  assert.match(placement(draft(), state, inventory).reason, /活动会话/);
  assert.equal(
    placement({ ...draft(), kind: "manager" }, state, inventory).reason,
    undefined,
  );
});

test("known preflight failure frees slot and returns an actionable manager error", async (t) => {
  const f = await fixture(t);
  const config = defaultWorkbenchConfig();
  config.manager.host = "alpha";
  config.manager.cwd = "/control";
  await f.service.configure(config, 0);
  f.service.adapters.codex = {
    async launch() {
      throw Object.assign(new Error("model unavailable"), {
        beforeLaunch: true,
      });
    },
  };
  await f.service.enqueue(
    { prompt: "plan", requestId: "preflight-failure" },
    "manager",
  );
  await f.service.tick();
  await settle(f);
  assert.equal(f.store.read().tasks[0].status, "failed");
  assert.equal(f.store.read().messages[1].text, "model unavailable");
});

test("bootstrap configuration is validated and never overrides persisted settings", async (t) => {
  const f = await fixture(t);
  const config = defaultWorkbenchConfig();
  config.scheduler.maxRunning = 5;
  const configFile = path.join(f.dir, "config.json");
  await writeFile(configFile, JSON.stringify(config));
  const seeded = await new WorkbenchStore(f.filename, { configFile }).load();
  assert.equal(seeded.read().config.scheduler.maxRunning, 5);
  await seeded.update((s) => {
    s.config.scheduler.maxRunning = 4;
  });
  await writeFile(configFile, "invalid");
  const restored = await new WorkbenchStore(f.filename, { configFile }).load();
  assert.equal(restored.read().config.scheduler.maxRunning, 4);
  await assert.rejects(
    new WorkbenchStore(path.join(f.dir, "another.json"), { configFile }).load(),
  );
});


test("manager model-only configuration preserves its conversation identity and applies before the next turn", async t => {
  const f = await fixture(t);
  const config = f.service.state().config;
  config.manager = { host: "alpha", cwd: "/work", model: "gpt-5-codex" };
  await f.service.configure(config, 0);
  await f.store.update(state => { state.managerSession = { sessionId: "existing", model: "gpt-5-codex" }; });
  config.manager.model = "next-model";
  await f.service.configure(config, 1);
  assert.equal(f.service.state().managerSession.sessionId, "existing");
  const events = [];
  const adapter = codexWorkbenchAdapter({ manager: {
    isManaged: () => true,
    async setSessionModel(host, id, model) { events.push(["model", host, id, model]); },
    async startTurn() { events.push("turn"); return { turn: { id: "new-turn" } }; },
  }, getHost: () => ({ reachable: true }), readModels: async () => ({ models: [{ id: "next-model" }] }), connectionKey: async () => "active" });
  const result = await adapter.launch({ ...draft(), kind: "manager", remote: f.service.state().managerSession }, config,
    async () => events.push("checkpoint"));
  assert.deepEqual(events, [["model", "alpha", "existing", "next-model"], "checkpoint", "turn"]);
  assert.equal(result.sessionId, "existing");
  assert.equal(result.model, "next-model");
});

test("disabled experimental queue holds queued jobs, reconciles running jobs and permits manager chat", async t => {
  const f = await fixture(t);
  await f.store.update(state => { state.config.manager.host = 'alpha'; state.config.manager.cwd = '/work/manager'; });
  const running = await f.service.enqueue({ ...draft(), requestId: 'running-task-123' });
  await f.service.tick(); await settle(f);
  const queued = await f.service.enqueue({ ...draft({ cwd: '/work/another' }), requestId: 'queued-task-123' });
  f.service.taskQueueEnabled = false;
  f.finish();
  await assert.rejects(f.service.enqueue({ ...draft(), requestId: 'disabled-task-123' }), /未启用/);
  const manager = await f.service.enqueue({ prompt: 'Explain the projects', requestId: 'manager-enabled-123' }, 'manager');
  await f.service.tick(); await settle(f);
  const state = f.service.state();
  assert.equal(state.features.taskQueue, false);
  assert.equal(state.tasks.find(t => t.id === running.id).status, 'completed');
  assert.equal(state.tasks.find(t => t.id === queued.id).status, 'queued');
  assert.match(state.tasks.find(t => t.id === queued.id).queueReason, /未启用/);
  assert.equal(state.tasks.find(t => t.id === manager.id).status, 'running');
  assert.equal(f.launches(), 2);
});

test("manager chat and task queue resolve attachments and preserve previews", async (t) => {
  const f = await fixture(t);
  const launchedTasks = [];
  f.service.resolveAttachments = (items, host, expected) =>
    items.map((item) => ({
      name: `${host}-${expected.scope}-${item.token}.csv`,
      mimeType: "text/csv",
      size: 64,
      kind: "file",
      remotePath: `/workspace/.codex/scope-attachments/${item.token}.csv`,
    }));
  const originalLaunch = f.service.adapters.codex.launch;
  f.service.adapters.codex = {
    ...f.service.adapters.codex,
    async launch(task, config, checkpoint) {
      launchedTasks.push(task);
      return originalLaunch(task, config, checkpoint);
    },
  };
  await f.store.update((state) => {
    state.config.manager = { host: "alpha", cwd: "/work/manager", model: "" };
    state.config.providers.claude.enabled = true;
  });

  const mgrTask = await f.service.enqueue(
    { prompt: "", attachments: [{ token: "m1" }], requestId: "mgr-attach-123" },
    "manager",
  );
  const queuedTask = await f.service.enqueue({
    ...draft({ provider: "codex", prompt: "跑个检查" }),
    attachments: [{ token: "t1" }],
    requestId: "task-attach-123",
  });
  await f.service.tick();
  await settle(f);

  const state = f.service.state();
  assert.equal(state.messages.at(-1).text, "[附件: alpha-manager-m1.csv]");
  assert.equal(mgrTask.attachments[0].remotePath, "/workspace/.codex/scope-attachments/m1.csv");
  assert.equal(queuedTask.attachments[0].remotePath, "/workspace/.codex/scope-attachments/t1.csv");
  assert.equal(launchedTasks.length, 2);
  assert.equal(launchedTasks[0].attachments[0].remotePath, "/workspace/.codex/scope-attachments/m1.csv");
  assert.equal(launchedTasks[1].attachments[0].remotePath, "/workspace/.codex/scope-attachments/t1.csv");
});

