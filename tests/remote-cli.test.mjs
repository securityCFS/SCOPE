import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("remote spool claims a durable receipt, rejects reuse and only observes on poll", () => {
  const python =
    process.env.SCOPE_TEST_PYTHON ||
    (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(
    python,
    [
      fileURLToPath(new URL("./remote-job-probe.py", import.meta.url)),
      fileURLToPath(
        new URL("../bridge/providers/remote-job.py", import.meta.url),
      ),
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(
    result.status,
    0,
    result.stderr || String(result.error || "Python 3 is required"),
  );
});

import { remoteCliAdapter } from "../bridge/providers/remote-cli.mjs";
test("long resumed Claude launch payload travels on stdin, not the Windows command line", async () => {
  const calls = [];
  const adapter = remoteCliAdapter(async (...args) => { calls.push(args); return {code:0, stdout:JSON.stringify({remotePath:"/test/run"})}; });
  const task = {id:"00000000-1111-2222-3333-444444444444", host:"test", provider:"claude", interactive:true, cwd:"/test", permissionMode:"default", prompt:"a".repeat(60000), resumeSessionId:"00000000-1111-2222-3333-555555555555"};
  await adapter.launch(task, {providers:{claude:{executable:"claude"}}});
  assert.equal(calls[0][1], "python3 -");
  assert.ok(calls[0][2].length > 60000);
  const encoded = calls[0][2].match(/sys\.argv\.append\("([^"]+)"\)/)[1];
  const request = JSON.parse(Buffer.from(encoded,"base64url").toString());
  assert.equal(request.operation, "launch");
  assert.equal(request.id, task.id);
  assert.equal(request.interactiveConfig.prompt, task.prompt);
  assert.ok(request.command.length < 30000);
});
