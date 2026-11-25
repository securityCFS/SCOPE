import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pythonExecutable } from "../bridge/local/python-probe.mjs";
import { SessionCatalog } from "../bridge/session-catalog/catalog.mjs";
import { createAgentEnricher, historicalAgent } from "../bridge/rollout-summary.mjs";
import { HISTORY_PROBE } from "../bridge/probes/history-probe.mjs";
import { dialogueRoutes } from "../bridge/routes/dialogue.mjs";

test("Claude probe reads .meta.json and streams subagent workflow with cache, tool matching, and path safety", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "scope-subagent-wf-"));
  t.after(() => rm(home, { recursive: true, force: true }));

  const projectDir = path.join(home, ".claude", "projects", "demo-proj");
  const sessionId = "sess-parent-1";
  const subDir = path.join(projectDir, sessionId, "subagents");
  await mkdir(subDir, { recursive: true });

  const subagentId = "agent-abc12345";
  const toolUseId = "toolu_01TestSubagentCall";
  const parentPath = path.join(projectDir, `${sessionId}.jsonl`);
  await writeFile(
    parentPath,
    [
      {
        type: "user",
        sessionId,
        cwd: "/workspace/demo",
        timestamp: "2026-11-24T10:00:00Z",
        message: { role: "user", content: "Inspect codebase with a subagent" },
      },
      {
        type: "assistant",
        sessionId,
        timestamp: "2026-11-24T10:00:01Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: toolUseId,
              name: "Agent",
              input: {
                description: "Audit config files",
                subagent_type: "Explore",
                prompt: "Find all timeout settings in bridge/",
              },
            },
            {
              type: "tool_use",
              id: "toolu_01SendMsg",
              name: "SendMessage",
              input: {
                to: "abc12345",
                summary: "Follow-up focus on SSH timeout",
                message: "Also verify SSH connect timeout in transport.",
              },
            },
          ],
        },
      },
      {
        type: "queue-operation",
        operation: "enqueue",
        timestamp: "2026-11-24T10:00:10Z",
        content:
          '<agent-message from="abc12345">\n[Subagent hand-back] Preamble text. The report follows:\n  Found 2 timeout constants.\n  - SSH_TIMEOUT_MS\n</agent-message>',
      },
      {
        type: "attachment",
        timestamp: "2026-11-24T10:00:11Z",
        attachment: {
          type: "queued_command",
          prompt:
            '<agent-message from="abc12345">\n[Subagent hand-back] Preamble text. The report follows:\n  Found 2 timeout constants.\n  - SSH_TIMEOUT_MS\n</agent-message>',
        },
      },
      {
        type: "user",
        sessionId,
        timestamp: "2026-11-24T10:00:12Z",
        message: {
          role: "user",
          content:
            "<task-notification>\n<task-id>bg123</task-id>\n<status>completed</status>\n<summary>Background verification done</summary>\n</task-notification>",
        },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n",
  );
  await writeFile(
    path.join(subDir, `${subagentId}.meta.json`),
    JSON.stringify({
      agentType: "Explore",
      description: "Audit config files",
      toolUseId,
      model: "claude-sonnet",
      spawnDepth: 1,
      finished: true,
    }),
  );

  const hugeOutput = "x".repeat(9000);
  const subLines = [
    {
      type: "api-request-blob",
      payload: "B".repeat(50000),
    },
    {
      type: "user",
      sessionId,
      timestamp: "2026-11-24T10:00:01Z",
      message: { role: "user", content: "Find all timeout settings in bridge/" },
    },
    {
      type: "assistant",
      sessionId,
      timestamp: "2026-11-24T10:00:03Z",
      thinkingDurationMs: 1420,
      message: {
        role: "assistant",
        model: "claude-sonnet",
        content: [
          { type: "thinking", thinking: "" },
          { type: "thinking", thinking: "Let's grep for TIMEOUT in bridge/" },
          {
            type: "tool_use",
            id: "tu-grep-1",
            name: "Grep",
            input: { pattern: "TIMEOUT", path: "bridge" },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId,
      timestamp: "2026-11-24T10:00:04Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-grep-1",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: "BASE64_SHOULD_BE_STRIPPED" },
              },
              { type: "text", text: hugeOutput },
            ],
          },
        ],
      },
    },
    {
      type: "assistant",
      sessionId,
      timestamp: "2026-11-24T10:00:06Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tu-err-2",
            name: "Bash",
            input: { command: "false" },
          },
        ],
      },
    },
    {
      type: "user",
      sessionId,
      timestamp: "2026-11-24T10:00:07Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-err-2",
            is_error: true,
            content: "Command exited with status 1",
          },
        ],
      },
    },
    {
      type: "assistant",
      sessionId,
      timestamp: "2026-11-24T10:00:09Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Found 2 timeout constants." }],
      },
    },
  ];
  await writeFile(
    path.join(subDir, `${subagentId}.jsonl`),
    subLines.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );

  const script = await readFile(
    new URL("../bridge/session-catalog/probe.py", import.meta.url),
    "utf8",
  );
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    PYTHONIOENCODING: "utf-8",
  };
  function runProbe(payload) {
    const res = spawnSync(
      pythonExecutable(),
      ["-", Buffer.from(JSON.stringify(payload)).toString("base64url")],
      { input: script, env, encoding: "utf8" },
    );
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  }

  // 1. Parent dialogue surfaces enriched subagent metadata from .meta.json
  const parentDialogue = runProbe({
    operation: "dialogue",
    provider: "claude",
    path: parentPath,
  });
  assert.equal(parentDialogue.totalSubagents, 1);
  assert.equal(parentDialogue.subagents.length, 1);
  assert.equal(parentDialogue.subagents[0].id, subagentId);
  assert.equal(parentDialogue.subagents[0].toolUseId, toolUseId);
  assert.equal(parentDialogue.subagents[0].typeName, "Explore");
  assert.equal(parentDialogue.subagents[0].role, "Audit config files");
  assert.equal(parentDialogue.subagents[0].taskTitle, "Inspect codebase with a subagent");
  assert.equal(parentDialogue.subagents[0].model, "claude-sonnet");
  assert.equal(parentDialogue.subagents[0].spawnDepth, 1);
  assert.equal(parentDialogue.subagents[0].status, "completed");
  assert.equal(parentDialogue.subagents[0].hasWorkflow, true);
  const inlineGroups = parentDialogue.messages.filter(
    (m) => m.role === "subagent_group",
  );
  assert.equal(inlineGroups.length, 1);
  assert.equal(inlineGroups[0].taskTitle, "Inspect codebase with a subagent");
  assert.equal(inlineGroups[0].subagents.length, 1);
  assert.equal(inlineGroups[0].subagents[0].agentId, subagentId);
  assert.match(inlineGroups[0].subagents[0].promptPreview, /timeout settings/);

  const interactions = parentDialogue.messages.filter(
    (m) => m.role === "agent_interaction",
  );
  assert.equal(interactions.length, 3); // outbound SendMessage + deduped inbound handback + task-notification
  assert.equal(interactions[0].direction, "outbound");
  assert.equal(interactions[0].subagentId, subagentId);
  assert.equal(interactions[0].peerName, "Audit config files");
  assert.equal(interactions[1].direction, "inbound");
  assert.equal(interactions[1].interactionKind, "handback");
  assert.equal(interactions[1].subagentId, subagentId);
  assert.equal(interactions[1].text, "Found 2 timeout constants.\n- SSH_TIMEOUT_MS");
  assert.equal(interactions[2].interactionKind, "notification");
  assert.equal(interactions[2].summary, "Background verification done");

  // 2. Workflow fetched by agentId strips blobs/base64, truncates huge tool output, matches errors
  const wf = runProbe({
    operation: "subagent_workflow",
    provider: "claude",
    path: parentPath,
    subagentId,
  });
  assert.equal(wf.found, true);
  assert.equal(wf.subagentId, subagentId);
  assert.equal(wf.toolUseId, toolUseId);
  assert.equal(wf.status, "completed");
  assert.equal(wf.steps.length, 5); // prompt, non-empty thinking, Grep, Bash(error), assistant
  assert.equal(wf.steps[0].kind, "prompt");
  assert.match(wf.steps[0].text, /timeout settings/);
  assert.equal(wf.steps[1].kind, "thinking");
  assert.equal(wf.steps[1].durationMs, 1420);
  assert.equal(wf.steps[2].kind, "tool");
  assert.equal(wf.steps[2].toolName, "Grep");
  assert.equal(wf.steps[2].outputTruncated, true);
  assert.ok(wf.steps[2].output.includes("[image]"));
  assert.ok(!wf.steps[2].output.includes("BASE64_SHOULD_BE_STRIPPED"));
  assert.ok(wf.steps[2].output.length < 6200);
  assert.equal(wf.steps[3].kind, "tool");
  assert.equal(wf.steps[3].isError, true);
  assert.equal(wf.steps[3].status, "failed");
  assert.equal(wf.steps[4].kind, "assistant");
  assert.equal(wf.steps[4].text, "Found 2 timeout constants.");

  // 3. Lookup by toolUseId + version cache short-circuit
  const cached = runProbe({
    operation: "subagent_workflow",
    provider: "claude",
    path: parentPath,
    subagentId: toolUseId,
    version: wf.version,
  });
  assert.equal(cached.notModified, true);
  assert.equal(cached.version, wf.version);

  // 4. Rejects path traversal attempts (fails closed with non-zero exit)
  const badRes = spawnSync(
    pythonExecutable(),
    [
      "-",
      Buffer.from(
        JSON.stringify({
          operation: "subagent_workflow",
          provider: "claude",
          path: parentPath,
          subagentId: "../" + sessionId,
        }),
      ).toString("base64url"),
    ],
    { input: script, env, encoding: "utf8" },
  );
  assert.notEqual(badRes.status, 0);
});

