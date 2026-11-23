import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { shellQuote } from "./cli-command.mjs";

const source = readFile(new URL("./claude-interactive.py", import.meta.url));

export async function claudeInteractiveCommand(task, providerSettings = {}) {
  const code = deflateSync(await source).toString("base64");
  const setup = String(providerSettings?.preLaunchCommand || "").trim();
  const bootstrap = setup
    ? `${setup}\nscope_proxy_status=$?\nif [ "$scope_proxy_status" -ne 0 ]; then exit "$scope_proxy_status"; fi\n`
    : "";
  return `${bootstrap}exec python3 -c ${shellQuote(`import base64,zlib;exec(zlib.decompress(base64.b64decode('${code}')))`)} ${shellQuote(task.id)}`;
}
