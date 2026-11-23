import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { inspectPackage, installPackage, installedPackages, removePackage } from "../bridge/plugins/package.mjs";
import { loadExternalPlugins } from "../bridge/plugins/external.mjs";
import { PluginRegistry } from "../bridge/plugins/registry.mjs";
import { pluginRoutes } from "../bridge/plugins/routes.mjs";
import { Readable } from "node:stream";

function fixture(t, code = 'export function apply(ctx) { ctx.action("hello", () => ({ message: ctx.config.greeting })); }') {
  const root = mkdtempSync(path.join(os.tmpdir(), "scope-import-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), state = path.join(root, "state");
  mkdirSync(source);
  const manifest = JSON.parse(readFileSync(new URL("../examples/plugins/hello/scope-plugin.json", import.meta.url)));
  const save = () => writeFileSync(path.join(source, "scope-plugin.json"), JSON.stringify(manifest));
  save(); writeFileSync(path.join(source, "index.mjs"), code);
  return { root, source, state, manifest, save };
}
async function ready(registry) {
  for (let i = 0; i < 100 && registry.describe("hello-scope").status.state === "loading"; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(registry.describe("hello-scope").status.state, "idle");
}
test("inspect/install do not execute code and copy only declared files; disabled startup is inert", t => {
  const { source, state } = fixture(t, 'throw new Error("must not execute");');
  writeFileSync(path.join(source, ".env"), "SECRET_DO_NOT_COPY");
  writeFileSync(path.join(source, "unlisted.txt"), "not part of plugin");
  assert.equal(inspectPackage(source).manifest.id, "hello-scope");
  installPackage(source, state);
  const destination = path.join(state, "extensions/hello-scope");
  assert.equal(existsSync(path.join(destination, ".env")), false);
  assert.equal(existsSync(path.join(destination, "unlisted.txt")), false);
  const registry = new PluginRegistry(); loadExternalPlugins(registry, state); registry.start();
  t.after(() => registry.stop());
  assert.equal(registry.describe("hello-scope").status.state, "disabled");
  assert.throws(() => installPackage(source, state), /已安装/);
});
test("imported plugin enables, invokes, reloads configuration, stops and resumes after restart", async t => {
  const { source, state } = fixture(t);
  installPackage(source, state);
  const registry = new PluginRegistry(); loadExternalPlugins(registry, state); registry.start();
  t.after(() => registry.stop());
  assert.throws(() => registry.invoke("hello-scope", "hello", {}), { statusCode: 409 });
  registry.configure("hello-scope", { enabled: true, config: { greeting: "First" } }, 0);
  await ready(registry);
  assert.deepEqual(await registry.invoke("hello-scope", "hello", {}), { message: "First" });
  assert.throws(() => registry.configure("hello-scope", { enabled: true, config: { greeting: "Stale" } }, 0), { statusCode: 409 });
  registry.configure("hello-scope", { enabled: false, config: { greeting: "Second" } }, 1);
  assert.equal(registry.describe("hello-scope").status.state, "disabled");
  registry.configure("hello-scope", { enabled: true, config: { greeting: "Second" } }, 2);
  await ready(registry); registry.stop();
  const restarted = new PluginRegistry(); loadExternalPlugins(restarted, state); restarted.start();
  t.after(() => restarted.stop()); await ready(restarted);
  assert.deepEqual(await restarted.invoke("hello-scope", "hello", {}), { message: "Second" });
  removePackage("hello-scope", state);
  assert.equal(installedPackages(state).length, 0);
  assert.equal(existsSync(path.join(state, "plugin-data/hello-scope/settings.json")), true);
});
test("untrusted manifest paths, versions, collisions and private filenames are rejected", t => {
  const { source, manifest, save } = fixture(t);
  for (const file of ["../outside.mjs", "C:/secret.mjs", "sub/../../secret.mjs", ".env", "auth.json", "nested/credentials.json", "a//b.mjs", "index.mjs:secret"]) {
    manifest.files = [file]; manifest.entry = file; save();
    assert.throws(() => inspectPackage(source));
  }
  manifest.files = ["index.mjs"]; manifest.entry = "index.mjs";
  manifest.protocolVersion = 2; save(); assert.throws(() => inspectPackage(source), /协议/);
  manifest.protocolVersion = 1; manifest.id = "aliyun-dlc"; save(); assert.throws(() => inspectPackage(source), /冲突/);
  delete manifest.id; save(); assert.throws(() => inspectPackage(source), /ID/);
});
test("modified packages are reported without executing or preventing other plugins from loading", t => {
  const { source, state } = fixture(t);
  installPackage(source, state);
  writeFileSync(path.join(state, "extensions/hello-scope/index.mjs"), 'throw new Error("tampered");');
  const registry = new PluginRegistry(); loadExternalPlugins(registry, state);
  assert.equal(registry.list().plugins.length, 0);
  assert.match(registry.list().loadErrors[0].error, /不一致/);
});
test("failed apply rolls back registered disposers and presents a recoverable error", async t => {
  const { source, state } = fixture(t, 'export function apply(ctx) { ctx.onDispose(() => { globalThis.__scopeImportDisposed = true; }); throw new Error("apply failed"); }');
  installPackage(source, state);
  const registry = new PluginRegistry(); loadExternalPlugins(registry, state); registry.start();
  t.after(() => { registry.stop(); delete globalThis.__scopeImportDisposed; });
  registry.configure("hello-scope", { enabled: true, config: {} }, 0);
  for (let i = 0; i < 100 && registry.describe("hello-scope").status.state === "loading"; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(registry.describe("hello-scope").status.error, "apply failed");
  assert.equal(globalThis.__scopeImportDisposed, true);
  registry.configure("hello-scope", { enabled: false, config: {} }, 1);
  assert.equal(registry.describe("hello-scope").status.state, "disabled");
});

test("directory links cannot copy files outside the package", t => {
  const { root, source, manifest, save } = fixture(t);
  const outside = path.join(root, "outside"); mkdirSync(outside);
  writeFileSync(path.join(outside, "secret.mjs"), "private");
  symlinkSync(outside, path.join(source, "linked"), process.platform === "win32" ? "junction" : "dir");
  manifest.files.push("linked/secret.mjs"); save();
  assert.throws(() => inspectPackage(source), /链接|联接/);
});

test("disabling during asynchronous apply cleans late resources without reviving the plugin", async t => {
  const { source, state } = fixture(t, `export async function apply(ctx) {
    await new Promise(resolve => { globalThis.__scopeImportRelease = resolve; });
    ctx.onDispose(() => { globalThis.__scopeImportLateDisposed = true; });
  }`);
  installPackage(source, state);
  const registry = new PluginRegistry(); loadExternalPlugins(registry, state); registry.start();
  t.after(() => { registry.stop(); delete globalThis.__scopeImportRelease; delete globalThis.__scopeImportLateDisposed; });
  registry.configure("hello-scope", { enabled: true, config: {} }, 0);
  for (let i = 0; i < 100 && !globalThis.__scopeImportRelease; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(typeof globalThis.__scopeImportRelease, "function");
  registry.configure("hello-scope", { enabled: false, config: {} }, 1);
  globalThis.__scopeImportRelease();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(globalThis.__scopeImportLateDisposed, true);
  assert.equal(registry.describe("hello-scope").status.state, "disabled");
});

test("HTTP actions await external results and preserve async errors", async t => {
  const { source, state } = fixture(t, 'export function apply(ctx) { ctx.action("hello", async input => { if (input.fail) throw new Error("action failed"); return { done: true }; }); }');
  installPackage(source, state);
  const registry = new PluginRegistry(); loadExternalPlugins(registry, state); registry.start();
  t.after(() => registry.stop());
  registry.configure("hello-scope", { enabled: true, config: {} }, 0); await ready(registry);
  async function request(input) {
    const req = Readable.from([Buffer.from(JSON.stringify(input))]); req.method = "POST";
    let status, body;
    await pluginRoutes(registry)(req, { writeHead: value => status = value, end: value => body = JSON.parse(value) }, new URL("http://localhost/api/plugins/hello-scope/actions/hello"));
    return { status, body };
  }
  assert.deepEqual(await request({}), { status: 200, body: { done: true } });
  assert.deepEqual(await request({ fail: true }), { status: 400, body: { error: "action failed" } });
});
