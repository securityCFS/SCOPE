import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPrivateGateway } from "./private-gateway.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const stateFile = process.env.SCOPE_PRIVATE_STATE
  ? path.resolve(process.env.SCOPE_PRIVATE_STATE)
  : process.env.SCOPE_STATE_DIR
    ? path.join(path.resolve(process.env.SCOPE_STATE_DIR), "private-access.json")
    : path.join(repoRoot, ".scope", "private-access.json");
const { server, host, port } = await startPrivateGateway({ stateFile });

console.log(`[scope-private] gateway listening on http://${host}:${port}`);
console.log(`[scope-private] access token is stored in ${stateFile}`);
console.log("[scope-private] expose via Tailscale Serve (never Funnel) or Cloudflare Tunnel + Zero Trust Access.");
console.log("[scope-private] run `scope token --show` to view your login token.");

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