test("SessionCatalog.subagentWorkflow rejects non-Claude sessions and forwards Claude workflow lookups", async () => {
  const calls = [];
  const catalog = new SessionCatalog({
    hosts: () => [{ alias: "gpu-1", reachable: true }],
    run: async (host, command) => {
      const match = command.match(/'([^']+)'$/);
      const payload = JSON.parse(
        Buffer.from(match[1], "base64url").toString("utf8"),
      );
      calls.push({ host, payload });
      if (payload.operation === "scan") {
        return {
          code: 0,
          stdout: JSON.stringify({
            entries: [
              {
                provider: "claude",
                sessionId: "c-1",
                cwd: "/work",
                path: "/home/u/.claude/projects/p/c-1.jsonl",
              },
              {
                provider: "codex",
                sessionId: "x-1",
                cwd: "/work",
                path: "/home/u/.codex/sessions/x-1.jsonl",
              },
            ],
            errors: [],
          }),
        };
      }
      return {
        code: 0,
        stdout: JSON.stringify({
          found: true,
          subagentId: payload.subagentId,
          steps: [],
          version: "v1",
        }),
      };
    },
  });
  await catalog.refresh(true);
  const claudeKey = JSON.stringify(["gpu-1", "claude", "c-1"]);
  const codexKey = JSON.stringify(["gpu-1", "codex", "x-1"]);
  const result = await catalog.subagentWorkflow(claudeKey, {
    subagentId: "agent-a1",
    version: "v0",
  });
  assert.equal(result.subagentId, "agent-a1");
  assert.equal(calls.at(-1).payload.operation, "subagent_workflow");
  assert.equal(calls.at(-1).payload.subagentId, "agent-a1");
  await assert.rejects(
    () => catalog.subagentWorkflow(codexKey, { subagentId: "agent-a1" }),
    /不支持 Claude 子代理工作流/,
  );
});

