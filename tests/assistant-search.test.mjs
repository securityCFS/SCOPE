import { bridgeSource } from "./helpers/bridge-source.mjs";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function event(type, payload, timestamp) {
  return JSON.stringify({ timestamp, type, payload });
}

async function writeRollout(root, name, id, cwd, lines) {
  const directory = path.join(root, ".codex", "sessions", "2026", "07", "24");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, name),
    [
      event(
        "session_meta",
        { id, cwd, timestamp: "2026-07-24T01:00:00Z", source: "cli" },
        "2026-07-24T01:00:00Z",
      ),
      ...lines,
    ].join("\n") + "\n",
    "utf8",
  );
}

async function assistantProbe() {
  const source = await bridgeSource();
  const marker = "const ASSISTANT_SEARCH_PROBE = String.raw`";
  const start = source.indexOf(marker);
  const finish = source.indexOf(
    "const SUBMISSION_PROBE",
    start + marker.length,
  );
  assert.notEqual(start, -1);
  assert.notEqual(finish, -1);
  const chunk = source.slice(start + marker.length, finish);
  return chunk.slice(0, chunk.lastIndexOf("`;"));
}

test("assistant search ranks direct multi-term rollout evidence", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "scope-assistant-search-"));
  t.after(() => rm(home, { recursive: true, force: true }));

  await writeRollout(
    home,
    "target.jsonl",
    "target-session",
    "/workspace/vision_model",
    [
      event(
        "response_item",
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Evaluate a reward regressed goal z with QGF on LIBERO.",
            },
          ],
        },
        "2026-07-24T01:00:01Z",
      ),
      event(
        "response_item",
        {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: "python eval_pi05_qgf_libero.py --goal-z reward_regressed",
          }),
        },
        "2026-07-24T01:00:02Z",
      ),
    ],
  );
  await writeRollout(
    home,
    "distractor.jsonl",
    "distractor-session",
    "/workspace/unrelated",
    [
      event(
        "response_item",
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Inspect reward curves for an unrelated training session.",
            },
          ],
        },
        "2026-07-24T01:00:01Z",
      ),
    ],
  );

  const question =
    "我现在想确认使用 reward regressed goal z 去做 QGF 的 Session 是哪一个？";
  const config = Buffer.from(
    JSON.stringify({ question, limit: 10, maxFiles: 100 }),
    "utf8",
  ).toString("base64url");
  const python = process.platform === "win32" ? "python" : "python3";
  const completed = spawnSync(python, ["-", config], {
    input: await assistantProbe(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
    },
    timeout: 20_000,
  });
  assert.equal(completed.status, 0, completed.stderr);
  const result = JSON.parse(completed.stdout);
  assert.deepEqual(result.terms, [
    "reward",
    "regressed",
    "goal",
    "z",
    "qgf",
  ]);
  assert.equal(result.results[0].rollout.id, "target-session");
  assert.equal(result.results[0].coverage, 1);
  assert.equal(result.results[0].bestEventHits, 5);
  assert.deepEqual(result.results[0].matchedTerms, [
    "goal",
    "qgf",
    "regressed",
    "reward",
    "z",
  ]);
  assert.match(result.results[0].evidence[0].text, /reward regressed goal z/i);
});
