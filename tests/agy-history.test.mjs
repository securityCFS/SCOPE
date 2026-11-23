import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  appendFile,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pythonExecutable } from "../bridge/local/python-probe.mjs";
import {
  historyContainsTurn,
  historyContainsUserTurn,
  visibleSpoolTurns,
} from "../lib/native-history.js";

async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), "scope-agy-history-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const dir = path.join(
    home,
    ".gemini/antigravity-cli/brain/test-session/.system_generated/logs",
  );
  await mkdir(dir, { recursive: true });
  const filename = path.join(dir, "transcript_full.jsonl");
  const script = await readFile(
    new URL("../bridge/session-catalog/agy-history.py", import.meta.url),
    "utf8",
  );
  const probe = (options = {}) => {
    const result = spawnSync(
      pythonExecutable(),
      [
        "-",
        Buffer.from(
          JSON.stringify({ sessionId: "test-session", ...options }),
        ).toString("base64url"),
      ],
      {
        input: script,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          PYTHONIOENCODING: "utf-8",
        },
        encoding: "utf8",
        maxBuffer: 8_000_000,
      },
    );
    if (result.status !== 0) throw Error(result.stderr);
    return JSON.parse(result.stdout);
  };
  return {
    filename,
    probe,
    write: (rows) =>
      writeFile(
        filename,
        rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      ),
  };
}
const row = (index, content = `message ${index}`) => ({
  step_index: index,
  type: index % 2 ? "PLANNER_RESPONSE" : "USER_INPUT",
  source: index % 2 ? "MODEL" : "USER_EXPLICIT",
  content,
  created_at: "2026-11-09T00:00:00Z",
});

test("AGY reads user, assistant and tool history without exporting system or thinking fields", async (t) => {
  const f = await fixture(t);
  await f.write([
    row(
      0,
      "<USER_REQUEST>\nhello\n</USER_REQUEST>\n<ADDITIONAL_METADATA>hidden</ADDITIONAL_METADATA>",
    ),
    {
      ...row(1, "answer"),
      thinking: "not exported",
      tool_calls: [{ name: "read_file", args: { path: "demo.txt" } }],
    },
    { ...row(2, "tool result"), type: "GENERIC", source: "MODEL" },
    { ...row(3, "not a user instruction"), type: "SYSTEM_MESSAGE" },
  ]);
  const value = f.probe();
  assert.deepEqual(
    value.messages.map((m) => m.role),
    ["user", "assistant", "activity"],
  );
  assert.equal(value.messages[0].text, "hello");
  assert.match(value.messages[1].activity, /read_file/);
  assert.doesNotMatch(
    JSON.stringify(value),
    /not exported|hidden|not a user instruction/,
  );
  assert.equal(value.nextBefore, null);
});

test("AGY pages backwards without duplicates and resets after a source rewrite", async (t) => {
  const f = await fixture(t);
  await f.write(Array.from({ length: 205 }, (_, i) => row(i)));
  const latest = f.probe();
  assert.equal(latest.messages.length, 100);
  const older = f.probe({ before: latest.nextBefore, version: latest.version });
  const first = f.probe({ before: older.nextBefore, version: older.version });
  assert.deepEqual(
    [...first.messages, ...older.messages, ...latest.messages].map((m) =>
      Number(m.id),
    ),
    Array.from({ length: 205 }, (_, i) => i),
  );
  assert.equal(first.nextBefore, null);
  await f.write([row(0, "rewritten")]);
  const changed = f.probe({
    before: latest.nextBefore,
    version: latest.version,
  });
  assert.equal(changed.reset, true);
  assert.equal(changed.messages[0].text, "rewritten");
});

test("AGY handles byte boundaries, oversized records, missing files and partial writes", async (t) => {
  const f = await fixture(t);
  assert.equal(f.probe().summaryOnly, true);
  await f.write(
    Array.from({ length: 90 }, (_, i) => row(i, "字".repeat(9000))),
  );
  const latest = f.probe();
  const older = f.probe({ before: latest.nextBefore, version: latest.version });
  assert.deepEqual(
    [...older.messages, ...latest.messages].map((m) => Number(m.id)),
    Array.from({ length: 90 }, (_, i) => i),
  );
  await f.write([row(0, "a".repeat(3_000_000)), row(1, "latest")]);
  const huge = f.probe();
  assert.equal(huge.messages.at(-1).text, "latest");
  const previous = f.probe({ before: huge.nextBefore, version: huge.version });
  assert.ok(
    previous.nextBefore === null || previous.nextBefore < huge.nextBefore,
  );
  assert.equal(previous.limited, true);
  await appendFile(f.filename, '{"unfinished":');
  assert.equal(f.probe().limited, true);
  assert.throws(() => f.probe({ sessionId: "../../outside" }), /Invalid AGY/);
});

