import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CliConversations } from "../bridge/providers/conversations.mjs";

async function service(t, overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "scope-native-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const options = { filename: path.join(dir, "sessions.json"), hosts: () => [{ alias: "test-host", reachable: true }], settings: (provider, host) => ({ executable: provider === "claude" ? "claude" : "agy", preLaunchCommand: host === "test-host" ? "source ~/.env.sh" : "" }), catalog: { get: () => null, refresh: async () => {} }, adapter: {
    launch: async (task, config) => { calls.push({ task, config }); },
    poll: async () => ({ status: "completed", text: "done", sessionId: "native-id" }),
    ...overrides,
  } };
  return { client: await new CliConversations(options).load(), options, calls };
}
test("native turns persist, resume the same session, and enforce provider proxy setup", async (t) => {
  const { client, options, calls } = await service(t);
  const first = await client.send({ host: "test-host", cwd: "/workspace", provider: "claude", prompt: "one" });
  assert.equal(first.status, "running");
  await assert.rejects(client.send({ key: first.key, prompt: "duplicate" }), /上一轮/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.providers.claude.preLaunchCommand, "source ~/.env.sh");
  assert.equal(calls[0].task.permissionMode, "auto");
  const recovered = await new CliConversations(options).load();
  assert.equal((await recovered.read(first.key)).sessionId, "native-id");
  await recovered.send({ key: first.key, prompt: "two", model: "opus" });
  assert.equal(calls[1].task.resumeSessionId, "native-id");
  assert.equal(calls[1].config.providers.claude.model, "opus");
  const agy = await client.send({ host: "test-host", cwd: "/workspace", provider: "antigravity", prompt: "hello" });
  assert.equal(agy.provider, "antigravity");
  assert.equal(calls.at(-1).config.providers.antigravity.preLaunchCommand, "source ~/.env.sh");
});

test("native messages preserve the full accepted prompt and attachment paths", async t => {
  const { client, calls } = await service(t);
  const prompt = "x".repeat(59_980) + "TAIL_INSTRUCTION";
  await client.send({ host: "test-host", cwd: "/workspace", provider: "claude", prompt });
  assert.equal(calls[0].task.prompt, prompt);
  const attachment = { name: "notes.txt", remotePath: "/tmp/notes.txt", kind: "file", size: 1, mimeType: "text/plain" };
  await client.send({ host: "test-host", cwd: "/other", provider: "antigravity", prompt, attachments: [attachment] });
  assert.ok(calls[1].task.prompt.startsWith(prompt));
  assert.ok(calls[1].task.prompt.includes(attachment.remotePath));
});

test("AGY full permission is explicit, persists for continuation, and is not accepted for Claude", async t => {
  const { client, options, calls } = await service(t);
  const session = await client.send({ host: "test-host", cwd: "/workspace", provider: "antigravity", prompt: "one", permissionMode: "full" });
  assert.equal(calls[0].task.permissionMode, "full");
  const recovered = await new CliConversations(options).load();
  await recovered.read(session.key);
  await recovered.send({ key: session.key, prompt: "two" });
  assert.equal(calls[1].task.permissionMode, "full");
  assert.equal(calls[1].task.resumeSessionId, "native-id");
  assert.equal(calls[1].config.providers.antigravity.preLaunchCommand, "source ~/.env.sh");
  await assert.rejects(client.send({ host: "test-host", cwd: "/workspace", provider: "claude", prompt: "test", permissionMode: "full" }), /不支持此权限/);
  assert.equal(calls.length, 2);
});

test("Claude effort persists across reload and busy external writers block resume and archive", async t => {
  const { client, options, calls } = await service(t);
  const first = await client.send({ host: "test-host", cwd: "/workspace", provider: "claude", prompt: "one", effort: "high" });
  await client.read(first.key);
  const recovered = await new CliConversations(options).load();
  await recovered.send({ key: first.key, prompt: "two", model: "opus", effort: "low", permissionMode: "auto" });
  assert.equal(calls.at(-1).task.effort, "low");
  await recovered.read(first.key);
  recovered.lifecycle = async () => { throw new Error("terminal writer active"); };
  await assert.rejects(recovered.send({ key: first.key, prompt: "three" }), /writer/);
  await assert.rejects(recovered.changeState({ key: first.key, action: "archive" }), /writer/);
  assert.equal(calls.length, 2);
  recovered.lifecycle = async (_host, _id, action) => ({ phase: action === "archive" ? "archived" : action === "delete" ? "deleted" : "active" });
  await recovered.changeState({ key: first.key, action: "archive" });
  assert.equal(recovered.entries()[0].phase, "archived");
  await recovered.changeState({ key: first.key, action: "delete" });
  assert.equal(recovered.entries()[0].phase, "deleted");
  await recovered.changeState({ key: first.key, action: "restore" });
  assert.equal(recovered.entries()[0].phase, "active");
});
test("ambiguous launch is polled without launching a second agent", async (t) => {
  let launches = 0;
  const { client } = await service(t, { launch: async () => { launches++; throw new Error("connection lost"); } });
  const first = await client.send({ host: "test-host", cwd: "/workspace", provider: "antigravity", prompt: "one" });
  assert.equal(first.status, "unknown");
  await assert.rejects(client.send({ key: first.key, prompt: "retry" }), /上一轮/);
  assert.equal((await client.read(first.key)).status, "completed");
  assert.equal(launches, 1);
});

