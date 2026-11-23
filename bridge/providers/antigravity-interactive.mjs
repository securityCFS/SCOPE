import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { shellQuote } from "./cli-command.mjs";

export async function antigravityInteractiveCommand(task, providerSettings = {}) {
  const [forms, worker] = await Promise.all(["acp-forms.py", "antigravity-interactive.py"].map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  const source = `import types,sys\nm=types.ModuleType('scope_acp_forms')\nexec(${JSON.stringify(forms)},m.__dict__)\nsys.modules[m.__name__]=m\n${worker}`;
  const encoded = deflateSync(Buffer.from(source)).toString("base64");
  const setup = String(providerSettings?.preLaunchCommand || "").trim();
  const bootstrap = setup
    ? `${setup}\nscope_proxy_status=$?\nif [ "$scope_proxy_status" -ne 0 ]; then exit "$scope_proxy_status"; fi\n`
    : "";
  return `${bootstrap}exec python3 -c ${shellQuote(`import base64,zlib;exec(zlib.decompress(base64.b64decode('${encoded}')))`)} ${shellQuote(task.id)}`;
}