test("Codex enrichAgentRelations merges host.sessions subagents onto app-server and historical agents", () => {
  const enrich = createAgentEnricher({
    getSubmissionItems: () => [],
  });
  const hostEntry = {
    alias: "node-a",
    panes: [],
    workloads: [],
    sessions: [
      {
        id: "sub-2",
        isSubagent: true,
        parentThreadId: "parent-1",
        agentNickname: "Euler",
        agentRole: "explorer",
        path: "/home/u/.codex/sessions/sub-2.jsonl",
        mtimeMs: 2000,
      },
      {
        id: "sub-1",
        isSubagent: true,
        parentThreadId: "parent-1",
        agentNickname: "Gauss",
        agentRole: "worker",
        path: "/home/u/.codex/sessions/sub-1.jsonl",
        mtimeMs: 1000,
      },
      {
        id: "sub-other",
        isSubagent: true,
        parentThreadId: "parent-other",
        agentNickname: "Other",
        path: "/home/u/.codex/sessions/sub-other.jsonl",
        mtimeMs: 3000,
      },
    ],
  };

  const appServerAgent = {
    id: "app-server:node-a:parent-1",
    host: "node-a",
    cwd: "/work",
    status: "idle",
    rollout: { id: "parent-1", path: "/home/u/.codex/sessions/parent-1.jsonl" },
    subagents: [],
  };
  const enriched = enrich(hostEntry, appServerAgent);
  assert.deepEqual(
    enriched.subagents.map((item) => item.id),
    ["sub-2", "sub-1"],
  );

  const hist = historicalAgent(
    { alias: "node-a", hostname: "node-a", agents: [] },
    {
      id: "hist-1",
      cwd: "/work",
      path: "/home/u/.codex/sessions/hist-1.jsonl",
      subagents: [{ id: "sub-h1", agentNickname: "Newton", path: "/tmp/sub-h1.jsonl" }],
    },
  );
  assert.equal(hist.subagents.length, 1);
  assert.equal(hist.subagents[0].agentNickname, "Newton");
});

