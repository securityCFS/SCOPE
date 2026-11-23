import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function pythonExecutable() {
  const bundled = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
  return process.env.SCOPE_PYTHON || (process.platform === "win32" && existsSync(bundled) ? bundled : process.platform === "win32" ? "python" : "python3");
}

/** Execute a read-only probe locally, without a shell or a remote transport. */
export function runLocalPython(script, args = [], timeoutMs = 30_000, maxBytes = 8_000_000) {
  return new Promise((resolve) => {
    const child = spawn(pythonExecutable(), ["-", ...args], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let stdout = "", stderr = "", bytes = 0, settled = false;
    const finish = (code, error = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr: stderr + error });
    };
    const timer = setTimeout(() => { finish(124, "本机检索超时"); child.kill(); }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) { finish(125, "本机检索输出超过限制"); child.kill(); }
      else stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = (stderr + chunk).slice(-20_000); });
    child.on("error", (error) => finish(127, error.message));
    child.on("close", (code) => finish(code ?? 1));
    child.stdin.on("error", () => {});
    child.stdin.end(script);
  });
}
