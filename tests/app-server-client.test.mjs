import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { releaseIdleSessions } from "../bridge/idle-sessions.mjs";

test("idle unsubscribe locks new turns and resumes until release finishes", async () => {
  let now = 0;
  const manager = new AppServerManager({ spawnConnection: () => new FakeAppServerChild(), now: () => now });
  try {
    await manager.resumeSession({ host: "h", sessionId: "one", cwd: "/work" });
    now = 60 * 60_000;
    const connection = await manager.prepareHost("h");
    let finish;
    connection.request = async method => method === "thread/read"
      ? { thread: { status: { type: "idle" } } }
      : new Promise(resolve => { finish = resolve; });
    const releasing = releaseIdleSessions(manager);
    await nextTurn();
    await assert.rejects(manager.startTurn("h", "one", "hello"));
    await assert.rejects(manager.resumeSession({ host: "h", sessionId: "one" }), /空闲资源/);
    finish({ status: "unsubscribed" });
    await releasing;
    assert.equal(manager.isManaged("h", "one"), false);
    assert.equal(connection.closed, false);
  } finally { manager.close(); }
});

test("archive blocks concurrent turns and leaves unrelated sessions and transport alive", async () => {
  let child;
  const manager = new AppServerManager({ spawnConnection: () => (child = new FakeAppServerChild()), requestTimeoutMs: 1000 });
  try {
    await manager.resumeSession({ host: "h", sessionId: "one", cwd: "/work" });
    await manager.resumeSession({ host: "h", sessionId: "two", cwd: "/other" });
    const connection = await manager.prepareHost("h");
    const request = connection.request.bind(connection);
    let release;
    connection.request = (method, params) => method === "thread/read"
      ? Promise.resolve({ thread: { id: params.threadId, path: "/.codex/sessions/one", status: { type: "idle" }, turns: [] } })
      : method === "thread/archive" ? new Promise(resolve => { release = resolve; }) : request(method, params);
    const pending = manager.archiveSession("h", "one");
    await nextTurn();
    await assert.rejects(manager.startTurn("h", "one", "should not send"), /归档/);
    assert.equal(manager.isConnected("h", "one"), true);
    await manager.startTurn("h", "two", "unrelated work");
    release({}); await pending;
    assert.equal(manager.isManaged("h", "one"), false);
    assert.equal(manager.isManaged("h", "two"), true);
    assert.equal(child.killed, false);
    assert.equal(child.messages.some(message => message.method === "turn/interrupt"), false);
  } finally { manager.close(); }
});
import {
  AppServerManager,
  inputRequestKey,
  isAuthenticationRefreshError,
  normalizeHumanResponse,
  normalizeUserInputAnswers,
  parseHumanRequest,
  parseUserInputRequest,
} from "../bridge/app-server-client.mjs";

test("new profile sessions do not disconnect or mutate existing working sessions", async () => {
  const children = new Map();
  const manager = new AppServerManager({ spawnConnection(_host, _executable, key) {
    const child = new FakeAppServerChild(); children.set(key, child); return child;
  }, requestTimeoutMs: 1000 });
  try {
    await manager.resumeSession({ host: "h", sessionId: "old", cwd: "/work", connectionKey: "profile-pro-plus" });
    await manager.startTurn("h", "old", "existing work");
    const before = manager.sessionRecords().find((s) => s.sessionId === "old");
    const created = await manager.createSession({ host: "h", cwd: "/new", prompt: "new work", connectionKey: "account-pro-lite" });
    assert.equal(created.connectionKey, "account-pro-lite");
    assert.deepEqual(manager.sessionRecords().find((s) => s.sessionId === "old"), before);
    assert.equal(children.get("profile-pro-plus").killed, false);
    assert.equal(children.get("profile-pro-plus").stdin.writableEnded, false);
    assert.equal(children.get("account-pro-lite").messages.filter((m) => m.method === "turn/start").length, 1);
  } finally { manager.close(); }
});

test("recognizes account-switch token refresh failures", () => {
  assert.equal(
    isAuthenticationRefreshError(
      "Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.\nunauthorized",
    ),
    true,
  );
  assert.equal(isAuthenticationRefreshError("context window exceeded"), false);
});

test("profile migration blocks only the target thread while writer is released", async () => {
  const children = new Map();
  const manager = new AppServerManager({ spawnConnection(_host, _executable, key) {
    const child = new FakeAppServerChild(); children.set(key, child); return child;
  }, requestTimeoutMs: 1000 });
  try {
    for (const sessionId of ["one", "two"]) await manager.resumeSession({ host: "h", sessionId, path: `/sessions/${sessionId}.jsonl`, cwd: "/work" });
    const source = await manager.prepareHost("h");
    const request = source.request.bind(source);
    let release;
    source.request = (method, params) => method === "thread/unsubscribe"
      ? new Promise((resolve) => { release = () => resolve(request(method, params)); }) : request(method, params);
    const migrating = manager.migrateSessionConnection("h", "one", "account-second");
    await nextTurn();
    await assert.rejects(manager.startTurn("h", "one", "hello"), /切换账号/);
    await manager.startTurn("h", "two", "unrelated work");
    release();
    const result = await migrating;
    assert.equal(result.connectionKey, "account-second");
    assert.equal(result.sessionId, "one");
    assert.equal(result.cwd, "/work");
    assert.equal(manager.sessionRecords().find((s) => s.sessionId === "two").status, "working");
    assert.equal(children.get("active").killed, false);
    assert.equal(children.get("account-second").messages.filter((m) => m.method === "turn/start").length, 0);
  } finally { manager.close(); }
});

test("an instruction awaiting turn/start response cannot race a profile migration", async () => {
  const manager = new AppServerManager({ spawnConnection: () => new FakeAppServerChild(), requestTimeoutMs: 1000 });
  try {
    await manager.resumeSession({ host: "h", sessionId: "one", cwd: "/work" });
    const source = await manager.prepareHost("h");
    const request = source.request.bind(source);
    let release;
    source.request = (method, params) => method === "turn/start"
      ? new Promise((resolve) => { release = () => resolve(request(method, params)); }) : request(method, params);
    const starting = manager.startTurn("h", "one", "work");
    await assert.rejects(manager.migrateSessionConnection("h", "one", "account-second"), /不能迁移/);
    release(); await starting;
    assert.equal(manager.sessionRecords()[0].connectionKey, "active");
  } finally { manager.close(); }
});