test("Codex history-probe attaches subagent rollouts onto parent sessions without exposing them as root sessions", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "scope-codex-hist-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const sessionsDir = path.join(home, ".codex", "sessions", "2026", "11", "24");
  await mkdir(sessionsDir, { recursive: true });

  const parentId = "01999999-1111-7000-8000-000000000001";
  const subId = "01999999-1111-7000-8000-000000000002";

  await writeFile(
    path.join(sessionsDir, `rollout-2026-11-24T10-00-00-${parentId}.jsonl`),
    [
      { type: "session_meta", payload: { id: parentId, cwd: "/work/proj" } },
      { type: "turn_context", payload: { model: "gpt-5-codex" } },
      {
        type: "event_msg",
        timestamp: "2026-11-24T10:00:01Z",
        payload: { type: "user_message", message: "Delegate analysis to explorer" },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n",
  );

  await writeFile(
    path.join(sessionsDir, `rollout-2026-11-24T10-00-05-${subId}.jsonl`),
    [
      {
        type: "session_meta",
        payload: {
          id: subId,
          cwd: "/work/proj",
          agent_nickname: "Kepler",
          agent_role: "explorer",
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: parentId,
                depth: 1,
                agent_path: "/root/kepler",
                agent_nickname: "Kepler",
                agent_role: "explorer",
              },
            },
          },
        },
      },
      { type: "turn_context", payload: { model: "gpt-5-codex" } },
      {
        type: "event_msg",
        timestamp: "2026-11-24T10:00:06Z",
        payload: { type: "user_message", message: "Inspect bridge/routes" },
      },
      {
        type: "event_msg",
        timestamp: "2026-11-24T10:00:10Z",
        payload: { type: "agent_message", message: "Checked all route handlers." },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n",
  );

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, ".codex"),
    PYTHONIOENCODING: "utf-8",
  };
  const res = spawnSync(pythonExecutable(), ["-", "20"], {
    input: HISTORY_PROBE,
    env,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.sessions.length, 1);
  assert.equal(parsed.sessions[0].id, parentId);
  assert.equal(parsed.sessions[0].subagents.length, 1);
  assert.equal(parsed.sessions[0].subagents[0].id, subId);
  assert.equal(parsed.sessions[0].subagents[0].agentNickname, "Kepler");
  assert.equal(parsed.sessions[0].subagents[0].agentRole, "explorer");
  assert.equal(parsed.sessions[0].subagents[0].parentThreadId, parentId);
});

test("POST /api/dialogue resolves owned Codex subagentId and rejects unowned subagents with 404", async () => {
  const sshCalls = [];
  const parentAgent = {
    host: "gpu-node",
    rollout: { id: "parent-1", path: "/home/u/.codex/sessions/parent-1.jsonl" },
    subagents: [
      {
        id: "sub-owned",
        path: "/home/u/.codex/sessions/sub-owned.jsonl",
        agentNickname: "Ohm",
        agentRole: "worker",
        model: "gpt-5-codex",
        turnState: "idle",
      },
    ],
  };
  const snapshot = {
    hosts: [
      {
        alias: "gpu-node",
        sessions: [
          {
            id: "sub-foreign",
            isSubagent: true,
            parentThreadId: "other-parent",
            path: "/home/u/.codex/sessions/sub-foreign.jsonl",
          },
        ],
      },
    ],
  };

  let lastResponse = null;
  let nextBody = {};
  const route = dialogueRoutes(() => ({
    DIALOGUE_PROBE: "PROBE_SCRIPT",
    DIALOGUE_TIMEOUT_MS: 10000,
    RAW_CONTEXT_PROBE: "RAW_SCRIPT",
    cleanSshError: (msg) => msg,
    findAgent: (host, id) =>
      host === "gpu-node" && id === "parent-1" ? parentAgent : null,
    getSnapshot: () => snapshot,
    historicalSessions: new Map(),
    jsonResponse: (_res, status, value) => {
      lastResponse = { status, value };
    },
    readJsonBody: async () => nextBody,
    runSshCommand: async (host, command) => {
      sshCalls.push({ host, command });
      return {
        code: 0,
        stdout: JSON.stringify({ events: [{ id: "e1", kind: "user", text: "Hi" }], hasMore: false }),
        stderr: "",
      };
    },
    sessionKey: (h, i) => `${h}:${i}`,
    shellQuote: (v) => `'${v}'`,
  }));

  // 1. Owned subagent resolves sub-owned.jsonl and returns subagent metadata
  nextBody = { host: "gpu-node", sessionId: "parent-1", subagentId: "sub-owned" };
  await route({ method: "POST" }, {}, new URL("http://localhost/api/dialogue"));
  assert.equal(lastResponse.status, 200);
  assert.equal(lastResponse.value.subagentId, "sub-owned");
  assert.equal(lastResponse.value.subagent.agentNickname, "Ohm");
  assert.match(sshCalls[0].command, /sub-owned\.jsonl/);
  assert.match(sshCalls[0].command, /'40'/);

  // 2. Foreign subagent (different parentThreadId) is rejected with 404
  nextBody = { host: "gpu-node", sessionId: "parent-1", subagentId: "sub-foreign" };
  await route({ method: "POST" }, {}, new URL("http://localhost/api/dialogue"));
  assert.equal(lastResponse.status, 404);
  assert.equal(sshCalls.length, 1);
});
