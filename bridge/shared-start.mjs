import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateGateway, loadOrCreatePrivateAccessToken } from "./private-gateway.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, ".scope", "shared-access");
const config = JSON.parse(await readFile(path.join(directory, "config.json"), "utf8"));
if (!isIP(config.host) || ["0.0.0.0", "::"].includes(config.host) ||
    !Array.isArray(config.allowedClients) || !config.allowedClients.length ||
    config.allowedClients.some(address => !isIP(address)) ||
    !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
  throw new Error("Shared access requires a specific local IP, port and explicit client IP allowlist");
}
const token = await loadOrCreatePrivateAccessToken(path.join(directory, "access.json"));
const server = createPrivateGateway({ token, allowedClients: config.allowedClients, tls: {
  key: await readFile(path.join(directory, "server.key")),
  cert: await readFile(path.join(directory, "server.crt")),
} });
server.listen(config.port, config.host, () => console.log(`SCOPE shared access: https://${config.host}:${config.port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