test("delayed profile handoff preserves history and prevents old-writer resurrection", async () => {
  const children = new Map();
  const manager = new AppServerManager({ spawnConnection(_h, _e, key) {
    const child = new FakeAppServerChild(); children.set(key, child); return child;
  }, requestTimeoutMs: 1000 });
  try {
    const source = { host: "h", sessionId: "one", cwd: "/work", path: "/sessions/one.jsonl", connectionKey: "active" };
    await manager.resumeSession(source);
    const target = await manager.prepareHost("h", "codex", "account-target");
    const request = target.request.bind(target);
    let locked = true;
    target.request = (method, params) => method === "thread/resume" && locked
      ? Promise.reject(new Error("thread one already has an active writer")) : request(method, params);
    manager.holdSessionForProfile("h", "one");
    await manager.releaseProfileWriter("h", "one", source);
    await assert.rejects(manager.finishProfileHandoff("h", "one", "account-target", "codex", source), /active writer/);
    await assert.rejects(manager.resumeSession(source), /等待旧账号/);
    await assert.rejects(manager.startTurn("h", "one", "must not send"), /切换账号/);
    await assert.rejects(manager.compactSession("h", "one"), /交接账号/);
    assert.equal(children.get("active").messages.filter((m) => m.method === "thread/resume").length, 1);
    assert.equal(children.get("active").killed, false);
    locked = false;
    const result = await manager.finishProfileHandoff("h", "one", "account-target", "codex", source);
    assert.equal(result.path, source.path);
    assert.equal(result.sessionId, "one");
    assert.equal(result.connectionKey, "account-target");
    assert.equal(result.profileHandoff, undefined);
    assert.equal(children.get("account-target").messages.some((m) => m.method === "thread/fork" || m.method === "turn/start"), false);
  } finally { manager.close(); }
});

test("bridge reload hydrates a handoff without any source RPC", async () => {
  const spawned = [];
  const manager = new AppServerManager({ spawnConnection(_h, _e, key) { spawned.push(key); return new FakeAppServerChild(); }, requestTimeoutMs: 1000 });
  try {
    const source = { host: "h", sessionId: "one", cwd: "/work", connectionKey: "active" };
    manager.hydrateProfileHandoff(source);
    assert.deepEqual(spawned, []);
    await assert.rejects(manager.resumeSession(source), /等待旧账号/);
    await manager.finishProfileHandoff("h", "one", "account-target", "codex", source);
    assert.deepEqual(spawned, ["account-target"]);
  } finally { manager.close(); }
});

class FakeAppServerChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
    this.messages = [];
    this.buffer = "";
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        this.messages.push(message);
        this.#handleClientMessage(message);
      }
    });
  }

  send(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill() {
    this.killed = true;
    this.emit("exit", 0, null);
  }

  #handleClientMessage(message) {
    if (message.method === "initialize") {
      this.send({
        id: message.id,
        result: {
          userAgent: "codex-cli/0.141.0 (scope test)",
          codexHome: "/home/test/.codex",
          platformFamily: "unix",
          platformOs: "linux",
        },
      });
    }
    if (message.method === "thread/resume") {
      this.send({
        id: message.id,
        result: {
          thread: {
            id: message.params.threadId,
            path: message.params.path,
            cwd: message.params.cwd,
            status: { type: "idle" },
          },
          model: message.params.model || "model-default",
          cwd: message.params.cwd,
        },
      });
    }
    if (message.method === "thread/start") {
      this.send({
        id: message.id,
        result: {
          thread: {
            id: "thread-new",
            path: "/home/test/.codex/sessions/thread-new.jsonl",
            cwd: message.params.cwd,
            status: { type: "idle" },
          },
          model: message.params.model || "model-default",
          cwd: message.params.cwd,
        },
      });
    }
    if (message.method === "thread/fork") {
      this.send({
        id: message.id,
        result: {
          thread: {
            id: `${message.params.threadId}-fork`,
            path: `/home/test/.codex/sessions/${message.params.threadId}-fork.jsonl`,
            cwd: message.params.cwd,
            status: { type: "idle" },
          },
          model: message.params.model || "model-default",
          cwd: message.params.cwd,
        },
      });
    }
    if (message.method === "turn/start") {
      this.send({
        id: message.id,
        result: {
          turn: { id: "turn-new", status: "inProgress" },
        },
      });
    }
    if (message.method === "turn/steer") {
      this.send({
        id: message.id,
        result: {
          turn: { id: message.params.expectedTurnId, status: "inProgress" },
        },
      });
    }
    if (message.method === "thread/compact/start") {
      this.send({
        id: message.id,
        result: { threadId: message.params.threadId },
      });
    }
    if (message.method === "thread/inject_items") {
      this.send({ id: message.id, result: {} });
    }
    if (message.method === "thread/unsubscribe") {
      this.send({ id: message.id, result: {} });
    }
    if (message.method === "thread/read") {
      this.send({
        id: message.id,
        result: {
          thread: {
            id: message.params.threadId,
            turns: [{ id: "turn-new", status: "inProgress", items: [] }],
          },
        },
      });
    }
    if (message.method === "turn/interrupt") {
      this.send({ id: message.id, result: {} });
    }
    if (message.method === "thread/unarchive") {
      this.send({
        id: message.id,
        result: {
          thread: {
            id: message.params.threadId,
            path: `/home/test/.codex/sessions/${message.params.threadId}.jsonl`,
          },
        },
      });
    }
    if (message.method === "model/list") {
      this.send({
        id: message.id,
        result: {
          data: [
            {
              id: "model-default",
              model: "model-default",
              displayName: "GPT-5.6 Sol",
              description: "test model",
              isDefault: true,
              hidden: false,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "Balanced" },
                { reasoningEffort: "high", description: "Thorough" },
              ],
            },
          ],
          nextCursor: null,
        },
      });
    }
    if (message.method === "account/read") {
      this.send({
        id: message.id,
        result: {
          account: {
            type: "chatgpt",
            email: "dev@example.com",
            planType: "pro",
          },
          requiresOpenaiAuth: true,
        },
      });
    }
  }
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("validates requestUserInput protocol fields and answer payloads", () => {
  const request = parseUserInputRequest(
    "gpu-a",
    {
      id: 17,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        autoResolutionMs: 60_000,
        questions: [
          {
            id: "allocation",
            header: "GPU 分配",
            question: "优先运行哪个实验？",
            isOther: true,
            isSecret: false,
            options: [
              {
                label: "A (Recommended)",
                description: "继续短评测。",
              },
              {
                label: "B",
                description: "切换到 long run。",
              },
            ],
          },
        ],
      },
    },
    Date.parse("2026-07-23T10:00:00.000Z"),
  );

  assert.equal(request.key, inputRequestKey("gpu-a", 17));
  assert.equal(request.questions[0].options.length, 2);
  assert.equal(request.expiresAt, "2026-07-23T10:01:00.000Z");
  assert.deepEqual(
    normalizeUserInputAnswers(request, {
      allocation: { answers: ["A (Recommended)"] },
    }),
    {
      answers: {
        allocation: { answers: ["A (Recommended)"] },
      },
    },
  );
  assert.throws(
    () =>
      normalizeUserInputAnswers(request, {
        unknown: { answers: ["x"] },
      }),
    /未知的问题 ID/,
  );
});

