import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { preserveHostSessions, preserveSession, preserveSnapshotSessions } from "../lib/session-cache-guard.js";
import { archiveSessionCache } from "../bridge/session-cache-archive.mjs";
import { applySnapshotSync } from "../lib/incremental-snapshot.js";
const fresh = { id: "s", lastEventAt: "2026-09-17T00:00:00Z", lastAssistant: "new work", sizeBytes: 200, userMessages: ["new"], turnState: "working" };
const old = { id: "s", lastEventAt: "2026-09-14T00:00:00Z", lastAssistant: "old image", sizeBytes: 100, turnState: "working" };
test("restored image cannot roll conversation backwards or retain working state", () => {
  const s=preserveSession(fresh, old);
  assert.equal(s.lastAssistant,"new work"); assert.equal(s.turnState,"idle");
  assert.equal(s.cacheRecovery,"remote-history-regressed");
});
test("missing histories survive but missing processes/agents do not", () => {
  const h=preserveHostSessions({sessions:[fresh],agents:[{rollout:fresh}]},{sessions:[],agents:[],processes:[],reachable:false});
  assert.equal(h.sessions.length,1); assert.equal(h.sessions[0].cacheRecovery,"missing-on-remote");
  assert.deepEqual(h.agents,[]); assert.equal(h.reachable,false);
});
test("later real events update again; compaction does not erase cached arrays", () => {
  assert.equal(preserveSession(old,fresh).lastAssistant,"new work");
  assert.deepEqual(preserveSession(fresh,{...fresh,userMessages:[]}).userMessages,["new"]);
});
test("shrinking file with newer mtime is still guarded", () => {
  assert.equal(preserveSession(fresh,{...old,mtimeMs:Date.now()}).lastAssistant,"new work");
});
test("browser reset/epoch change cannot erase newer content or missing hosts", () => {
  const previous={hosts:[{alias:"h",sessions:[fresh],agents:[]}]};
  const result=applySnapshotSync(previous,{protocol:1,reset:true,overview:{hosts:[{alias:"h",sessions:[old],agents:[]}]},gpuUsage:{},submissionTracker:{}});
  assert.equal(result.hosts[0].sessions[0].lastAssistant,"new work");
  const absent=preserveSnapshotSessions(previous,{hosts:[]});
  assert.equal(absent.hosts[0].reachable,false);
});
test("archive is idempotent, retains both content versions and omits credentials", async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),"scope-cache-test-"));
  for(const s of [fresh,fresh,old]) await archiveSessionCache(dir,{hosts:[{alias:"../../host",sessions:[{...s,account:{token:"SECRET"}}]}]});
  const folders=await readdir(dir); assert.equal(folders.length,1);
  const files=await readdir(path.join(dir,folders[0])); assert.equal(files.length,2);
  for(const file of files) assert.ok(!(await readFile(path.join(dir,folders[0],file),"utf8")).includes("SECRET"));
});
