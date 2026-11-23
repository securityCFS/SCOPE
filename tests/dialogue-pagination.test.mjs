import { bridgeSource } from "./helpers/bridge-source.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function event(type, payload, timestamp) {
  return JSON.stringify({ timestamp, type, payload });
}

async function dialogueProbe() {
  const source = await bridgeSource();
  const marker = "const DIALOGUE_PROBE = String.raw`";
  const start = source.indexOf(marker);
  const finish = source.indexOf(
    "const RAW_CONTEXT_PROBE",
    start + marker.length,
  );
  assert.notEqual(start, -1);
  assert.notEqual(finish, -1);
  const chunk = source.slice(start + marker.length, finish);
  return chunk.slice(0, chunk.lastIndexOf("`;"));
}

function runProbe(script, filename, mode) {
  const python = process.platform === "win32" ? "python" : "python3";
  const completed = spawnSync(python, ["-", filename, "10", "", mode], {
    input: script,
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    timeout: 20_000,
  });
  assert.equal(completed.status, 0, completed.stderr);
  return JSON.parse(completed.stdout);
}

test("latest dialogue keeps complete Markdown despite later tool traffic", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "scope-dialogue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "rollout.jsonl");
  const markdown = [
    "**结论**",
    "",
    "| Predictor | Score |",
    "|---|---:|",
    "| Shared | 0.988 |",
    "",
    "- 保留完整换行",
  ].join("\n");
  const lines = [
    event(
      "session_meta",
      { id: "dialogue-test", cwd: "/workspace/test" },
      "2026-08-10T00:00:00Z",
    ),
    event(
      "event_msg",
      { type: "user_message", message: "汇报结论" },
      "2026-08-10T00:00:01Z",
    ),
    event(
      "event_msg",
      { type: "agent_message", message: markdown },
      "2026-08-10T00:00:02Z",
    ),
  ];
  for (let index = 0; index < 25; index += 1) {
    lines.push(
      event(
        "response_item",
        {
          type: "function_call",
          name: "exec_command",
          call_id: `call-${index}`,
          arguments: JSON.stringify({ cmd: `echo ${index}` }),
        },
        `2026-08-10T00:01:${String(index).padStart(2, "0")}Z`,
      ),
    );
  }
  await writeFile(filename, `${lines.join("\n")}\n`, "utf8");

  const script = await dialogueProbe();
  const latest = runProbe(script, filename, "dialogue-only");
  assert.ok(latest.events.every((item) => item.category === "dialogue"));
  assert.equal(latest.events.at(-1).kind, "assistant");
  assert.equal(latest.events.at(-1).text, markdown);

  const full = runProbe(script, filename, "full");
  assert.ok(full.events.some((item) => item.category === "operations"));
  assert.equal(
    full.events.filter((item) => item.kind === "assistant").at(-1).text,
    markdown,
  );
});

test("unwraps subagent notifications into Markdown subagent replies", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "scope-subagent-dialogue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "rollout.jsonl");
  const markdown = [
    "**审计结论**",
    "",
    "1. 第一项",
    "2. 第二项",
  ].join("\n");
  const notification = `<subagent_notification> ${JSON.stringify({
    agent_path: "019fd75b-bd5c-7b10-a6f6-991c4774aeb6",
    status: { completed: markdown },
  })} </subagent_notification>`;
  const lines = [
    event(
      "session_meta",
      { id: "subagent-dialogue", cwd: "/workspace/test" },
      "2026-08-10T00:00:00Z",
    ),
    event(
      "event_msg",
      { type: "user_message", message: "让 subagent 审计" },
      "2026-08-10T00:00:01Z",
    ),
    event(
      "event_msg",
      { type: "user_message", message: notification },
      "2026-08-10T00:00:02Z",
    ),
  ];
  await writeFile(filename, `${lines.join("\n")}\n`, "utf8");

  const full = runProbe(await dialogueProbe(), filename, "full");
  const reply = full.events.find((item) => item.category === "subagent");
  assert.ok(reply);
  assert.equal(reply.kind, "intermediate");
  assert.equal(reply.agentPath, "019fd75b-bd5c-7b10-a6f6-991c4774aeb6");
  assert.equal(reply.text, markdown);
  assert.match(reply.title, /^Subagent 019fd75b · completed$/);
  assert.doesNotMatch(reply.text, /subagent_notification|\\n/);
});