test("resumes a thread, receives Plan mode choices, and replies to the exact RPC id", async () => {
  const children = [];
  let now = Date.parse("2026-07-23T10:00:00.000Z");
  const manager = new AppServerManager({
    spawnConnection() {
      const child = new FakeAppServerChild();
      children.push(child);
      return child;
    },
    requestTimeoutMs: 1_000,
    now: () => now,
  });

  const session = await manager.resumeSession({
    host: "gpu-a",
    sessionId: "thread-1",
    path: "/home/test/.codex/sessions/thread-1.jsonl",
    cwd: "/workspace/project",
    model: "gpt-5.4-mini",
    executable: "/usr/local/bin/codex",
  });
  assert.equal(session.status, "idle");
  assert.equal(session.model, "gpt-5.4-mini");
  assert.equal(manager.publicState().connections[0].status, "connected");
  assert.deepEqual(
    children[0].messages.slice(0, 3).map((message) => message.method),
    ["initialize", "initialized", "thread/resume"],
  );
  assert.equal(children[0].messages[2].params.model, "gpt-5.4-mini");
  assert.equal(children[0].messages[2].params.approvalPolicy, "never");
  assert.equal(children[0].messages[2].params.sandbox, "danger-full-access");

  children[0].send({
    id: "server-request-9",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      turnId: "turn-2",
      itemId: "item-3",
      autoResolutionMs: null,
      questions: [
        {
          id: "strategy",
          header: "实验策略",
          question: "下一步怎么做？",
          isOther: true,
          isSecret: false,
          options: [
            {
              label: "继续 (Recommended)",
              description: "保持当前资源分配。",
            },
            {
              label: "暂停",
              description: "保存 checkpoint 后释放 GPU。",
            },
          ],
        },
      ],
    },
  });
  await nextTurn();

  const pending = manager.publicState().pendingInputs;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].threadId, "thread-1");
  assert.equal(pending[0].questions[0].options[0].label, "继续 (Recommended)");

  await manager.answerInput(pending[0].key, {
    strategy: { answers: ["继续 (Recommended)"] },
  });
  const response = children[0].messages.at(-1);
  assert.deepEqual(response, {
    id: "server-request-9",
    result: {
      answers: {
        strategy: { answers: ["继续 (Recommended)"] },
      },
    },
  });
  assert.equal(manager.publicState().pendingInputs.length, 0);

  now += 1_000;
  manager.close();
});

test("does not expose expired prompts as answerable", async () => {
  let now = Date.parse("2026-07-23T10:00:00.000Z");
  let child;
  const manager = new AppServerManager({
    spawnConnection() {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
    now: () => now,
  });
  await manager.prepareHost("gpu-a");
  child.send({
    id: 22,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      turnId: "turn-2",
      itemId: "item-3",
      autoResolutionMs: 500,
      questions: [
        {
          id: "confirm",
          header: "确认",
          question: "继续吗？",
          options: null,
        },
      ],
    },
  });
  await nextTurn();
  const key = inputRequestKey("gpu-a", 22);
  now += 501;
  assert.equal(manager.publicState().pendingInputs.length, 0);
  await assert.rejects(
    manager.answerInput(key, {
      confirm: { answers: ["继续"] },
    }),
    /失效|已回答|超时/,
  );
  manager.close();
});