test("background refresh completes a native turn even when its conversation is not open", async (t) => {
  const { client } = await service(t);
  await client.send({ host: "test-host", cwd: "/workspace", provider: "claude", prompt: "one" });
  await client.refresh();
  assert.equal(client.entries()[0].status, "completed");
  assert.equal(client.entries()[0].sessionId, "native-id");
});
test("native conversations reject offline/local hosts and invalid identity instead of starting fresh", async (t) => {
  const { client, calls } = await service(t);
  for (const body of [{ host: "@local" }, { host: "missing" }, { key: "unknown", host: "test-host" }]) {
    await assert.rejects(client.send({ provider: "claude", cwd: "/workspace", prompt: "test", ...body }));
  }
  assert.equal(calls.length, 0);
});

test("historical AGY resumes its native identity and concurrent discovery cannot duplicate a turn", async (t) => {
  const { client, calls } = await service(t);
  client.catalog.get = () => ({ key: "history", host: "test-host", cwd: "/workspace", provider: "antigravity", sessionId: "original-native" });
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  client.models = { validate: async () => barrier };
  const first = client.send({ key: "history", prompt: "continue", model: "supported", permissionMode: "workspace" });
  const second = client.send({ key: "history", prompt: "duplicate", model: "supported" });
  release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].task.resumeSessionId, "original-native");
  assert.equal(calls[0].task.permissionMode, "workspace");
});

test("unsupported AGY model is rejected before any session or remote launch is created", async t => {
  const { client, calls } = await service(t);
  client.models = { validate: async () => { throw new Error("unsupported model"); } };
  await assert.rejects(client.send({ host: "test-host", cwd: "/workspace", provider: "antigravity", prompt: "hi", model: "invented" }), /unsupported/);
  assert.equal(calls.length, 0);
  assert.equal(client.entries().length, 0);
});

test("AGY lifecycle passes provider identity and persists reversible archive state", async t => {
  const { client, calls } = await service(t);
  const actions = [];
  client.lifecycle = async (host, id, action, provider) => { actions.push({ host, id, action, provider }); return { phase: action === "archive" ? "archived" : action === "delete" ? "deleted" : "active" }; };
  client.models = { validate: async () => {}, validateAgyOptions: async () => "model-pro-high" };
  const first = await client.send({ host: "test-host", cwd: "/workspace", provider: "antigravity", prompt: "one", model: "model-pro-low", effort: "high" });
  assert.equal(first.model, "model-pro-high");
  assert.equal(calls[0].task.permissionMode, "default");
  assert.equal(calls[0].task.effort, "high");
  await client.read(first.key);
  for (const [action, phase] of [["archive", "archived"], ["delete", "deleted"], ["restore", "active"]]) {
    await client.changeState({ key: first.key, action });
    assert.equal(client.entries()[0].phase, phase);
    assert.equal(actions.at(-1).provider, "antigravity");
  }
  client.lifecycle = async () => { throw new Error("native presence lock"); };
  await assert.rejects(client.send({ key: first.key, prompt: "resume" }), /presence/);
  await assert.rejects(client.changeState({ key: first.key, action: "archive" }), /presence/);
  assert.equal(calls.length, 1);
});

test("interactive controls keep the same job and survive bridge reload with visible approvals", async t => {
  const controls = [];
  let snapshot = {status: "waiting_permission", sessionId: "native-id", permissions: [{id: "approval", tool: "Write", input: {file_path: "/workspace/a"}}], events: [{kind: "assistant", text: "Working"}], partial: "Next"};
  const {client, options, calls} = await service(t, {poll: async () => snapshot, control: async (task, control) => controls.push({task, control})});
  const first = await client.send({host: "test-host", cwd: "/workspace", provider: "claude", prompt: "one"});
  assert.equal(first.interactive, true);
  const recovered = await new CliConversations(options).load();
  const live = await recovered.read(first.key);
  assert.equal(live.permissions[0].tool, "Write");
  assert.equal(live.turns[0].partial, "Next");
  await recovered.control({key: first.key, action: "message", prompt: "follow up"});
  await recovered.control({key: first.key, action: "permission", requestId: "approval", decision: "deny"});
  await recovered.control({key: first.key, action: "stop"});
  assert.equal(calls.length, 1);
  assert.ok(controls.every(c => c.task.id === calls[0].task.id));
  await assert.rejects(recovered.changeState({key:first.key, action:"archive"}), /仍在运行/);
  snapshot = {status: "stopped", sessionId: "native-id", permissions: [], events: live.turns[0].events};
  assert.equal((await recovered.read(first.key)).status, "stopped");
  await assert.rejects(recovered.control({key: first.key, action: "stop"}), /未在运行/);
  const final = await new CliConversations(options).load();
  assert.equal((await final.read(first.key)).turns[0].events[0].text, "Working");
});