test("native history hides only a confirmed matching completed spool turn", () => {
  const createdAt = Date.parse("2026-11-09T00:00:00Z");
  const messages = [
    {
      role: "user",
      text: "hello",
      createdAt: new Date(createdAt + 1000).toISOString(),
    },
    { role: "assistant", text: "done" },
  ];
  const turn = {
    status: "completed",
    prompt: "hello",
    text: "done\n",
    createdAt,
  };
  assert.equal(historyContainsTurn(messages, turn), true);
  assert.equal(
    historyContainsTurn(messages, { ...turn, status: "running" }),
    false,
  );
  assert.equal(
    historyContainsTurn(messages, { ...turn, text: "different" }),
    false,
  );
  assert.equal(
    historyContainsTurn(messages, { ...turn, createdAt: createdAt + 10000 }),
    false,
  );
});

test("native history matches attachment-annotated prompts and drops superseded stopped spool turns", () => {
  const createdAt = Date.parse("2026-11-18T09:26:40Z");
  const messages = [
    {
      role: "user",
      text:
        "分析截图\n\n[SCOPE 网页附件：文件已安全上传到当前目标主机，请按以下绝对路径读取]\n- a.png (image/png, 100 bytes): /tmp/a.png",
      createdAt: new Date(createdAt + 1000).toISOString(),
    },
    {
      role: "user",
      text: "请查看并处理本条消息附带的文件。\n\n[SCOPE 网页附件：文件已安全上传到当前目标主机，请按以下绝对路径读取]\n- b.png (image/png, 100 bytes): /tmp/b.png",
      createdAt: new Date(createdAt + 20_000).toISOString(),
    },
    { role: "assistant", text: "已分析完毕" },
    {
      role: "user",
      text: "继续",
      createdAt: new Date(createdAt + 60_000).toISOString(),
    },
    { role: "assistant", text: "第二轮回复" },
  ];

  const stoppedTurn = {
    id: "t1",
    status: "stopped",
    prompt: "分析截图\n\n[附件: a.png]",
    text: "",
    createdAt,
  };
  const attachmentOnlyCompletedTurn = {
    id: "t2",
    status: "completed",
    prompt: "[附件: b.png]",
    text: "已分析完毕",
    createdAt: createdAt + 19_000,
  };
  const completedTurn = {
    id: "t3",
    status: "completed",
    prompt: "继续",
    text: "第二轮回复",
    createdAt: createdAt + 59_000,
  };
  const activeTurn = {
    id: "t4",
    status: "running",
    prompt: "下一步怎么做",
    text: "",
    createdAt: createdAt + 120_000,
  };

  assert.equal(historyContainsUserTurn(messages, stoppedTurn), true);
  assert.equal(historyContainsTurn(messages, attachmentOnlyCompletedTurn), true);
  assert.deepEqual(
    visibleSpoolTurns(messages, [
      stoppedTurn,
      attachmentOnlyCompletedTurn,
      completedTurn,
      activeTurn,
    ]).map((turn) => turn.id),
    ["t4"],
  );
  // A single stopped turn with no subsequent turns stays visible.
  assert.deepEqual(
    visibleSpoolTurns(messages.slice(0, 1), [stoppedTurn]).map((turn) => turn.id),
    ["t1"],
  );
  // An earlier stopped turn present in native history stays hidden as soon as a new turn starts.
  assert.deepEqual(
    visibleSpoolTurns(messages.slice(0, 1), [stoppedTurn, activeTurn]).map(
      (turn) => turn.id,
    ),
    ["t4"],
  );
});

test("AGY extracts working and completed background subagents without leaking raw logs", async (t) => {
  const f = await fixture(t);
  const root = path.resolve(path.dirname(f.filename), "../../..");
  const childDir = path.join(root, "child-sub-1/.system_generated/logs");
  await mkdir(childDir, { recursive: true });
  const childFile = path.join(childDir, "transcript_full.jsonl");
  await writeFile(
    childFile,
    [
      JSON.stringify({
        step_index: 0,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        tool_calls: [{ name: "read_file", args: { path: "/tmp/a.py" } }],
      }),
    ].join("\n") + "\n",
  );

  await f.write([
    row(0, "dispatch subagents"),
    {
      step_index: 1,
      type: "PLANNER_RESPONSE",
      source: "MODEL",
      status: "DONE",
      content: "",
      tool_calls: [
        {
          name: "invoke_subagent",
          args: {
            Role: '"Codebase Researcher"',
            TypeName: '"research"',
          },
        },
      ],
    },
    {
      step_index: 2,
      type: "GENERIC",
      source: "MODEL",
      status: "DONE",
      content: 'Created the following subagent:\n{\n  "conversationId": "child-sub-1"\n}',
    },
  ]);

  const live = f.probe();
  assert.equal(live.subagents.length, 1);
  assert.equal(live.subagents[0].id, "child-sub-1");
  assert.equal(live.subagents[0].role, "Codebase Researcher");
  assert.equal(live.subagents[0].typeName, "research");
  assert.equal(live.subagents[0].status, "working");
  assert.equal(live.subagents[0].lastAction, "read_file");

  await appendFile(
    childFile,
    JSON.stringify({
      step_index: 1,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      content: "finished analysis",
      tool_calls: [],
    }) + "\n",
  );
  const done = f.probe();
  assert.equal(done.subagents[0].status, "completed");
});