test("creates YOLO web tasks, sends instructions, and compacts through v2 methods", async () => {
  let child;
  const manager = new AppServerManager({
    spawnConnection() {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
  });

  const session = await manager.createSession({
    host: "gpu-a",
    cwd: "/workspace/paper",
    prompt: "汇总当前实验并继续。",
    model: "model-default",
    effort: "high",
  });
  assert.equal(session.sessionId, "thread-new");
  const start = child.messages.find((message) => message.method === "thread/start");
  assert.equal(start.params.approvalPolicy, "never");
  assert.equal(start.params.sandbox, "danger-full-access");
  assert.equal(start.params.cwd, "/workspace/paper");

  const firstTurn = child.messages.find(
    (message) => message.method === "turn/start",
  );
  assert.equal(firstTurn.params.threadId, "thread-new");
  assert.equal(firstTurn.params.input[0].text, "汇总当前实验并继续。");
  assert.equal(firstTurn.params.effort, "high");
  assert.equal(firstTurn.params.approvalPolicy, "never");
  assert.deepEqual(firstTurn.params.sandboxPolicy, {
    type: "dangerFullAccess",
  });

  await manager.startTurn("gpu-a", "thread-new", "只汇报最新指标。");
  await manager.startTurn("gpu-a", "thread-new", "比较附件里的曲线。", {
    attachments: [
      {
        name: "reward.png",
        mimeType: "image/png",
        size: 1024,
        kind: "image",
        remotePath: "/home/test/.codex/scope-attachments/reward.png",
      },
      {
        name: "metrics.csv",
        mimeType: "text/csv",
        size: 512,
        kind: "file",
        remotePath: "/home/test/.codex/scope-attachments/metrics.csv",
      },
    ],
  });
  const attachmentTurn = child.messages
    .filter((message) => message.method === "turn/start")
    .at(-1);
  assert.match(attachmentTurn.params.input[0].text, /metrics\.csv/);
  assert.deepEqual(attachmentTurn.params.input[1], {
    type: "localImage",
    path: "/home/test/.codex/scope-attachments/reward.png",
  });
  await manager.compactSession("gpu-a", "thread-new");
  assert.deepEqual(
    child.messages
      .filter((message) =>
        ["turn/start", "thread/compact/start"].includes(message.method),
      )
      .map((message) => message.method),
    ["turn/start", "turn/start", "turn/start", "thread/compact/start"],
  );
  manager.close();
});

test("steers additional context into the current active turn", async () => {
  let child;
  const manager = new AppServerManager({
    spawnConnection() {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
  });
  await manager.resumeSession({
    host: "gpu-steer",
    sessionId: "thread-steer",
    path: "/sessions/thread-steer.jsonl",
    cwd: "/workspace/steer",
  });
  child.send({
    method: "turn/started",
    params: {
      threadId: "thread-steer",
      turn: { id: "turn-new", status: "inProgress", items: [] },
    },
  });
  await nextTurn();

  await manager.steerTurn("gpu-steer", "thread-steer", "read the shared spec");
  assert.equal(
    child.messages.some(
      (message) =>
        message.method === "turn/steer" &&
        message.params.threadId === "thread-steer" &&
        message.params.expectedTurnId === "turn-new" &&
        message.params.input[0].text === "read the shared spec",
    ),
    true,
  );
  manager.close();
});

test("host model changes are isolated, preserve effort, and defer busy or offline sessions", async () => {
  const children = new Map();
  const manager = new AppServerManager({ spawnConnection(host) {
    const child = new FakeAppServerChild(); children.set(host, child); return child;
  }});
  for (const [host, sessionId, effort] of [["a", "idle", "high"], ["a", "busy", "max"], ["a", "offline", "minimal"], ["b", "other", "medium"]]) {
    await manager.resumeSession({ host, sessionId, cwd: "/work", model: "old", effort });
  }
  manager.sessions.get("a:busy").status = "working";
  manager.sessions.get("a:offline").status = "offline";
  const before = children.get("a").messages.length;
  const results = await manager.setHostModel("a", { id: "o3", model: "o3",
    supportedReasoningEfforts: ["low", "medium", "high", "max"], defaultReasoningEffort: "medium" });
  assert.deepEqual(results.map((item) => [item.sessionId, item.status, item.effort]),
    [["idle", "applied", "high"], ["busy", "next-turn", "max"], ["offline", "next-turn", "medium"]]);
  assert.equal(manager.sessions.get("b:other").model, "old");
  assert.equal(manager.sessions.get("a:busy").status, "working");
  assert.deepEqual(children.get("a").messages.slice(before).filter((item) => item.method === "thread/resume").map((item) => item.params.threadId), ["idle"]);
  await manager.startTurn("a", "busy", "next");
  const turn = children.get("a").messages.findLast((item) => item.method === "turn/start");
  assert.equal(turn.params.model, "o3");
  assert.equal(turn.params.effort, "max");
  assert.ok(!children.get("a").messages.some((item) => item.method === "turn/interrupt"));
  manager.close();
});

test("lists host models and persists a model override on a managed session", async () => {
  const children = [];
  const manager = new AppServerManager({
    spawnConnection: () => {
      const child = new FakeAppServerChild();
      children.push(child);
      return child;
    },
  });
  await manager.resumeSession({
    host: "gpu-model",
    sessionId: "thread-model",
    path: "/home/test/.codex/sessions/thread-model.jsonl",
    cwd: "/workspace/model",
  });
  const models = await manager.listModels("gpu-model");
  assert.deepEqual(models.map((model) => model.id), ["model-default"]);
  assert.deepEqual(models[0].supportedReasoningEfforts, ["medium", "high"]);
  const session = await manager.setSessionModel(
    "gpu-model",
    "thread-model",
    "model-default",
    "high",
  );
  assert.equal(session.model, "model-default");
  assert.equal(session.effort, "high");
  const modelResume = children[0].messages.find(
    (message, index) =>
      index > 0 &&
      message.method === "thread/resume" &&
      message.params.model === "model-default",
  );
  assert.ok(modelResume);
  assert.equal(modelResume.params.approvalPolicy, "never");
  assert.equal(modelResume.params.sandbox, "danger-full-access");
  await manager.startTurn("gpu-model", "thread-model", "use selected model");
  const modelTurn = children[0].messages.find(
    (message) =>
      message.method === "turn/start" &&
      message.params.model === "model-default",
  );
  assert.ok(modelTurn);
  assert.equal(modelTurn.params.effort, "high");
  assert.deepEqual(modelTurn.params.sandboxPolicy, {
    type: "dangerFullAccess",
  });
  manager.close();
});

test("creates guarded web tasks and keeps the selected policy on later turns", async () => {
  let child;
  const manager = new AppServerManager({
    spawnConnection() {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
  });

  const session = await manager.createSession({
    host: "gpu-guarded",
    cwd: "/workspace/guarded",
    prompt: "inspect only",
    yolo: false,
  });
  assert.equal(session.yolo, false);
  const start = child.messages.find((message) => message.method === "thread/start");
  assert.equal(start.params.approvalPolicy, "on-request");
  assert.equal(start.params.sandbox, "workspace-write");
  const turn = child.messages.find((message) => message.method === "turn/start");
  assert.equal(turn.params.approvalPolicy, "on-request");
  assert.deepEqual(turn.params.sandboxPolicy, { type: "workspaceWrite" });

  manager.close();
});

test("manager read-only policy survives create, resume and subsequent turns", async () => {
  let child;
  const manager = new AppServerManager({ spawnConnection() { child = new FakeAppServerChild(); return child; }, requestTimeoutMs: 1000 });
  try {
    const session = await manager.createSession({ host: "manager", cwd: "/control", readOnly: true, prompt: "plan" });
    assert.equal(session.readOnly, true);
    assert.equal(child.messages.find(m => m.method === "thread/start").params.sandbox, "read-only");
    await manager.resumeSession({ host: "manager", sessionId: session.sessionId, cwd: "/control", yolo: true });
    assert.equal(child.messages.filter(m => m.method === "thread/resume").at(-1).params.sandbox, "read-only");
    await manager.startTurn("manager", session.sessionId, "continue planning");
    for (const turn of child.messages.filter(m => m.method === "turn/start")) {
      assert.equal(turn.params.approvalPolicy, "never");
      assert.deepEqual(turn.params.sandboxPolicy, { type: "readOnly" });
    }
    assert.equal(manager.sessionRecords()[0].readOnly, true);
  } finally { manager.close(); }
});

test("auto-compaction notifications do not finish or interrupt an active turn", async () => {
  let child;
  const manager = new AppServerManager({
    spawnConnection() { child = new FakeAppServerChild(); return child; },
    requestTimeoutMs: 1_000,
  });
  await manager.resumeSession({ host: "compact-host", sessionId: "compact-thread",
    path: "/home/test/.codex/sessions/compact-thread.jsonl", cwd: "/workspace" });
  child.send({ method: "turn/started", params: { threadId: "compact-thread", turn: { id: "turn-1", status: "inProgress" } } });
  child.send({ method: "item/started", params: { threadId: "compact-thread", turnId: "turn-1", item: { id: "compact-1", type: "contextCompaction" } } });
  child.send({ method: "item/completed", params: { threadId: "compact-thread", turnId: "turn-1", item: { id: "compact-1", type: "contextCompaction" } } });
  child.send({ method: "thread/compacted", params: { threadId: "compact-thread", turnId: "turn-1" } });
  await nextTurn();
  const during = manager.publicState().sessions.find((s) => s.sessionId === "compact-thread");
  assert.equal(during.status, "working");
  assert.equal(during.activeTurnId, "turn-1");
  assert.equal(child.messages.some((m) => m.method === "turn/interrupt"), false);
  child.send({ method: "turn/completed", params: { threadId: "compact-thread", turn: { id: "turn-1", status: "completed" } } });
  await nextTurn();
  assert.equal(manager.publicState().sessions.find((s) => s.sessionId === "compact-thread").status, "idle");
  manager.close();
});

test("automatically continues the same app-server thread after model capacity", async () => {
  let child;
  let now = Date.parse("2026-08-11T09:00:00.000Z");
  const timers = [];
  const manager = new AppServerManager({
    spawnConnection() {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
    now: () => now,
    capacityRetryDelaysMs: [3_000, 10_000],
    setTimer(callback, delay) {
      const timer = {
        callback,
        delay,
        cleared: false,
        unref() {},
      };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timer.cleared = true;
    },
  });
  await manager.resumeSession({
    host: "gpu-capacity",
    sessionId: "thread-capacity",
    path: "/home/test/.codex/sessions/thread-capacity.jsonl",
    cwd: "/workspace/capacity",
  });

  const failure = {
    message: "Selected model is at capacity. Please try a different model.",
    codexErrorInfo: { httpStatusCode: 429 },
  };
  child.send({
    method: "error",
    params: {
      threadId: "thread-capacity",
      turnId: "turn-capacity-1",
      error: failure,
    },
  });
  child.send({
    method: "turn/completed",
    params: {
      threadId: "thread-capacity",
      turn: { id: "turn-capacity-1", status: "failed", error: failure },
    },
  });
  await nextTurn();

  const scheduled = manager.publicState().sessions[0].capacityRecovery;
  assert.equal(scheduled.status, "scheduled");
  assert.equal(scheduled.attempt, 1);
  assert.equal(timers.filter((timer) => !timer.cleared).length, 1);
  assert.equal(timers.find((timer) => !timer.cleared).delay, 3_000);

  now += 3_000;
  await timers.find((timer) => !timer.cleared).callback();
  await nextTurn();
  const continueTurn = child.messages
    .filter((message) => message.method === "turn/start")
    .at(-1);
  assert.equal(continueTurn.params.threadId, "thread-capacity");
  assert.equal(continueTurn.params.input[0].text, "继续");
  assert.equal(manager.publicState().sessions[0].capacityRecovery.status, "sent");

  child.send({
    method: "turn/completed",
    params: {
      threadId: "thread-capacity",
      turn: { id: "turn-recovered", status: "completed" },
    },
  });
  await nextTurn();
  assert.equal(manager.publicState().sessions[0].capacityRecovery, null);
  manager.close();
});

test("connection-specific capacity policy stops at 100; other writers still stop at five", async () => {
  for (const limit of [100, 5]) {
    let child;
    const timers = [];
    const manager = new AppServerManager({
      spawnConnection() { child = new FakeAppServerChild(); return child; },
      resolveCapacityRetryDelays: async () => Array.from({ length: limit }, (_, i) => [3000, 10000, 30000, 60000][i] ?? 120000),
      setTimer(callback, delay) { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer; },
      clearTimer() {},
    });
    await manager.resumeSession({ host: "gpu", sessionId: "thread-policy", path: "/tmp/thread.jsonl", cwd: "/workspace" });
    try {
      for (let attempt = 1; attempt <= limit + 1; attempt++) {
        child.send({ method: "turn/completed", params: { threadId: "thread-policy", turn: {
          id: `failed-${attempt}`, status: "failed", error: { message: "Selected model is at capacity" },
        } } });
        await nextTurn();
        const recovery = manager.publicState().sessions[0].capacityRecovery;
        assert.equal(recovery.maxAttempts, limit);
        if (attempt > limit) {
          assert.equal(recovery.status, "exhausted");
          assert.equal(timers.length, limit);
          break;
        }
        assert.equal(recovery.attempt, attempt);
        assert.equal(recovery.status, "scheduled");
        if (attempt >= 5) assert.equal(timers.at(-1).delay, 120000);
        await timers.at(-1).callback();
        await nextTurn();
      }
      assert.equal(child.messages.filter((m) => m.method === "turn/start").length, limit);
    } finally { manager.close(); }
  }
});

test("unapproved accounts never auto-continue capacity or backend errors, but manual sends work", async () => {
  for (const message of ["Selected model is at capacity", "unexpected status 503 url: https://chatgpt.com/backend-api/codex/responses"]) {
    let child; const timers = [];
    const manager = new AppServerManager({ spawnConnection: () => (child = new FakeAppServerChild()),
      resolveCapacityRetryDelays: async () => [],
      setTimer: (callback) => { timers.push(callback); return { unref() {} }; } });
    try {
      await manager.resumeSession({ host: "h", sessionId: "s", cwd: "/work" });
      child.send({ method: "turn/completed", params: { threadId: "s", turn: { id: "failed", status: "failed", error: { message } } } });
      await nextTurn();
      assert.equal(timers.length, 0);
      await assert.rejects(manager.startTurn("h", "s", "继续", { automaticRecovery: true }), /未获准自动继续/);
      assert.equal(child.messages.filter((m) => m.method === "turn/start").length, 0);
      await manager.startTurn("h", "s", "manual work");
      assert.equal(child.messages.filter((m) => m.method === "turn/start").length, 1);
    } finally { manager.close(); }
  }
});

test("scheduled auto-continuation rechecks actual account before sending", async () => {
  let child, allowed = true; const timers = [];
  const manager = new AppServerManager({ spawnConnection: () => (child = new FakeAppServerChild()),
    resolveCapacityRetryDelays: async () => allowed ? [1] : [],
    setTimer: (callback) => { timers.push(callback); return { unref() {} }; }, clearTimer() {} });
  try {
    await manager.resumeSession({ host: "h", sessionId: "s", cwd: "/work" });
    child.send({ method: "turn/completed", params: { threadId: "s", turn: { id: "f", status: "failed", error: { message: "Selected model is at capacity" } } } });
    await nextTurn(); assert.equal(timers.length, 1);
    allowed = false;
    await timers[0]();
    assert.equal(child.messages.filter((m) => m.method === "turn/start").length, 0);
  } finally { manager.close(); }
});

test("unavailable capacity profile lookup disables automatic retries", async () => {
  const manager = new AppServerManager({
    spawnConnection: () => new FakeAppServerChild(),
    resolveCapacityRetryDelays: async () => { throw new Error("offline"); },
  });
  try {
    const connection = await manager.prepareHost("gpu");
    assert.deepEqual(connection.capacityRetryDelaysMs, []);
    assert.equal(manager.capacityRetryDelaysMs.length, 5);
  } finally { manager.close(); }
});

test("does not auto-continue non-capacity app-server failures", async () => {
  let child;
  const timers = [];
  const manager = new AppServerManager({
    spawnConnection() {
      child = new FakeAppServerChild();
      return child;
    },
    setTimer(callback, delay) {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
  });
  await manager.resumeSession({
    host: "gpu-error",
    sessionId: "thread-error",
    cwd: "/workspace/error",
  });
  child.send({
    method: "turn/completed",
    params: {
      threadId: "thread-error",
      turn: {
        id: "turn-error",
        status: "failed",
        error: { message: "context window exceeded" },
      },
    },
  });
  await nextTurn();
  assert.equal(timers.length, 0);
  assert.equal(manager.publicState().sessions[0].status, "attention");
  manager.close();
});

test("retries a transient Codex Responses endpoint failure with continue", async () => {
  let child;
  const timers = [];
  const manager = new AppServerManager({
    spawnConnection() {
      child = new FakeAppServerChild();
      return child;
    },
    transientRetryDelaysMs: [2_000],
    setTimer(callback, delay) {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timer.cleared = true;
    },
  });
  await manager.resumeSession({
    host: "backend-retry",
    sessionId: "thread-backend-retry",
    cwd: "/workspace/retry",
  });
  const failure = {
    message:
      "unexpected status 404 Not Found: Unknown error, url: https://chatgpt.com/backend-api/codex/responses",
  };
  child.send({
    method: "turn/completed",
    params: {
      threadId: "thread-backend-retry",
      turn: { id: "turn-backend-retry", status: "failed", error: failure },
    },
  });
  await nextTurn();
  const recovery = manager.publicState().sessions[0].capacityRecovery;
  assert.equal(recovery.kind, "backend");
  assert.equal(recovery.status, "scheduled");
  assert.equal(timers.find((timer) => !timer.cleared).delay, 2_000);
  await timers.find((timer) => !timer.cleared).callback();
  await nextTurn();
  assert.equal(
    child.messages.filter((message) => message.method === "turn/start").at(-1)
      .params.input[0].text,
    "继续",
  );
  manager.close();
});

test("releases an idle app-server session before handing it to tmux", async () => {
  let child;
  const manager = new AppServerManager({
    spawnConnection: () => {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
  });
  await manager.resumeSession({
    host: "gpu-switch",
    sessionId: "thread-switch",
    path: "/home/test/.codex/sessions/thread-switch.jsonl",
    cwd: "/workspace/switch",
  });

  const released = await manager.releaseSession("gpu-switch", "thread-switch");

  assert.equal(released.sessionId, "thread-switch");
  assert.equal(manager.isManaged("gpu-switch", "thread-switch"), false);
  assert.ok(
    child.messages.some(
      (message) =>
        message.method === "thread/unsubscribe" &&
        message.params.threadId === "thread-switch",
    ),
  );
  assert.equal(child.killed, false);
  manager.close();
});

test("stopping generation keeps the chat managed and ready for the next message", async () => {
  const child = new FakeAppServerChild();
  const manager = new AppServerManager({spawnConnection:()=>child,requestTimeoutMs:1000});
  try {
    for (const id of ['one','two']) {
      await manager.resumeSession({host:'h',sessionId:id,cwd:'/work'});
      await manager.startTurn('h',id,'work');
    }
    const result = await manager.interruptTurn('h','one');
    assert.equal(result.interrupted,true);
    assert.equal(manager.isManaged('h','one'),true);
    assert.equal(manager.sessionRecords().find(s=>s.sessionId==='two').status,'working');
    assert.equal(child.messages.some(m=>['thread/unsubscribe','thread/archive'].includes(m.method)),false);
    assert.equal(child.messages.filter(m=>m.method==='turn/interrupt').length,1);
    assert.equal(child.messages.find(m=>m.method==='turn/interrupt').params.threadId,'one');
    assert.equal(child.killed,false);
    await manager.startTurn('h','one','continue');
    assert.equal(manager.sessionRecords().find(s=>s.sessionId==='one').status,'working');
    await assert.rejects(manager.interruptTurn('h','missing'),/未连接/);
  } finally {manager.close();}
});

test("stops exactly one idle app-server session without archiving its rollout", async () => {
  let child;
  const released = [];
  const manager = new AppServerManager({
    spawnConnection: () => {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
  });
  manager.on("session-release", (event) => released.push(event));
  await manager.resumeSession({
    host: "gpu-close",
    sessionId: "thread-close",
    path: "/home/test/.codex/sessions/thread-close.jsonl",
    cwd: "/workspace/close",
  });
  await manager.resumeSession({
    host: "gpu-close",
    sessionId: "thread-sibling",
    path: "/home/test/.codex/sessions/thread-sibling.jsonl",
    cwd: "/workspace/sibling",
  });

  const result = await manager.stopSession("gpu-close", "thread-close");

  assert.equal(result.stopped, true);
  assert.equal(result.interrupted, false);
  assert.equal(manager.isManaged("gpu-close", "thread-close"), false);
  assert.equal(manager.isManaged("gpu-close", "thread-sibling"), true);
  assert.deepEqual(released, [
    {
      host: "gpu-close",
      sessionId: "thread-close",
      reason: "stop",
      record: released[0].record,
    },
  ]);
  assert.ok(
    child.messages.some(
      (message) =>
        message.method === "thread/unsubscribe" &&
        message.params.threadId === "thread-close",
    ),
  );
  assert.equal(child.messages.some((message) => message.method === "thread/archive"), false);
  assert.equal(child.killed, false);
  assert.equal(released[0].record.resumeOnRecovery, false);
  await manager.resumeSession(released[0].record);
  assert.equal(manager.isManaged("gpu-close", "thread-close"), true);
  assert.equal(child.messages.filter((m) => m.method === "turn/start").length, 0);
  manager.close();
});

test("interrupts a running turn before stopping its app-server session", async () => {
  let child;
  const manager = new AppServerManager({
    spawnConnection: () => {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
  });
  await manager.resumeSession({
    host: "gpu-busy-close",
    sessionId: "thread-busy-close",
    path: "/home/test/.codex/sessions/thread-busy-close.jsonl",
    cwd: "/workspace/busy-close",
  });
  await manager.startTurn(
    "gpu-busy-close",
    "thread-busy-close",
    "keep working",
  );

  const result = await manager.stopSession(
    "gpu-busy-close",
    "thread-busy-close",
  );
  assert.equal(result.stopped, true);
  assert.equal(result.interrupted, true);
  assert.equal(
    child.messages.some((message) => message.method === "thread/archive"),
    false,
  );
  const interruptIndex = child.messages.findIndex(
    (message) =>
      message.method === "turn/interrupt" &&
      message.params.threadId === "thread-busy-close" &&
      message.params.turnId === "turn-new",
  );
  const unsubscribeIndex = child.messages.findIndex(
    (message) =>
      message.method === "thread/unsubscribe" &&
      message.params.threadId === "thread-busy-close",
  );
  assert.ok(interruptIndex >= 0);
  assert.ok(unsubscribeIndex > interruptIndex);
  assert.equal(manager.isManaged("gpu-busy-close", "thread-busy-close"), false);
  manager.close();
});

test("unarchives a rollout without managing or starting the session", async () => {
  let child;
  const manager = new AppServerManager({
    spawnConnection: () => {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
  });

  const thread = await manager.unarchiveSession("gpu-recover", "thread-old");

  assert.equal(thread.id, "thread-old");
  assert.match(thread.path, /\.codex\/sessions\/thread-old\.jsonl$/);
  assert.equal(manager.isManaged("gpu-recover", "thread-old"), false);
  assert.ok(
    child.messages.some(
      (message) =>
        message.method === "thread/unarchive" &&
        message.params.threadId === "thread-old",
    ),
  );
  assert.equal(child.killed, false);
  manager.close();
});

test("releases a stale offline app-server record without requiring unsubscribe", async () => {
  let child;
  const manager = new AppServerManager({
    spawnConnection: () => {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
  });
  await manager.resumeSession({
    host: "gpu-offline",
    sessionId: "thread-offline",
    path: "/home/test/.codex/sessions/thread-offline.jsonl",
    cwd: "/workspace/offline",
  });
  assert.equal(manager.isConnected("gpu-offline", "thread-offline"), true);

  manager.closeHost("gpu-offline");
  assert.equal(manager.isManaged("gpu-offline", "thread-offline"), true);
  assert.equal(manager.isConnected("gpu-offline", "thread-offline"), false);
  const unsubscribeCount = child.messages.filter(
    (message) => message.method === "thread/unsubscribe",
  ).length;

  const released = await manager.releaseSession(
    "gpu-offline",
    "thread-offline",
  );

  assert.equal(released.releasedOffline, true);
  assert.equal(manager.isManaged("gpu-offline", "thread-offline"), false);
  assert.equal(
    child.messages.filter((message) => message.method === "thread/unsubscribe")
      .length,
    unsubscribeCount,
  );
  manager.close();
});

test("preserves interrupted work intent until a recovered turn completes", async () => {
  const children = [];
  const manager = new AppServerManager({
    spawnConnection() {
      const child = new FakeAppServerChild();
      children.push(child);
      return child;
    },
    requestTimeoutMs: 1_000,
  });

  await manager.resumeSession({
    host: "gpu-recovery",
    sessionId: "thread-recovery",
    path: "/home/test/.codex/sessions/thread-recovery.jsonl",
    cwd: "/workspace/recovery",
  });
  await manager.startTurn("gpu-recovery", "thread-recovery", "run work");
  assert.equal(manager.sessionRecords()[0].resumeOnRecovery, true);

  manager.closeHost("gpu-recovery");
  const interrupted = manager.sessionRecords()[0];
  assert.equal(interrupted.status, "offline");
  assert.equal(interrupted.resumeOnRecovery, true);

  const resumed = await manager.resumeSession({
    host: "gpu-recovery",
    sessionId: "thread-recovery",
    path: interrupted.path,
    cwd: interrupted.cwd,
    resumeOnRecovery: interrupted.resumeOnRecovery,
  });
  assert.equal(resumed.status, "idle");
  assert.equal(resumed.resumeOnRecovery, true);

  await manager.startTurn("gpu-recovery", "thread-recovery", "继续");
  children.at(-1).send({
    method: "turn/completed",
    params: {
      threadId: "thread-recovery",
      turn: { id: "turn-new", status: "completed" },
    },
  });
  await nextTurn();
  assert.equal(manager.sessionRecords()[0].resumeOnRecovery, false);
});

test("routes sessions on one SSH host through their owning app-server daemons", async () => {
  const children = new Map();
  const manager = new AppServerManager({
    spawnConnection(host, executable, connectionKey) {
      const child = new FakeAppServerChild();
      children.set(connectionKey, child);
      return child;
    },
    requestTimeoutMs: 1_000,
  });

  await manager.resumeSession({
    host: "gpu-profiled",
    sessionId: "thread-current",
    path: "/sessions/thread-current.jsonl",
    cwd: "/workspace/current",
    connectionKey: "active",
  });
  await manager.resumeSession({
    host: "gpu-profiled",
    sessionId: "thread-legacy",
    path: "/sessions/thread-legacy.jsonl",
    cwd: "/workspace/legacy",
    connectionKey: "profile-old",
  });

  assert.deepEqual(
    manager
      .publicState()
      .connections.map((connection) => connection.connectionKey)
      .sort(),
    ["active", "profile-old"],
  );
  await manager.startTurn("gpu-profiled", "thread-legacy", "continue legacy");
  assert.equal(
    children
      .get("profile-old")
      .messages.some(
        (message) =>
          message.method === "turn/start" &&
          message.params.threadId === "thread-legacy",
      ),
    true,
  );
  assert.equal(
    children
      .get("active")
      .messages.some((message) => message.method === "turn/start"),
    false,
  );
});

test("migrates an auth-interrupted session to the active writer and preserves continuation intent", async () => {
  const children = new Map();
  const failures = [];
  const turnFailures = [];
  const manager = new AppServerManager({
    spawnConnection(host, executable, connectionKey) {
      const child = new FakeAppServerChild();
      children.set(connectionKey, child);
      return child;
    },
    requestTimeoutMs: 1_000,
  });
  manager.on("authentication-failure", (failure) => failures.push(failure));
  manager.on("turn-failure", (failure) => turnFailures.push(failure));
  await manager.resumeSession({
    host: "gpu-auth",
    sessionId: "thread-auth",
    path: "/sessions/thread-auth.jsonl",
    cwd: "/workspace/auth",
    connectionKey: "profile-old",
  });
  children.get("profile-old").send({
    method: "turn/completed",
    params: {
      threadId: "thread-auth",
      turn: {
        id: "turn-auth",
        status: "failed",
        error: {
          message:
            "Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.\nunauthorized",
        },
      },
    },
  });
  await nextTurn();
  assert.equal(manager.sessionRecords()[0].resumeOnRecovery, true);
  assert.equal(failures.length, 1);
  assert.equal(turnFailures.length, 1);
  assert.equal(turnFailures[0].authenticationFailure, true);

  const migrated = await manager.migrateSessionConnection(
    "gpu-auth",
    "thread-auth",
    "active",
  );
  assert.equal(migrated.connectionKey, "active");
  assert.equal(migrated.resumeOnRecovery, true);
  assert.equal(
    children
      .get("profile-old")
      .messages.some(
        (message) =>
          message.method === "thread/unsubscribe" &&
          message.params.threadId === "thread-auth",
      ),
    true,
  );
  await manager.startTurn("gpu-auth", "thread-auth", "继续");
  assert.equal(
    children
      .get("active")
      .messages.some(
        (message) =>
          message.method === "turn/start" &&
          message.params.threadId === "thread-auth" &&
          message.params.input[0].text === "继续",
      ),
    true,
  );
});

test("forks an interrupted thread onto the active profile when its old writer cannot release it", async () => {
  const children = new Map();
  const released = [];
  const manager = new AppServerManager({
    spawnConnection(host, executable, connectionKey) {
      const child = new FakeAppServerChild();
      children.set(connectionKey, child);
      return child;
    },
    requestTimeoutMs: 1_000,
  });
  manager.on("session-release", (event) => released.push(event));
  await manager.resumeSession({
    host: "gpu-fork",
    sessionId: "thread-auth",
    path: "/sessions/thread-auth.jsonl",
    cwd: "/workspace/auth",
    connectionKey: "profile-old",
    resumeOnRecovery: true,
  });

  const forked = await manager.forkSessionConnection(
    "gpu-fork",
    "thread-auth",
    "active",
  );
  assert.equal(forked.sessionId, "thread-auth-fork");
  assert.equal(forked.connectionKey, "active");
  assert.equal(forked.forkedFromSessionId, "thread-auth");
  assert.equal(manager.isManaged("gpu-fork", "thread-auth"), false);
  assert.equal(manager.isManaged("gpu-fork", "thread-auth-fork"), true);
  assert.equal(released[0].replacementSessionId, "thread-auth-fork");
  assert.equal(
    children.get("active").messages.some(
      (message) =>
        message.method === "thread/fork" &&
        message.params.threadId === "thread-auth",
    ),
    true,
  );
});

test("closes only one profiled app-server connection before daemon retirement", async () => {
  const children = new Map();
  const manager = new AppServerManager({
    spawnConnection(host, executable, connectionKey) {
      const child = new FakeAppServerChild();
      children.set(connectionKey, child);
      return child;
    },
    requestTimeoutMs: 1_000,
  });
  await manager.resumeSession({
    host: "gpu-retire",
    sessionId: "thread-old",
    cwd: "/workspace/old",
    connectionKey: "profile-old",
  });
  await manager.resumeSession({
    host: "gpu-retire",
    sessionId: "thread-current",
    cwd: "/workspace/current",
    connectionKey: "active",
  });

  manager.closeConnection("gpu-retire", "profile-old");

  const sessions = manager.sessionRecords();
  assert.equal(
    sessions.find((session) => session.sessionId === "thread-old").status,
    "offline",
  );
  assert.equal(
    sessions.find((session) => session.sessionId === "thread-current").status,
    "idle",
  );
  assert.equal(children.get("profile-old").stdin.writableEnded, true);
  assert.equal(children.get("active").stdin.writableEnded, false);
});

test("allocates a tmux-bound thread on an isolated app-server transport", async () => {
  let child;
  const manager = new AppServerManager({
    spawnConnection: () => {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
  });

  const session = await manager.createDetachedSession({
    host: "gpu-tmux",
    cwd: "/workspace/tmux",
    model: "model-default",
  });

  assert.equal(session.sessionId, "thread-new");
  assert.equal(manager.isManaged("gpu-tmux", "thread-new"), false);
  assert.deepEqual(
    child.messages.map((message) => message.method),
    [
      "initialize",
      "initialized",
      "thread/start",
      "thread/inject_items",
      "thread/unsubscribe",
    ],
  );
  assert.equal(child.killed, false);
});

test("normalizes every human-facing app-server request type", () => {
  const base = {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    startedAtMs: 1,
  };
  const cases = [
    {
      method: "item/commandExecution/requestApproval",
      params: {
        ...base,
        command: "python train.py",
        cwd: "/workspace/project",
        reason: "needs GPU",
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
      },
      kind: "command-approval",
      response: { decision: "accept" },
      expected: { decision: "accept" },
    },
    {
      method: "item/fileChange/requestApproval",
      params: { ...base, reason: "update config", grantRoot: "/workspace/project" },
      kind: "file-change-approval",
      response: { decision: "acceptForSession" },
      expected: { decision: "acceptForSession" },
    },
    {
      method: "item/permissions/requestApproval",
      params: {
        ...base,
        environmentId: "local",
        cwd: "/workspace/project",
        reason: "read dataset",
        permissions: {
          network: { enabled: true },
          fileSystem: {
            read: ["/datasets"],
            write: null,
          },
        },
      },
      kind: "permissions-approval",
      response: { choice: "grant-turn" },
      expected: {
        permissions: {
          network: { enabled: true },
          fileSystem: { read: ["/datasets"], write: null },
        },
        scope: "turn",
      },
    },
    {
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        serverName: "wandb",
        mode: "form",
        _meta: null,
        message: "Choose a run",
        requestedSchema: {
          type: "object",
          properties: {
            run: {
              type: "string",
              title: "Run",
              enum: ["baseline", "long"],
            },
            retries: {
              type: "integer",
              title: "Retries",
              minimum: 0,
            },
          },
          required: ["run"],
        },
      },
      kind: "mcp-elicitation",
      response: {
        action: "accept",
        content: { run: "baseline", retries: "2" },
      },
      expected: {
        action: "accept",
        content: { run: "baseline", retries: 2 },
        _meta: null,
      },
    },
    {
      method: "execCommandApproval",
      params: {
        conversationId: "thread-1",
        callId: "call-1",
        approvalId: null,
        command: ["python", "train.py"],
        cwd: "/workspace/project",
        reason: null,
        parsedCmd: [],
      },
      kind: "legacy-command-approval",
      response: { decision: "approved" },
      expected: { decision: "approved" },
    },
    {
      method: "applyPatchApproval",
      params: {
        conversationId: "thread-1",
        callId: "call-2",
        fileChanges: {
          "config.yaml": { type: "update", unified_diff: "@@ -1 +1 @@" },
        },
        reason: "update batch size",
        grantRoot: null,
      },
      kind: "legacy-file-change-approval",
      response: { decision: "denied" },
      expected: { decision: "denied" },
    },
  ];

  for (const [index, item] of cases.entries()) {
    const request = parseHumanRequest("gpu-a", {
      id: `request-${index}`,
      method: item.method,
      params: item.params,
    });
    assert.equal(request.kind, item.kind);
    assert.deepEqual(normalizeHumanResponse(request, item.response), item.expected);
  }
});

test("returns JSON-RPC errors for machine requests instead of exposing fake prompts", async () => {
  let child;
  const now = Date.parse("2026-07-23T10:00:00.000Z");
  const manager = new AppServerManager({
    spawnConnection() {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
    now: () => now,
  });
  await manager.prepareHost("gpu-a");
  child.send({
    id: "machine-1",
    method: "attestation/generate",
    params: { nonce: "opaque" },
  });
  await nextTurn();
  assert.deepEqual(child.messages.at(-1), {
    id: "machine-1",
    error: {
      code: -32601,
      message:
        "SCOPE does not provide the machine capability required by attestation/generate",
    },
  });
  assert.equal(manager.publicState().pendingRequests.length, 0);
  child.send({
    id: "clock-1",
    method: "currentTime/read",
    params: { threadId: "thread-1" },
  });
  await nextTurn();
  assert.deepEqual(child.messages.at(-1), {
    id: "clock-1",
    result: { currentTimeAt: Math.floor(now / 1_000) },
  });
  manager.close();
});

test("attaches the authoritative item diff to file approval requests", async () => {
  let child;
  const manager = new AppServerManager({
    spawnConnection() {
      child = new FakeAppServerChild();
      return child;
    },
    requestTimeoutMs: 1_000,
  });
  await manager.prepareHost("gpu-a");
  child.send({
    method: "item/started",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        type: "fileChange",
        id: "item-1",
        changes: [
          {
            path: "/workspace/config.yaml",
            kind: "update",
            diff: "@@ -1 +1 @@\n-batch: 8\n+batch: 16",
          },
        ],
        status: "inProgress",
      },
    },
  });
  child.send({
    id: "file-approval-1",
    method: "item/fileChange/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      startedAtMs: Date.now(),
      reason: "increase batch size",
      grantRoot: null,
    },
  });
  await nextTurn();
  const [request] = manager.publicState().pendingRequests;
  assert.equal(request.fileChanges[0].path, "/workspace/config.yaml");
  assert.match(request.fileChanges[0].preview, /batch: 16/);
  await manager.answerHumanRequest(request.key, { decision: "decline" });
  assert.deepEqual(child.messages.at(-1), {
    id: "file-approval-1",
    result: { decision: "decline" },
  });
  manager.close();
});


test("changing the manager model retains read-only thread policy", async () => {
  let child;
  const manager = new AppServerManager({ spawnConnection: () => (child = new FakeAppServerChild()), requestTimeoutMs: 1000 });
  try {
    await manager.resumeSession({ host: "h", sessionId: "manager", cwd: "/work", readOnly: true });
    await manager.setSessionModel("h", "manager", "next-model", "high", true);
    const resume = child.messages.filter(message => message.method === "thread/resume").at(-1);
    assert.equal(resume.params.sandbox, "read-only");
    assert.equal(resume.params.approvalPolicy, "never");
    assert.equal(manager.sessionRecords()[0].yolo, false);
  } finally { manager.close(); }
});

test("command catalog uses the current session cwd and never forwards CLI slash text as a turn", async () => {
  let child;
  const manager = new AppServerManager({spawnConnection:()=> (child=new FakeAppServerChild()),requestTimeoutMs:1000});
  try {
    await manager.resumeSession({host:"h",sessionId:"commands",cwd:"/project"});
    const connection=await manager.prepareHost("h");
    let request;
    connection.request=async(method,params)=>{request={method,params};return {data:[{skills:[{name:"review",description:"Check files",enabled:true},{name:"disabled",enabled:false}]}]};};
    const commands=await manager.sessionCommands("h","commands");
    assert.deepEqual(request,{method:"skills/list",params:{cwds:["/project"],forceReload:true}});
    assert.deepEqual(commands.map(c=>c.insertion),["$review "]);
    const before=child.messages.length;
    await assert.rejects(manager.startTurn("h","commands","/login"),/斜杠命令/);
    assert.equal(child.messages.length,before);
  } finally {manager.close();}
});
