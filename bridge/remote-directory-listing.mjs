import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const DIRECTORY_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 2_000_000;

const DIRECTORY_PROBE = String.raw`
import json
import os
import sys

requested = sys.argv[1]
if not requested.startswith("/") or "\n" in requested or "\r" in requested:
    print("工作目录必须是远端绝对路径", file=sys.stderr)
    raise SystemExit(2)
resolved = os.path.realpath(requested)
if not os.path.isdir(resolved):
    print("工作目录不存在：" + resolved, file=sys.stderr)
    raise SystemExit(3)

directories = []
truncated = False
try:
    names = sorted(os.listdir(resolved), key=lambda value: value.lower())
    for name in names:
        candidate = os.path.join(resolved, name)
        try:
            if os.path.isdir(candidate):
                directories.append({"name": name, "path": candidate})
        except OSError:
            continue
        if len(directories) >= 300:
            truncated = True
            break
except OSError as error:
    print("无法读取工作目录：" + str(error), file=sys.stderr)
    raise SystemExit(4)

parent = os.path.dirname(resolved)
print(json.dumps({
    "cwd": resolved,
    "parent": parent if parent != resolved else None,
    "directories": directories,
    "truncated": truncated,
}, ensure_ascii=False, separators=(",", ":")))
`;

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function cleanError(value) {
  return String(value || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trim()
    .slice(0, 2_000);
}

export function listRemoteDirectories({
  host,
  requestedPath,
  sshConfig = path.join(os.homedir(), ".ssh", "config"),
  timeoutMs = DIRECTORY_TIMEOUT_MS,
} = {}) {
  const alias = String(host || "").trim();
  const remotePath = String(requestedPath || "/").trim();
  if (!alias || !/^[a-zA-Z0-9_.:@-]+$/.test(alias)) {
    return Promise.reject(new Error("SSH 主机名无效"));
  }
  if (!remotePath.startsWith("/") || /[\r\n]/.test(remotePath)) {
    return Promise.reject(new Error("工作目录必须是远端绝对路径"));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      [
        "-F",
        sshConfig,
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        "--",
        alias,
        `python3 - ${shellQuote(remotePath)}`,
      ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    let timer = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new Error("远端目录列表过大"));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorOutput = cleanError(Buffer.concat(stderr).toString("utf8"));
      if (code !== 0) {
        finish(new Error(errorOutput || `SSH 目录读取退出码 ${code}`));
        return;
      }
      try {
        const listing = JSON.parse(output);
        finish(null, {
          host: alias,
          cwd: String(listing.cwd || remotePath),
          parent: listing.parent ? String(listing.parent) : null,
          directories: Array.isArray(listing.directories)
            ? listing.directories
                .filter((entry) => entry?.name && entry?.path)
                .map((entry) => ({
                  name: String(entry.name),
                  path: String(entry.path),
                }))
            : [],
          truncated: Boolean(listing.truncated),
        });
      } catch {
        finish(new Error("远端目录结果无法解析"));
      }
    });
    timer = setTimeout(() => {
      child.kill();
      finish(new Error("读取远端目录超时"));
    }, timeoutMs);
    child.stdin.end(DIRECTORY_PROBE);
  });
}
