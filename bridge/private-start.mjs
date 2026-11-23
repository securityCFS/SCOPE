import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPrivateGateway } from "./private-gateway.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const stateFile = path.join(repoRoot, ".scope", "private-access.json");
const { server, host, port } = await startPrivateGateway({ stateFile });

console.log(`[scope-private] gateway listening on http://${host}:${port}`);
console.log(`[scope-private] access token is stored in ${stateFile}`);
console.log("[scope-private] expose this loopback URL with Tailscale Serve; never use Funnel.");

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

