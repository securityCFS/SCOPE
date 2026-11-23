import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import { once } from "node:events";
import { LOCAL_HOST, workingDirectory } from "../lib/execution-host.js";
import { projectIdentity } from "../lib/projects.js";
import {
  defaultWorkbenchConfig,
  validateWorkbenchConfig,
} from "../lib/workbench-config.js";
import { compatibleEffort } from "../lib/model-effort.js";
import { localDirectories } from "../bridge/local/directories.mjs";
import { localThreadDialogue, readLocalDialogue } from "../bridge/local/dialogue.mjs";
import { LocalJsonlChild } from "../bridge/local/transport.mjs";
import { codexWorkbenchAdapter } from "../bridge/providers/codex-workbench.mjs";
import { validateTask } from "../bridge/workbench/scheduler.mjs";

test("local directory identity accepts Windows roots but remote paths remain Linux-only", () => {
  assert.equal(
    workingDirectory(LOCAL_HOST, "c:\\work\\repo\\"),
    "C:/work/repo",
  );
  assert.equal(workingDirectory(LOCAL_HOST, "C:\\"), "C:/");
  assert.equal(
    projectIdentity(LOCAL_HOST, "C:\\work").key,
    projectIdentity(LOCAL_HOST, "C:/work/").key,
  );
  assert.equal(projectIdentity("ssh-host", "C:\\work"), null);
  assert.throws(() => workingDirectory(LOCAL_HOST, "C:relative"));
  assert.throws(() => workingDirectory(LOCAL_HOST, "C:/bad\npath"));
  assert.throws(
    () =>
      validateTask({
        provider: "claude",
        host: LOCAL_HOST,
        cwd: "C:/work",
        prompt: "hi",
      }),
    /本机目前支持 Codex/,
  );
});
test("effort config migrates old records, rejects unknown values and resets unsupported model effort", () => {
  const config = defaultWorkbenchConfig();
  delete config.manager.effort;
  assert.equal(validateWorkbenchConfig(config).manager.effort, "");
  config.manager.effort = "ultra";
  assert.equal(validateWorkbenchConfig(config).manager.effort, "ultra");
  config.manager.effort = "typo";
  assert.throws(() => validateWorkbenchConfig(config), /推理强度/);
  assert.equal(
    compatibleEffort({ supportedReasoningEfforts: ["high"] }, "ultra"),
    "",
  );
});
test("local directory browser creates one child and refuses existing/traversal names", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "scope-local-directories-"));
  await writeFile(path.join(cwd, "keep.txt"), "keep");
  const created = await localDirectories(
    { parent: cwd, name: "项目" },
    true,
    cwd,
  );
  const listing = await localDirectories({}, false, cwd);
  assert.equal(listing.directories[0].path, created.cwd);
  await assert.rejects(
    localDirectories({ parent: cwd, name: "../escape" }, true, cwd),
  );
  await assert.rejects(
    localDirectories({ parent: cwd, name: "keep.txt" }, true, cwd),
  );
});
test("manager effort is validated before launch and applied to the existing session before turn/start", async () => {
  const calls = [];
  const adapter = codexWorkbenchAdapter({
    getHost: () => ({ reachable: true }),
    readModels: async () => ({
      models: [{ id: "m", supportedReasoningEfforts: ["high"] }],
    }),
    connectionKey: async () => "active",
    manager: {
      isManaged: () => true,
      async setSessionModel(...args) {
        calls.push(["model", ...args]);
      },
      async startTurn(...args) {
        calls.push(["turn", ...args]);
        return { turn: { id: "t" } };
      },
    },
  });
  const task = {
    kind: "manager",
    host: "remote",
    prompt: "hello",
    remote: { sessionId: "s", model: "m", effort: "low" },
  };
  const config = defaultWorkbenchConfig();
  config.manager.model = "m";
  config.manager.effort = "ultra";
  await assert.rejects(
    adapter.launch(task, config, async () => {}),
    (error) => error.beforeLaunch === true,
  );
  assert.equal(calls.length, 0);
  config.manager.effort = "high";
  await adapter.launch(task, config, async () => calls.push(["checkpoint"]));
  assert.deepEqual(calls, [
    ["model", "remote", "s", "m", "high"],
    ["checkpoint"],
    ["turn", "remote", "s", "hello", { effort: "high" }],
  ]);
});
test("local protocol history retains final replies, classifies commentary and paginates without overlap", () => {
  const thread = {
    turns: [1, 2, 3].map((i) => ({
      id: "turn" + i,
      items: [
        {
          id: "u",
          type: "userMessage",
          content: [{ type: "text", text: "question" + i }],
        },
        {
          id: "c",
          type: "agentMessage",
          phase: "commentary",
          text: "thinking",
        },
        {
          id: "a",
          type: "agentMessage",
          phase: "final_answer",
          text: "answer" + i,
        },
      ],
    })),
  };
  const latest = localThreadDialogue(thread, { limit: 2 });
  assert.deepEqual(
    latest.events.map((e) => e.text),
    ["question3", "thinking", "answer3"],
  );
  assert.equal(latest.events[1].category, "reasoning");
  const older = localThreadDialogue(thread, {
    limit: 2,
    before: latest.nextBefore,
  });
  assert.deepEqual(
    older.events.map((e) => e.text),
    ["question2", "thinking", "answer2"],
  );
});
test("closing local JSONL transport only disconnects its authenticated websocket", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  let authorized;
  server.on("connection", (socket, request) => {
    authorized = request.headers.authorization;
    socket.on("message", (data) => socket.send(data));
  });
  const child = new LocalJsonlChild(async () => ({
    url: `ws://127.0.0.1:${server.address().port}`,
    token: "test-only",
  }));
  const data = once(child.stdout, "data");
  child.stdin.write('{"id":1}\n');
  assert.match((await data)[0].toString(), /"id":1/);
  assert.equal(authorized, "Bearer test-only");
  const closed = once(child, "exit");
  child.stdin.end();
  await closed;
  assert.ok(server.address());
  await new Promise((resolve) => server.close(resolve));
});

test("first-turn metadata flush is retried by polling, but persistent empty history remains an error", async () => {
  const record = {host: '@local', sessionId: 'new', connectedAt: new Date().toISOString()};
  const manager = {sessionRecords: () => [record], prepareHost: async () => ({request: async () => { throw new Error('rollout at C:/new.jsonl is empty'); }})};
  const initial = await readLocalDialogue(manager, '@local', 'new', {});
  assert.deepEqual(initial.events, []);
  record.connectedAt = new Date(Date.now()-20000).toISOString();
  await assert.rejects(readLocalDialogue(manager, '@local', 'new', {}), /is empty/);
});
