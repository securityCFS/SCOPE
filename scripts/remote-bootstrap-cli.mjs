import path from "node:path";
import { createEmailNotifier } from "../bridge/email-notifier.mjs";
import { RemoteBootstrapService } from "../bridge/remote-bootstrap/service.mjs";
import { RemoteTunnelManager } from "../bridge/remote-bootstrap/tunnels.mjs";
import { createSshCommand } from "../bridge/transport/ssh-command.mjs";

const action = process.argv[2] || "inspect";
const host = process.argv[3] || "";
const portArg = process.argv.indexOf("--port");
const remotePort = portArg >= 0 ? Number(process.argv[portArg + 1]) : 4922;

if (!["inspect", "deploy", "remove"].includes(action) || !host) {
  console.error("Usage: node scripts/remote-bootstrap-cli.mjs <inspect|deploy|remove> <ssh-host> [--port 4922]");
  process.exit(1);
}

const stateDir = path.resolve(process.cwd(), ".scope");
const emailNotifier = await createEmailNotifier({
  configPath: path.join(stateDir, "email-notifications.json"),
  statePath: path.join(stateDir, "email-notification-state.json"),
});
const tunnels = await new RemoteTunnelManager({
  stateDir,
  emailNotifier,
}).load();
const run = createSshCommand({
  inventoryOperations: new Map(),
  operationCounts: new Map(),
  connectTimeoutMs: 8_000,
  audit: () => {},
});
const bootstrap = new RemoteBootstrapService({
  run,
  getHost: (alias) => ({ alias, reachable: true }),
  tunnels,
});

try {
  const result =
    action === "inspect"
      ? await bootstrap.inspect(host)
      : action === "deploy"
        ? await bootstrap.deploy(host, { remotePort })
        : await bootstrap.remove(host);
  console.log(JSON.stringify(result, null, 2));
} finally {
  tunnels.stop();
}
