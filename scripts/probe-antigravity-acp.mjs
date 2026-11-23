// A protocol handshake only: no prompt, no agent tools, no login mutation.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { shellQuote } from "../bridge/transport/ssh-command.mjs";
const host = process.argv[2];
if (!host) throw Error("Usage: node scripts/probe-antigravity-acp.mjs HOST");
const started = performance.now();
const preLaunch = process.env.SCOPE_PRELAUNCH_CMD ? `${process.env.SCOPE_PRELAUNCH_CMD} >&2 || exit 73\n` : "";
const child = spawn("ssh", ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=5", "--", host,
  `bash -ic ${shellQuote(`${preLaunch}exec agy acp`)}`], { windowsHide: true });
const report = await new Promise((resolve, reject) => {
  let settled = false;
  const timer = setTimeout(() => { child.kill(); reject(Error("ACP handshake timed out")); }, 20000);
  const lines = createInterface({ input: child.stdout });
  child.stderr.on("data", () => {}); // Bootstrap output may contain proxy addresses.
  child.stdin.on("error", () => {});
  child.once("error", reject);
  child.once("exit", code => { if (!settled) { clearTimeout(timer); reject(Error(`ACP exited ${code} before initialize response`)); } });
  lines.on("line", line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== 1) return;
    settled = true; clearTimeout(timer);
    child.stdin.end(); lines.close();
    const cleanup = setTimeout(() => child.kill(), 3000); cleanup.unref();
    resolve({ host, checkedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), response: message });
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
    protocolVersion: 1, clientInfo: { name: "scope", version: "0.2.0" }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  } }) + "\n");
});
await mkdir("outputs/integration", { recursive: true });
await writeFile("outputs/integration/antigravity-acp.json", JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