test("controls reject unsupported agents and malformed or offline requests", async t => {
  const controls = [];
  const {client} = await service(t, {control: async (...args) => controls.push(args)});
  const agy = await client.send({host:"test-host", cwd:"/workspace", provider:"antigravity", prompt:"hi"});
  client.sessions.get(agy.key).job.interactive = false; // Legacy print jobs cannot be upgraded in flight.
  await assert.rejects(client.control({key:agy.key, action:"stop"}), /没有可用交互通道/);
  const claude = await client.send({host:"test-host", cwd:"/workspace", provider:"claude", prompt:"hi"});
  for (const body of [{action:"unknown"}, {action:"message", prompt:""}, {action:"message", prompt:"x".repeat(60001)}, {action:"permission", decision:"always"}, {action:"permission", decision:"allow", answers:{q:{}}}, {action:"stop", id:"../evil"}]) {
    await assert.rejects(client.control({key:claude.key, ...body}));
  }
  client.hosts = () => [];
  await assert.rejects(client.control({key:claude.key, action:"stop"}), /离线/);
  assert.equal(controls.length, 0);
});

test("AGY ACP form values and permission options round trip unchanged", async t => {
  const controls=[];
  const {client}=await service(t,{control:async(_task,control)=>controls.push(control)});
  const agy=await client.send({host:"test-host",cwd:"/workspace",provider:"antigravity",prompt:"hi"});
  assert.equal(agy.interactive,true);
  await client.control({key:agy.key,action:"permission",requestId:"3",decision:"allow",content:{q1:["1","3"],enabled:false,count:2}});
  assert.deepEqual(controls[0].content,{q1:["1","3"],enabled:false,count:2});
  await client.control({key:agy.key,action:"permission",requestId:"4",decision:"allow",optionId:"allow-once"});
  assert.equal(controls[1].optionId,"allow-once");
});


test("native conversations accept attachment-only sends and mid-turn message attachments", async t => {
  const controls = [];
  const { client, options, calls } = await service(t, {
    control: async (_task, control) => controls.push(control),
  });
  client.resolveAttachments = (items, host, expected) =>
    items.map((item) => ({
      name: `${host}-${expected.scope}-${item.token}.png`,
      mimeType: "image/png",
      size: 123,
      kind: "image",
      remotePath: `/home/dev/.codex/scope-attachments/${item.token}.png`,
    }));
  const created = await client.send({
    host: "test-host",
    cwd: "/workspace",
    provider: "claude",
    prompt: "",
    attachments: [{ token: "tok1" }],
    attachmentScope: "new-session",
  });
  assert.equal(created.turns[0].prompt, "[附件: test-host-new-session-tok1.png]");
  assert.match(calls[0].task.prompt, /\/home\/dev\/\.codex\/scope-attachments\/tok1\.png/);

  const recovered = await new CliConversations({
    ...options,
    resolveAttachments: client.resolveAttachments,
  }).load();
  await recovered.control({
    key: created.key,
    action: "message",
    prompt: "结合图片分析",
    attachments: [{ token: "tok2" }],
  });
  assert.match(controls[0].prompt, /结合图片分析/);
  assert.match(controls[0].prompt, /tok2\.png/);
});

test("native conversations track active and finished background subagents", async (t) => {
  let snapshot = {
    status: "running",
    sessionId: "claude-parent-1",
    permissions: [],
    events: [{ kind: "tool", id: "t1", name: "Agent", input: { description: "Run checks", run_in_background: true } }],
    subagents: [
      { id: "t1", taskId: "bg-1", role: "Run checks", typeName: "local_agent", background: true, status: "working", lastAction: "Bash", updatedAt: 1000 },
    ],
  };
  const { client } = await service(t, { poll: async () => snapshot });
  const conv = await client.send({ host: "test-host", cwd: "/workspace", provider: "claude", prompt: "delegate" });
  const running = await client.read(conv.key);
  assert.equal(running.subagents.length, 1);
  assert.equal(running.subagents[0].status, "working");
  assert.equal(client.entries()[0].activeSubagents, 1);

  snapshot = {
    status: "completed",
    sessionId: "claude-parent-1",
    permissions: [],
    events: snapshot.events,
    text: "All done",
    subagents: [
      { id: "t1", taskId: "bg-1", role: "Run checks", typeName: "local_agent", background: true, status: "completed", lastAction: "Checks passed", updatedAt: 2000 },
    ],
  };
  const completed = await client.read(conv.key);
  assert.equal(completed.subagents[0].status, "completed");
  assert.equal(client.entries()[0].activeSubagents, 0);
});
