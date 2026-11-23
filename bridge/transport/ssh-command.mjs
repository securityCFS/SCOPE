import { spawn as spawnProcess } from "node:child_process";
import { LOCAL_HOST } from "../../lib/execution-host.js";

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

/** Local SSH transport only. A timeout never sends remote process-kill commands. */
export function createSshCommand({
  inventoryOperations,
  operationCounts,
  connectTimeoutMs,
  audit,
  spawn = spawnProcess,
}) {
  return async function runSshCommand(
    alias,
    command,
    input = "",
    timeoutMs = 20000,
    maxStdout = 2000000,
  ) {
    if (alias === LOCAL_HOST) throw new Error("此操作仅适用于远端 SSH 主机");
    await inventoryOperations.get(alias)?.catch(() => {});
    return new Promise((resolve) => {
      operationCounts.set(alias, (operationCounts.get(alias) || 0) + 1);
      let child,
        timer,
        settled = false,
        stdoutBytes = 0,
        stderrBytes = 0;
      const stdout = [],
        stderr = [];
      const stopLocalClient = () => {
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
        const remaining = (operationCounts.get(alias) || 1) - 1;
        if (remaining > 0) operationCounts.set(alias, remaining);
        else operationCounts.delete(alias);
        resolve({
          code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8") + message,
        });
      };
      try {
        child = spawn(
          process.platform === "win32" ? "ssh.exe" : "ssh",
          [
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ConnectionAttempts=1",
            "-o",
            `ConnectTimeout=${Math.ceil(connectTimeoutMs / 1000)}`,
            "--",
            alias,
            command,
          ],
          { windowsHide: true },
        );
        timer = setTimeout(() => {
          Promise.resolve()
            .then(() =>
              audit("local-ssh-client-timeout", {
                host: alias,
                timeoutMs,
                remoteSessionSignalSent: false,
              }),
            )
            .catch(() => {});
          finish(124, `\n远端命令超过 ${Math.round(timeoutMs / 1000)} 秒`);
          stopLocalClient();
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
          if (settled) return;
          const bytes = Buffer.from(chunk);
          const available = Math.max(0, maxStdout - stdoutBytes);
          stdout.push(bytes.subarray(0, available));
          stdoutBytes += bytes.length;
          if (stdoutBytes > maxStdout) {
            finish(125, "\n远端输出超过大小限制；未将截断数据当作成功结果");
            stopLocalClient();
          }
        });
        child.stderr.on("data", (chunk) => {
          if (settled || stderrBytes >= 200000) return;
          const bytes = Buffer.from(chunk).subarray(0, 200000 - stderrBytes);
          stderr.push(bytes);
          stderrBytes += bytes.length;
        });
        // SSH may exit before a large probe has finished writing to stdin.
        child.stdin.on("error", (error) => {
          if (!settled) {
            const bytes = Buffer.from(`\n${error.message}`);
            stderr.push(bytes);
          }
        });
        child.on("error", (error) => finish(1, `\n${error.message}`));
        child.on("close", (code) => finish(code ?? 1));
        child.stdin.end(input);
      } catch (error) {
        finish(1, `\n${error.message}`);
        stopLocalClient();
      }
    });
  };
}
