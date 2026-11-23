import { existsSync } from "node:fs";
import path from "node:path";

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}不能为空`);
  }
  if (value.includes("\0")) throw new Error(`${label}包含非法字符`);
  return value.trim();
}

export function normalizeRemoteAbsolutePath(value, label = "远端路径") {
  const candidate = requireText(value, label).replaceAll("\\", "/");
  if (!candidate.startsWith("/")) throw new Error(`${label}必须是绝对路径`);
  return path.posix.normalize(candidate);
}

function optionalPositiveInteger(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label}必须是正整数`);
  }
  return parsed;
}

export function normalizeRemoteFileTarget({ file, line, column }) {
  if (file === undefined || file === null || file === "") return null;
  let candidate = requireText(file, "远端文件").replaceAll("\\", "/");
  let normalizedLine = optionalPositiveInteger(line, "行号");
  let normalizedColumn = optionalPositiveInteger(column, "列号");
  const legacyWithColumn = candidate.match(/^(.*):(\d+):(\d+)$/);
  const legacyWithLine = candidate.match(/^(.*):(\d+)$/);
  const legacyPosition = legacyWithColumn || legacyWithLine;
  if (legacyPosition?.[1] && normalizedLine === null) {
    candidate = legacyPosition[1];
    normalizedLine = Number(legacyPosition[2]);
    normalizedColumn = legacyWithColumn
      ? Number(legacyWithColumn[3])
      : normalizedColumn;
  }
  if (normalizedColumn !== null && normalizedLine === null) {
    throw new Error("指定列号时必须同时指定行号");
  }
  return {
    path: normalizeRemoteAbsolutePath(candidate, "远端文件"),
    line: normalizedLine,
    column: normalizedColumn,
  };
}

export function vscodeRemoteOpenArgs(request) {
  const { host, cwd } = request;
  const normalizedHost = requireText(host, "SSH 主机");
  const normalizedCwd = normalizeRemoteAbsolutePath(cwd, "远端工作目录");
  const target = normalizeRemoteFileTarget(request);
  const args = [
    "--remote",
    `ssh-remote+${normalizedHost}`,
    "--new-window",
    normalizedCwd,
  ];
  if (target) {
    const positionedPath = [target.path, target.line, target.column]
      .filter((value) => value !== null)
      .join(":");
    args.push("--goto", positionedPath);
  }
  return args;
}

export function resolveVscodeExecutable({
  env = process.env,
  platform = process.platform,
  fileExists = existsSync,
} = {}) {
  const override = env.SCOPE_VSCODE_EXECUTABLE?.trim();
  if (override) return override;

  const candidates = [];
  if (platform === "win32") {
    if (env.LOCALAPPDATA) {
      candidates.push(
        path.win32.join(
          env.LOCALAPPDATA,
          "Programs",
          "Microsoft VS Code",
          "Code.exe",
        ),
        path.win32.join(
          env.LOCALAPPDATA,
          "Programs",
          "Microsoft VS Code Insiders",
          "Code - Insiders.exe",
        ),
      );
    }
    if (env.ProgramFiles) {
      candidates.push(
        path.win32.join(env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
      );
    }
    if (env["ProgramFiles(x86)"]) {
      candidates.push(
        path.win32.join(
          env["ProgramFiles(x86)"],
          "Microsoft VS Code",
          "Code.exe",
        ),
      );
    }
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
      "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron",
    );
  } else {
    return "code";
  }

  const executable = candidates.find((candidate) => fileExists(candidate));
  if (executable) return executable;
  throw new Error(
    "未找到本机 VS Code；可通过 SCOPE_VSCODE_EXECUTABLE 指定可执行文件",
  );
}

export function launchVscodeRemoteFile(
  request,
  {
    spawnProcess,
    resolveExecutable = resolveVscodeExecutable,
    env = process.env,
    platform = process.platform,
  } = {},
) {
  if (typeof spawnProcess !== "function") {
    throw new Error("缺少 VS Code 启动器");
  }

  const executable = resolveExecutable({ env, platform });
  const args = vscodeRemoteOpenArgs(request);

  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, args, {
      detached: true,
      env,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve({ executable, args });
    });
  });
}
