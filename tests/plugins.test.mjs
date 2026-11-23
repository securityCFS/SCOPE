import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { PluginRegistry } from "../bridge/plugins/registry.mjs";
import { pluginRoutes } from "../bridge/plugins/routes.mjs";
import { createAliyunDlcPlugin } from "../bridge/plugins/aliyun-dlc/index.mjs";

function setup(t, options = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "scope-plugins-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  if (options.legacy) writeFileSync(path.join(directory, "submission-monitor.json"), JSON.stringify(options.legacy));
  const plugin = createAliyunDlcPlugin({ stateDirectory: directory, legacyHost: options.legacyHost || "",
    context: options.context || (() => { throw new Error("Unexpected scan"); }), notify() {}, onScanComplete: async () => {} });
  const registry = new PluginRegistry(); registry.register(plugin);
  t.after(() => registry.stop());
  return { directory, plugin, registry };
}

test("plugin migration preserves explicit disabled legacy settings and new settings become authoritative", t => {
  const { directory, plugin, registry } = setup(t, { legacyHost: "environment-host", legacy: { enabled: false, host: "legacy-host" } });
  assert.equal(plugin.store.read().enabled, false);
  assert.equal(plugin.store.read().config.host, "legacy-host");
  registry.configure("aliyun-dlc", { enabled: true, config: { host: "chosen-host" } }, 0);
  assert.throws(() => registry.configure("aliyun-dlc", { enabled: false, config: { host: "old-tab" } }, 0), { statusCode: 409 });
  writeFileSync(path.join(directory, "submission-monitor.json"), JSON.stringify({ enabled: true, host: "stale-host" }));
  const restored = createAliyunDlcPlugin({ stateDirectory: directory, legacyHost: "other-host", context: () => ({}), notify() {}, onScanComplete() {} });
  assert.deepEqual(restored.store.read(), { schemaVersion: 1, revision: 1, enabled: true, config: { host: "chosen-host" } });
  assert.equal(JSON.parse(readFileSync(path.join(directory, "submission-monitor.json"))).host, "stale-host");
  writeFileSync(path.join(directory, "plugins/aliyun-dlc.json"), '{"schemaVersion":99}');
  assert.throws(() => createAliyunDlcPlugin({ stateDirectory: directory, context: () => ({}), notify() {}, onScanComplete() {} }), /配置版本/);
});

test("plugin protocol rejects unsupported modules, unknown actions, unsafe hosts and stale writes", async t => {
  const { plugin, registry } = setup(t);
  assert.equal(registry.list().protocolVersion, 1);
  assert.equal(registry.describe("aliyun-dlc").enabled, false);
  assert.throws(() => registry.register({ ...plugin, manifest: { ...plugin.manifest, protocolVersion: 2 } }), /协议版本/);
  assert.throws(() => registry.register(plugin), /重复/);
  const route = pluginRoutes(registry);
  async function request(method, url, body) {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []); req.method = method;
    let status, value;
    assert.equal(await route(req, { writeHead: v => status = v, end: v => value = JSON.parse(v) }, new URL(url, "http://localhost")), true);
    return { status, value };
  }
  assert.equal((await request("GET", "/api/plugins")).value.plugins.length, 1);
  assert.equal((await request("POST", "/api/plugins/aliyun-dlc/actions/scan", {})).status, 409);
  assert.equal((await request("POST", "/api/plugins/aliyun-dlc/actions/delete", {})).status, 404);
  assert.equal((await request("GET", "/api/plugins/unknown/config")).status, 404);
  assert.equal((await request("DELETE", "/api/plugins/aliyun-dlc/config")).status, 405);
  for (const host of ["", "@local", "-oProxyCommand=x", "bad;host"]) {
    assert.equal((await request("POST", "/api/plugins/aliyun-dlc/config", { revision: 0, enabled: true, config: { host } })).status, 400);
  }
  assert.equal(plugin.store.read().revision, 0);
  assert.equal((await request("POST", "/api/plugins/aliyun-dlc/config", { revision: 0, enabled: true, config: { host: "dlc" } })).status, 200);
  assert.equal((await request("POST", "/api/plugins/aliyun-dlc/config", { revision: 0, enabled: false, config: { host: "dlc" } })).status, 409);
  assert.equal((await request("GET", "/api/plugins/aliyun-dlc/status")).value.state, "idle");
});

test("Aliyun scan stays scoped, coalesces work, blocks settings while running and clears results on disable", async t => {
  let resolve, requests = [];
  const completed = new Promise(r => resolve = r);
  const context = () => ({
    readSshConfig: async () => "", sshAliasesForHostname: () => new Set(["dlc"]),
    getSnapshot: () => ({ hosts: [{ alias: "dlc", reachable: true, agents: [], sessions: [] }, { alias: "other", reachable: true }] }),
    runSshCommand: async host => { requests.push(host); return completed; }, cleanSshError: x => x,
    mapLimit: (items, limit, mapper) => Promise.all(items.map(mapper)), findAgent: () => null,
    getManagement: () => ({ sessions: {} }), sessionKey: (h, s) => `${h}:${s}`, heuristicSummary: () => ({}),
  });
  const { plugin, registry } = setup(t, { legacyHost: "dlc", context });
  const first = registry.invoke("aliyun-dlc", "scan", { days: 7 });
  assert.equal(first.alreadyScanning, false);
  assert.equal(registry.invoke("aliyun-dlc", "scan", {}).alreadyScanning, true);
  assert.throws(() => registry.configure("aliyun-dlc", { enabled: false, config: { host: "dlc" } }, 0), { statusCode: 409 });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(requests, ["dlc"]);
  resolve({ code: 0, stdout: JSON.stringify({ submissions: [{ sessionId: "s", ownershipSource: "tool-call", cwd: "/project", status: "Running" }], calls: [], launches: [] }) });
  await new Promise(r => setImmediate(r));
  assert.equal(plugin.snapshot().items.length, 1);
  assert.equal(plugin.snapshot().windowDays, 7);
  assert.equal(plugin.busy(), false);
  assert.equal(registry.describe("aliyun-dlc").status.result, undefined);
  registry.configure("aliyun-dlc", { enabled: false, config: { host: "dlc" } }, 0);
  assert.equal(plugin.snapshot().items.length, 0);
  assert.equal(plugin.snapshot().targetHostname, "");
  assert.throws(() => registry.invoke("aliyun-dlc", "scan", {}), { statusCode: 409 });
  assert.deepEqual(requests, ["dlc"]);
});

test("disabled plugins create no timers; stopping an enabled plugin releases its timers", t => {
  const timers = new Set();
  t.mock.method(globalThis, "setTimeout", () => { const timer = { unref() {} }; timers.add(timer); return timer; });
  t.mock.method(globalThis, "setInterval", () => { const timer = { unref() {} }; timers.add(timer); return timer; });
  t.mock.method(globalThis, "clearTimeout", timer => timers.delete(timer));
  t.mock.method(globalThis, "clearInterval", timer => timers.delete(timer));
  const { registry } = setup(t);
  registry.start(); assert.equal(timers.size, 0);
  registry.configure("aliyun-dlc", { enabled: true, config: { host: "dlc" } }, 0);
  assert.equal(timers.size, 1); // Saving never starts an immediate remote scan.
  registry.configure("aliyun-dlc", { enabled: false, config: { host: "dlc" } }, 1);
  assert.equal(timers.size, 0);
  registry.configure("aliyun-dlc", { enabled: true, config: { host: "dlc" } }, 2);
  registry.stop(); assert.equal(timers.size, 0);
});
