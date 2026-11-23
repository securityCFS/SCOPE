// Explicit opt-in real CLI check. Only new temporary projects and new spool IDs.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createSshCommand } from "../bridge/transport/ssh-command.mjs";
import { remoteCliAdapter } from "../bridge/providers/remote-cli.mjs";
import { defaultWorkbenchConfig } from "../lib/workbench-config.js";

const host = process.argv[2];
if (!host || !process.argv.includes("--run")) throw Error("Usage: node scripts/cli-integration-smoke.mjs HOST --run");
const providerIndex = process.argv.indexOf("--provider");
const selectedProvider = providerIndex >= 0 ? process.argv[providerIndex + 1] : null;
if (providerIndex >= 0 && !["antigravity", "claude"].includes(selectedProvider)) throw Error("--provider must be antigravity or claude");
const providers = selectedProvider ? [selectedProvider] : ["antigravity", "claude"];
const output = "outputs/integration";
const reportFile = `${output}/cli-smoke-${host.replace(/[^a-zA-Z0-9_.-]/g, "_")}${selectedProvider ? `-${selectedProvider}` : ""}.json`;
await mkdir(output, { recursive: true });
const calls = [];
const ssh = createSshCommand({ inventoryOperations: new Map(), operationCounts: new Map(), connectTimeoutMs: 5000, audit: () => {} });
const run = async (...args) => {
  const start = performance.now(); const result = await ssh(...args);
  calls.push({ ms: Math.round(performance.now() - start), sentBytes: Buffer.byteLength(args[1] || "") + Buffer.byteLength(args[2] || ""), receivedBytes: Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr), code: result.code });
  return result;
};
const adapter = remoteCliAdapter(run);
const config = defaultWorkbenchConfig();
const report = { host, startedAt: new Date().toISOString(), results: [], calls };
const persist = () => writeFile(reportFile, JSON.stringify(report, null, 2));
for (const provider of providers) {
  const directory = await run(host, "mktemp -d /tmp/scope-cli-smoke-XXXXXXXX", "", 10000);
  const cwd = directory.stdout.trim();
  if (directory.code || !/^\/tmp\/scope-cli-smoke-[a-zA-Z0-9]+$/.test(cwd)) throw Error("Cannot create isolated test directory");
  let sessionId;
  for (const phase of ["initial", "resume"]) {
    const task = { id: randomUUID(), provider, host, cwd, gpuIndices: [],
      prompt: phase === "initial" ? "This is a connection smoke test. Do not use any tools, read files, run commands, or create subagents. Remember the marker SCOPE_CONNECTION_OK and reply with only that marker." : "Do not use any tools. Reply only with the exact marker from my previous message.",
      ...(sessionId ? { resumeSessionId: sessionId } : {}),
    };
    const start = performance.now();
    const record = { provider, phase, id: task.id, cwd, status: "starting" };
    report.results.push(record); await persist();
    try {
      await adapter.launch(task, config);
      // Recreate the observer: polling does not depend on an in-memory process handle.
      const observer = remoteCliAdapter(run);
      let result;
      do {
        await new Promise(r => setTimeout(r, 3000));
        result = await observer.poll(task);
      } while (["running", "starting"].includes(result.status) && performance.now() - start < 150000);
      Object.assign(record, { status: result.status, elapsedMs: Math.round(performance.now() - start), text: result.text, error: result.error, sessionId: result.sessionId,
        passed: result.status === "completed" && result.text?.trim() === "SCOPE_CONNECTION_OK" });
      sessionId = result.sessionId;
      if (["completed", "failed"].includes(result.status)) {
        await adapter.archive(task); record.archived = true;
      }
      console.log(JSON.stringify(record)); await persist();
      if (!record.passed || !sessionId) break;
    } catch (error) {
      Object.assign(record, { status: "observer-error", error: error.message });
      await persist(); console.log(JSON.stringify(record)); break;
    }
  }
}
report.endedAt = new Date().toISOString(); await persist();
