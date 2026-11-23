import { SUBMISSION_PROBE } from "../bridge/plugins/aliyun-dlc/probe.mjs";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function event(type, payload, timestamp) {
  return JSON.stringify({ timestamp, type, payload });
}

async function writeRollout(root, name, lines) {
  const directory = path.join(root, ".codex", "sessions", "2026", "07", "24");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), `${lines.join("\n")}\n`, "utf8");
}

async function submissionProbe() {
  return SUBMISSION_PROBE;
}

test("submission probe audits failed, programmatic, script, and subagent DLC calls", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "scope-submission-probe-"));
  t.after(() => rm(home, { recursive: true, force: true }));

  await writeRollout(home, "root.jsonl", [
    event("session_meta", {
      id: "root-session",
      cwd: "/workspace/root",
      source: "cli",
    }, "2026-07-24T01:00:00Z"),
    event("response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "run the reviewed experiments" }],
    }, "2026-07-24T01:00:01Z"),
    event("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: "grep-only",
      arguments: JSON.stringify({
        cmd: "rg -n 'DLC submit|submit_script' docs",
      }),
    }, "2026-07-24T01:00:02Z"),
    event("response_item", {
      type: "function_call_output",
      call_id: "grep-only",
      output: "Process exited with code 0\nDLC submit documentation",
    }, "2026-07-24T01:00:03Z"),
    event("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: "syntax-only",
      arguments: JSON.stringify({
        cmd: "rtk bash -n scripts/submit_eval_dlc.sh scripts/run_eval.sh",
      }),
    }, "2026-07-24T01:00:03Z"),
    event("response_item", {
      type: "function_call_output",
      call_id: "syntax-only",
      output: "Process exited with code 0",
    }, "2026-07-24T01:00:03Z"),
    event("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: "help-call",
      arguments: JSON.stringify({
        cmd: "/etc/dsw/runtime/export_bin/dlc submit pytorchjob --help",
      }),
    }, "2026-07-24T01:00:04Z"),
    event("response_item", {
      type: "function_call_output",
      call_id: "help-call",
      output: "Process exited with code 0\nUsage: dlc submit pytorchjob",
    }, "2026-07-24T01:00:05Z"),
    event("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: "failed-call",
      arguments: JSON.stringify({
        cmd: "/etc/dsw/runtime/export_bin/dlc submit pytorchjob --name=failed",
        workdir: "/workspace/direct",
      }),
    }, "2026-07-24T01:00:06Z"),
    event("response_item", {
      type: "function_call_output",
      call_id: "failed-call",
      output: "Process exited with code 2\nquota rejected",
    }, "2026-07-24T01:00:07Z"),
    event("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: "python-call",
      arguments: JSON.stringify({
        cmd: [
          "python3 - <<'PY'",
          "import subprocess",
          "DLC = '/etc/dsw/runtime/export_bin/dlc'",
          "subprocess.run([DLC, 'submit', 'pytorchjob'])",
          "PY",
        ].join("\n"),
      }),
    }, "2026-07-24T01:00:08Z"),
    event("response_item", {
      type: "function_call_output",
      call_id: "python-call",
      output: [
        "Process exited with code 0",
        "SUBMITTING job=alpha",
        "SUBMITTED job=alpha job_id=dlcaaaaaaaaa",
        "SUBMITTING job=beta",
        "SUBMITTED job=beta job_id=dlcbbbbbbbbb",
      ].join("\n"),
    }, "2026-07-24T01:00:09Z"),
    event("response_item", {
      type: "custom_tool_call",
      name: "exec",
      call_id: "dry-script",
      input:
        'const r = await tools.exec_command({"cmd":"SUBMIT=0 bash scripts/dlc/submit_matrix.sh","workdir":"/workspace/script"});',
    }, "2026-07-24T01:00:10Z"),
    event("response_item", {
      type: "custom_tool_call_output",
      call_id: "dry-script",
      output: "Script completed\nexit_code: 0\npreflight only",
    }, "2026-07-24T01:00:11Z"),
    event("response_item", {
      type: "custom_tool_call",
      name: "exec",
      call_id: "fake-dlc",
      input:
        'const r = await tools.exec_command({"cmd":"SUBMIT=1 DLC=/tmp/fake_dlc_capture.sh bash scripts/dlc/submit_matrix.sh","workdir":"/workspace/script"});',
    }, "2026-07-24T01:00:11Z"),
    event("response_item", {
      type: "custom_tool_call_output",
      call_id: "fake-dlc",
      output: [
        "Script completed",
        "+------------------+--------------------------------------+",
        "|      JobId       |              RequestId               |",
        "+------------------+--------------------------------------+",
        "| dlcjobfake0819 | 00000000-0000-0000-0000-000000000000 |",
        "+------------------+--------------------------------------+",
      ].join("\n"),
    }, "2026-07-24T01:00:11Z"),
    event("response_item", {
      type: "custom_tool_call",
      name: "exec",
      call_id: "explicit-script",
      input:
        'const r = await tools.exec_command({"cmd":"bash scripts/dlc/submit_matrix.sh --submit","workdir":"/workspace/script"});',
    }, "2026-07-24T01:00:12Z"),
    event("response_item", {
      type: "custom_tool_call_output",
      call_id: "explicit-script",
      output: "Script failed with code 3\nquota rejected before Job ID",
    }, "2026-07-24T01:00:13Z"),
    event("response_item", {
      type: "function_call_output",
      call_id: "copied-log-output",
      output: "SUBMITTED job=copied-log job_id=dlcccccccccc",
    }, "2026-07-24T01:00:13Z"),
    event("response_item", {
      type: "function_call_output",
      call_id: "legacy-output",
      output: "SUBMITTED job=legacy job_id=dlcdddddddddd",
    }, "2026-07-24T01:00:14Z"),
  ]);

  await writeRollout(home, "subagent.jsonl", [
    event("session_meta", {
      id: "subagent-session",
      parent_thread_id: "root-session",
      cwd: "/workspace/subagent",
      source: { subagent: { name: "submitter" } },
    }, "2026-07-24T02:00:00Z"),
    event("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: "subagent-call",
      arguments: JSON.stringify({
        cmd: "dlc submit pytorchjob --name=subagent-job",
      }),
    }, "2026-07-24T02:00:01Z"),
    event("response_item", {
      type: "function_call_output",
      call_id: "subagent-call",
      output: [
        "Process exited with code 0",
        "+------------------+--------------------------------------+",
        "|      JobId       |              RequestId               |",
        "+------------------+--------------------------------------+",
        "| dlcccccccccc     | 11111111-1111-1111-1111-111111111111 |",
        "+------------------+--------------------------------------+",
      ].join("\n"),
    }, "2026-07-24T02:00:02Z"),
  ]);

  const python = process.platform === "win32" ? "python" : "python3";
  const completed = spawnSync(python, ["-", "200", "0"], {
    input: await submissionProbe(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
    },
    maxBuffer: 4_000_000,
    timeout: 30_000,
  });
  assert.equal(completed.status, 0, completed.stderr);
  const result = JSON.parse(completed.stdout);

  assert.equal(result.scanScope, "all-rollouts");
  assert.equal(result.filesScanned, 2);
  assert.equal(result.totalCalls, 8);
  assert.equal(result.totalSubmissions, 4);
  assert.equal(
    result.calls.filter((call) => call.invocationKind === "direct-shell").length,
    3,
  );
  assert.equal(
    result.calls.filter((call) => call.invocationKind === "programmatic").length,
    1,
  );
  assert.equal(
    result.calls.filter((call) => call.invocationKind === "submit-script").length,
    3,
  );
  assert.equal(
    result.calls.find((call) => call.callId === "failed-call").outcome,
    "failed",
  );
  assert.equal(
    result.calls.find((call) => call.callId === "help-call").outcome,
    "inspection",
  );
  assert.equal(
    result.calls.find((call) => call.callId === "dry-script").outcome,
    "dry-run",
  );
  assert.equal(
    result.calls.find((call) => call.callId === "dry-script").explicitSubmit,
    false,
  );
  assert.equal(
    result.calls.find((call) => call.callId === "fake-dlc").outcome,
    "dry-run",
  );
  assert.equal(
    result.submissions.some((item) => item.jobId === "dlcjobfake0819"),
    false,
  );
  const explicitScript = result.calls.find(
    (call) => call.callId === "explicit-script",
  );
  assert.equal(explicitScript.explicitSubmit, true);
  assert.equal(explicitScript.outcome, "failed");
  const programmatic = result.calls.find(
    (call) => call.callId === "python-call",
  );
  assert.equal(programmatic.observedInvocations, 2);
  assert.deepEqual(programmatic.jobIds, [
    "dlcaaaaaaaaa",
    "dlcbbbbbbbbb",
  ]);
  const subagent = result.calls.find(
    (call) => call.callId === "subagent-call",
  );
  assert.equal(subagent.isSubagent, true);
  assert.equal(subagent.parentThreadId, "root-session");
  assert.deepEqual(subagent.jobIds, ["dlcccccccccc"]);
  assert.equal(
    result.calls.some((call) => call.callId === "copied-log-output"),
    false,
  );
  assert.equal(
    result.submissions.find((item) => item.jobId === "dlcccccccccc").sessionId,
    "subagent-session",
  );
  assert.equal(
    result.submissions.find((item) => item.jobId === "dlcccccccccc")
      .ownershipSource,
    "tool-call",
  );
  const legacy = result.calls.find(
    (call) => call.callId === "legacy-output",
  );
  assert.equal(legacy.invocationKind, "output-only");
  assert.deepEqual(legacy.jobIds, ["dlcdddddddddd"]);
  assert.equal(
    result.calls.some((call) => call.callId === "grep-only"),
    false,
  );
  assert.equal(
    result.calls.some((call) => call.callId === "syntax-only"),
    false,
  );
});
