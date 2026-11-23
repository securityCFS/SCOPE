import { bridgeSource } from "./helpers/bridge-source.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { guardPersistentCodexHome } from '../bridge/persistent-home-guard.mjs';

const source = bridgeSource();
const functions = source.slice(source.indexOf('function sessionFingerprintPayload('), source.indexOf('function commandSignatures('));
function harness(spawn) {
  const context = { spawn, Buffer, Date, setTimeout, clearTimeout,
    REMOTE_PROBE: 'echo scan\n' + '# payload\n'.repeat(4000),
    shellQuote: s => "'" + s.replaceAll("'", "'\"'\"'") + "'",
    guardPersistentCodexHome, persistentCodexHomes: { target: '/mnt/storage/scope/codex-home' },
    SSH_TIMEOUT_MS: 1000, INVENTORY_TIMEOUT_MS: 1000, inventoryOperations: new Map() };
  vm.createContext(context); vm.runInContext(functions, context);
  return context;
}
function childMock(action) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.end = script => queueMicrotask(() => action(child, script));
  child.kill = () => child.emit('close', 1);
  return child;
}
test('large fingerprints and probe use stdin while guarded SSH argv stays bounded', async () => {
  let script, args;
  const h = harness((exe, argv) => { args = argv; return childMock((c, s) => {script=s;c.stdout.emit('data','META\thost\n');c.emit('close',0);}); });
  const sessions = Array.from({length:1000}, (_,i)=>({path:'/root/.codex/sessions/'+i+'.jsonl',mtimeMs:i,sizeBytes:i+100}));
  const result = await h.runSsh('target',{sessions});
  assert.equal(result.code,0);assert.ok(args.join(' ').length<1000);
  assert.match(args.at(-1),/readlink -f/);assert.ok(args.at(-1).endsWith('sh -s'));
  assert.ok(script.length>32767);assert.match(script,/SCOPE_SESSION_FINGERPRINTS_B64=/);
  assert.equal(h.inventoryOperations.size,0);
});
test('synchronous spawn failure is a failed scan, not an unhandled rejection',async()=>{
  const h=harness(()=>{throw new Error('spawn ENAMETOOLONG');});
  const result=await h.runSsh('target',{});
  assert.equal(result.code,1);assert.match(result.stderr,/ENAMETOOLONG/);
  assert.equal(h.inventoryOperations.size,0);
  await new Promise(resolve=>setImmediate(resolve));
});
test('early SSH stdin EPIPE and asynchronous spawn error remain scan-local',async()=>{
  const h=harness(()=>childMock(c=>{c.stdin.emit('error',new Error('EPIPE'));c.emit('error',new Error('ENOENT'));c.emit('close',255);}));
  const result=await h.runSsh('target',{});
  assert.equal(result.code,255);assert.match(result.stderr,/EPIPE/);assert.match(result.stderr,/ENOENT/);
  assert.equal(h.inventoryOperations.size,0);
});
