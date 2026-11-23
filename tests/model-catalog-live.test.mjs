// Opt-in, read-only production catalog smoke test. Does not load any thread.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { AppServerManager } from "../bridge/app-server-client.mjs";
import { modelCatalogTarget, modelCatalogHomeCommands } from "../bridge/model-catalog.mjs";
import { wrapBootstrapAppServer } from "../bridge/remote-app-server-command.mjs";

const host = process.env.SCOPE_LIVE_MODEL_HOST;
const connectionKey = process.env.SCOPE_LIVE_MODEL_CONNECTION || "active";
test("fresh installed Codex returns the requested account catalog", { skip: !host, timeout: 60000 }, async () => {
  const target = modelCatalogTarget(host, connectionKey);
  const command = wrapBootstrapAppServer([
    ...modelCatalogHomeCommands(target),
    'scope_catalog_exe=$(command -v codex)',
    'exec "$scope_catalog_exe" app-server --listen stdio://',
  ].join('; '), "");
  const manager = new AppServerManager({
    spawnConnection: () => spawn("ssh.exe", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", host, command],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }),
    requestTimeoutMs: 30000,
  });
  try {
    const models = await manager.listModels(host);
    assert.ok(models.length > 0, "model/list returned an empty catalog");
    console.log(`live catalog ${host} ${connectionKey}: ${models.map((m) => m.id).join(", ")}`);
  } finally { manager.close(); }
});
