import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { REMOTE_PROBE } from "../bridge/probes/remote-probe.mjs";
import { pythonExecutable } from "../bridge/local/python-probe.mjs";

test("inventory maps external terminal logs through custom and symlinked Codex homes", () => {
  const probe = REMOTE_PROBE.slice(REMOTE_PROBE.indexOf("all_paths ="), REMOTE_PROBE.indexOf("gpu_processes ="));
  const fixture = String.raw`
import os, json, base64, re, io, types
from unittest.mock import patch
real = '/data/account/codex-home/sessions/2026/11/06/rollout-current.jsonl'
alias = '/home/user/.codex/sessions/2026/11/06/rollout-current.jsonl'
custom = '/data/profiles/one/home/sessions/2026/11/06/rollout-other.jsonl'
files = {'/proc/11/comm': 'codex', '/proc/11/cmdline': b'codex\0',
         '/proc/12/comm': 'codex', '/proc/12/cmdline': b'codex\0'}
def read(name, mode='r'):
    name = name.replace('\\', '/')
    value = files[name]
    return io.BytesIO(value) if 'b' in mode else io.StringIO(value)
def listing(name):
    name = name.replace('\\', '/')
    return {'/proc':['11','12'], '/proc/11/fd':['1','2'], '/proc/12/fd':['1']}[name]
def link(name):
    name = name.replace('\\', '/')
    return {'/proc/11/fd/1':real, '/proc/11/fd/2':'/data/unrelated.jsonl', '/proc/12/fd/1':custom}[name]
glob = types.SimpleNamespace(glob=lambda pattern, recursive: [alias, real])
with patch('builtins.open', read), patch('os.listdir', listing), patch('os.readlink', link), patch('os.path.getmtime', lambda path: 1), patch('os.path.realpath', lambda path: real if path == alias else path):
    exec(PROBE)
assert all_paths == [real], all_paths
assert active_paths == {real, custom}, active_paths
`;
  const result = spawnSync(pythonExecutable(), ["-c", "PROBE = " + JSON.stringify(probe) + "\n" + fixture], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const metadata = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(Buffer.from(line.split("\t")[1], "base64url")));
  assert.equal(metadata.length, 2);
  assert.equal(metadata[0].sessionPaths.length, 1);
  assert.match(metadata[1].sessionPaths[0], /profiles\/one\/home\/sessions/);
});
