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
const { server, host, port, portOrigin, shareOrigin, allowSameOriginShare } =
  await startPrivateGateway({ stateFile });

console.log(`[scope-private] gateway listening on http://${host}:${port}`);
console.log(`[scope-private] access token is stored in ${stateFile}`);
console.log("[scope-private] expose via Tailscale Serve (never Funnel) or Cloudflare Tunnel + Zero Trust Access.");
console.log("[scope-private] run `scope token --show` to view your login token.");
console.log(
  portOrigin
    ? `[scope-private] forwarded ports are isolated on ${portOrigin}`
    : "[scope-private] forwarded ports share this origin; set SCOPE_PORT_ORIGIN to isolate them (see docs/remote-access.md).",
);
if (shareOrigin) {
  console.log(
    `[scope-private] opt-in public static document shares are isolated on ${shareOrigin} (/s/<token>/, GET/HEAD only).`,
  );
} else if (allowSameOriginShare) {
  console.log(
    "[scope-private] opt-in public static document shares enabled on /scope-share/<token>/ (GET/HEAD only; consider isolating with SCOPE_SHARE_ORIGIN).",
  );
}

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  const forceExit = setTimeout(() => process.exit(0), 1_500);
  forceExit.unref?.();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

