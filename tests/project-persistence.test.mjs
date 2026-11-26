import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startBridge(cwd, port, config) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bridge/server.mjs", import.meta.url))], {
    cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, SCOPE_BRIDGE_PORT: String(port), SCOPE_SSH_CONFIG: config },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`bridge exited: ${output}`);
    try { if ((await fetch(`${base}/api/health`)).ok) return { child, base }; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`bridge did not start: ${output}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const closed = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await closed;
}

test("pinned projects survive bridge restart and preserve unrelated state", { timeout: 30000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "scope-project-test-"));
  let bridge;
  t.after(async () => {
    if (bridge) await stop(bridge.child);
    if (path.dirname(dir) === path.resolve(tmpdir()) && path.basename(dir).startsWith("scope-project-test-")) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const config = path.join(dir, "ssh-config");
  await writeFile(config, "# no hosts\n");
  const port = await freePort();
  bridge = await startBridge(dir, port, config);
  const post = async (body) => fetch(`${bridge.base}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post({ action: "pin", host: "alpha", cwd: "relative" })).status, 400);
  assert.equal((await post({ action: "pin", host: "alpha", cwd: "/work/research/" })).status, 200);
  assert.equal((await post({ action: "pin", host: "beta", cwd: "/work/research" })).status, 200);
  const state = JSON.parse(await readFile(path.join(dir, ".scope", "state.json"), "utf8"));
  assert.equal(state.operatorName, "Operator");
  assert.equal(state.projects.length, 2);
  await stop(bridge.child);
  bridge = await startBridge(dir, port, config);
  const snapshot = await (await fetch(`${bridge.base}/api/snapshot`)).json();
  assert.deepEqual(snapshot.management.projects.map(({ host, cwd }) => [host, cwd]), [["alpha", "/work/research"], ["beta", "/work/research"]]);
  assert.equal((await post({ action: "unpin", host: "alpha", cwd: "/work/research" })).status, 200);
  const after = JSON.parse(await readFile(path.join(dir, ".scope", "state.json"), "utf8"));
  assert.deepEqual(after.projects.map((project) => project.host), ["beta"]);
});
