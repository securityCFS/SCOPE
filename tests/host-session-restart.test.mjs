import { bridgeSource } from "./helpers/bridge-source.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { HostSessionRestarts } from "../bridge/host-session-restart.mjs";
import { retireScopedAppServerCommand } from "../bridge/remote-app-server-command.mjs";

test("failed preflight never retires any daemon", async () => {
  let retired = 0;
  const restarts = new HostSessionRestarts({ prepare: async () => { throw new Error("background commands"); }, restart: async () => { retired++; } });
  await restarts.start("gpu-box").done;
  assert.equal(retired, 0);
  assert.equal(restarts.view("gpu-box").status, "failed");
});
test("restart job is host scoped, deduplicated and reports per-session failures", async () => {
  const calls = [];
  const restarts = new HostSessionRestarts({
    prepare: async () => [{ key: "account-pro-lite", sessions: [{ sessionId: "a" }, { sessionId: "b" }] }],
    restart: async (host, group) => { calls.push([host, group.key]); return [{ sessionId: "a", ok: true }, { sessionId: "b", ok: false, error: "resume failed" }]; },
  });
  const job = restarts.start("gpu-box");
  assert.equal(restarts.start("gpu-box"), job);
  await job.done;
  assert.deepEqual(calls, [["gpu-box", "account-pro-lite"]]);
  assert.equal(restarts.view("gpu-box").status, "partial");
  assert.equal(restarts.view("10.0.0.12"), null);
});
test("retirement validates named SCOPE daemon and its exact isolated socket", () => {
  for (const bad of ["active", "default", "../../root", "account-;kill", "vscode"]) assert.throws(() => retireScopedAppServerCommand(bad));
  const cmd = retireScopedAppServerCommand("account-pro-lite");
  assert.match(cmd, /scope-auth-profiles\/pro-lite/);
  assert.match(cmd, /state_dir="\$app_codex_home\/app-server-control"/);
  assert.match(cmd, /scope-home/);
  assert.match(cmd, /codex -c cli_auth_credentials_store=file app-server/);
  assert.match(cmd, /tmux kill-session -t "=\$tmux_name"/);
  assert.doesNotMatch(cmd, /kill-server|pkill|killall|thread\/archive/);
});
test("all server generated continuation turns use an account guard", () => {
  const source = bridgeSource();
  const calls = [...source.matchAll(/appServerManager\.startTurn\([^\n]+, "继续", \{([\s\S]*?)\}\)/g)];
  assert.equal(calls.length, 6);
  for (const call of calls) assert.match(call[1], /automaticRecovery: true/);
  const connect = source.split('url.pathname === "/api/app-server/connect"')[1].split('url.pathname === "/api/app-server/respond"')[0];
  assert.match(connect, /const closedRecord =/);
  assert.match(connect, /connectionKey: recoveryConnectionKey/);
  assert.match(source, /closedSession: persistedAppServerSession\(record\)/);
});
