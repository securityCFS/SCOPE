import { spawn as spawnProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { LOCAL_HOST } from "../../lib/execution-host.js";

function localEnv() {
  const env = { ...process.env };
  const localBin = path.join(os.homedir(), ".local", "bin");
  const current = env.PATH || "";
  if (!current.split(path.delimiter).includes(localBin)) {
    env.PATH = current ? `${localBin}${path.delimiter}${current}` : localBin;
  }
  return env;
}

/**
 * Host command runner supporting remote SSH hosts and (on POSIX) the local host.
 * Preserves the exact `{ code, stdout, stderr }` contract of `runSshCommand`.
 */
export function createHostCommand(
  runSshCommand,
  { allowLocal = process.platform !== "win32", spawn = spawnProcess } = {},
) {
  return async function runHostCommand(
    alias,
    command,
    input = "",
    timeoutMs = 20000,
    maxStdout = 2000000,
  ) {
    if (alias !== LOCAL_HOST) {
      return runSshCommand(alias, command, input, timeoutMs, maxStdout);
    }
    if (!allowLocal) {
      throw new Error("此操作仅适用于远端 SSH 主机");
    }
    return new Promise((resolve) => {
      let child;
      let timer;
      let settled = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdout = [];
      const stderr = [];
      const stopChild = () => {
        try {
          child?.kill();
        } catch {
          /* already exited */
        }
      };
      const finish = (code, message = "") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8") + message,
        });
      };
      try {
        child = spawn("bash", ["-c", command], {
          env: localEnv(),
          windowsHide: true,
        });
        timer = setTimeout(() => {
          finish(124, `\n本机命令超过 ${Math.round(timeoutMs / 1000)} 秒`);
          stopChild();
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
          if (settled) return;
          const bytes = Buffer.from(chunk);
          const available = Math.max(0, maxStdout - stdoutBytes);
          stdout.push(bytes.subarray(0, available));
          stdoutBytes += bytes.length;
          if (stdoutBytes > maxStdout) {
            finish(125, "\n本机输出超过大小限制；未将截断数据当作成功结果");
            stopChild();
          }
        });
        child.stderr.on("data", (chunk) => {
          if (settled || stderrBytes >= 200000) return;
          const bytes = Buffer.from(chunk).subarray(0, 200000 - stderrBytes);
          stderr.push(bytes);
          stderrBytes += bytes.length;
        });
        child.stdin.on("error", (error) => {
          if (!settled) stderr.push(Buffer.from(`\n${error.message}`));
        });
        child.on("error", (error) => finish(1, `\n${error.message}`));
        child.on("close", (code) => finish(code ?? 1));
        child.stdin.end(input);
      } catch (error) {
        finish(1, `\n${error.message}`);
        stopChild();
      }
    });
  };
}
