import { bridgeSource } from "./helpers/bridge-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { guardPersistentCodexHome } from "../bridge/persistent-home-guard.mjs";
test("only configured hosts require the persistent link and never repair destructively", () => {
  assert.equal(guardPersistentCodexHome("probe"),"probe");
  const command=guardPersistentCodexHome("probe","/mnt/storage/scope/codex-home");
  assert.match(command,/readlink -f/); assert.match(command,/exit 78/);
  assert.ok(command.endsWith("; probe")); assert.doesNotMatch(command,/\b(kill|rm|mv)\b/);
  assert.throws(()=>guardPersistentCodexHome("probe","/data/../root"));
});
test("remote app-server spawn constructs its command before applying the persistent guard", () => {
  const source = bridgeSource();
  const fn = source.slice(source.indexOf("function spawnRemoteAppServer("), source.indexOf("function spawnRemoteProfileAppServer("));
  let guarded = false;
  const context = { LOCAL_HOST: "@local", hostRuntimeConfig: () => ({}), codexExecutable: v => v,
    durableRemoteAppServerCommand: () => "start-codex", profileFromConnection: () => "pronew",
    persistentCodexHomes: { host: "/mnt/storage/scope/codex-home" },
    guardPersistentCodexHome: command => { assert.equal(command, "start-codex"); guarded = true; return command; },
    SSH_TIMEOUT_MS: 1000, spawn: () => { throw new Error("spawn reached"); } };
  assert.throws(() => vm.runInNewContext(fn + '\nspawnRemoteAppServer("host");', context), /spawn reached/);
  assert.equal(guarded, true);
});
