import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PROFILE_LIST_PROBE } from "../bridge/probes/profile-list-probe.mjs";
import { pythonExecutable } from "../bridge/local/python-probe.mjs";

test("profile summaries reflect saved credentials instead of stale metadata without exposing tokens", async (t) => {
  const fixtureHome = await mkdtemp(path.join(tmpdir(), "scope-profile-summary-"));
  t.after(() => rm(fixtureHome, { recursive: true, force: true }));
  const root = path.join(fixtureHome, ".codex/scope-auth-profiles");
  const profile = path.join(root, "work");
  await mkdir(path.join(profile, "home"), { recursive: true });
  const claims = Buffer.from(JSON.stringify({ email: "current@example.test", "https://api.openai.com/auth": { chatgpt_plan_type: "pro" } })).toString("base64url");
  const token = `fixture.${claims}.fixture`;
  const auth = JSON.stringify({ tokens: { id_token: token, refresh_token: "fixture-refresh-value" } });
  const metadata = JSON.stringify({ name: "Work", account: { type: "chatgpt", email: "old@example.test", planType: "old" } });
  await writeFile(path.join(profile, "home/auth.json"), auth);
  await writeFile(path.join(profile, "metadata.json"), metadata);
  await writeFile(path.join(fixtureHome, ".codex/auth.json"), auth);
  await writeFile(path.join(root, "active"), "work");
  const encodedHome = Buffer.from(fixtureHome).toString("base64");
  const result = spawnSync(pythonExecutable(), ["-"], {
    input: `import os, base64\nos.environ["USERPROFILE"] = base64.b64decode("${encodedHome}").decode()\nos.environ["HOME"] = os.environ["USERPROFILE"]\n${PROFILE_LIST_PROBE}`,
    encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.profiles[0].account.email, "current@example.test");
  assert.equal(value.profiles[0].account.planType, "pro");
  assert.equal(value.currentAccount.email, value.profiles[0].account.email);
  assert.equal(value.profiles[0].active, true);
  assert.equal(result.stdout.includes(token), false);
  assert.equal(result.stdout.includes("fixture-refresh-value"), false);
  assert.equal(await readFile(path.join(profile, "metadata.json"), "utf8"), metadata);
  assert.equal(await readFile(path.join(profile, "home/auth.json"), "utf8"), auth);
});
