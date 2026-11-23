import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  launchVscodeRemoteFile,
  normalizeRemoteAbsolutePath,
  normalizeRemoteFileTarget,
  resolveVscodeExecutable,
  vscodeRemoteOpenArgs,
} from "../bridge/vscode-opener.mjs";

test("opens the real remote workspace and then goes to the remote file location", () => {
  assert.deepEqual(
    vscodeRemoteOpenArgs({
      host: "gpu-box",
      cwd: "/mnt/cluster/dev/codespace/refs/vision_model",
      file: "/mnt/cluster/dev/codespace/refs/vision_model/results/a report.md",
      line: 176,
      column: 4,
    }),
    [
      "--remote",
      "ssh-remote+gpu-box",
      "--new-window",
      "/mnt/cluster/dev/codespace/refs/vision_model",
      "--goto",
      "/mnt/cluster/dev/codespace/refs/vision_model/results/a report.md:176:4",
    ],
  );
});

test("opens a remote workspace without inventing a file URL", () => {
  assert.deepEqual(
    vscodeRemoteOpenArgs({ host: "gpu-box", cwd: "/work/repo" }),
    ["--remote", "ssh-remote+gpu-box", "--new-window", "/work/repo"],
  );
});

test("separates legacy line suffixes from the remote filename", () => {
  assert.deepEqual(
    normalizeRemoteFileTarget({ file: "/work/repo/report.md:91:3" }),
    { path: "/work/repo/report.md", line: 91, column: 3 },
  );
});

test("rejects relative remote paths", () => {
  assert.throws(
    () => normalizeRemoteAbsolutePath("results/report.md"),
    /必须是绝对路径/,
  );
});

test("finds a standard Windows VS Code installation", () => {
  const expected =
    "C:\\Users\\Dev\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe";
  assert.equal(
    resolveVscodeExecutable({
      env: { LOCALAPPDATA: "C:\\Users\\Dev\\AppData\\Local" },
      platform: "win32",
      fileExists: (candidate) => candidate === expected,
    }),
    expected,
  );
});

test("launches one VS Code process containing the remote workspace and file", async () => {
  const calls = [];
  let unrefCalled = false;
  const result = await launchVscodeRemoteFile(
    {
      host: "gpu-box",
      cwd: "/workspace/project",
      file: "/workspace/project/results/report.md",
    },
    {
      env: { SCOPE_VSCODE_EXECUTABLE: "C:\\Tools\\Code.exe" },
      platform: "win32",
      resolveExecutable: () => "C:\\Tools\\Code.exe",
      spawnProcess: (executable, args, options) => {
        calls.push({ executable, args, options });
        const child = new EventEmitter();
        child.unref = () => {
          unrefCalled = true;
        };
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, "C:\\Tools\\Code.exe");
  assert.deepEqual(calls[0].args.slice(0, 2), [
    "--remote",
    "ssh-remote+gpu-box",
  ]);
  assert.deepEqual(calls[0].args.slice(2), [
    "--new-window",
    "/workspace/project",
    "--goto",
    "/workspace/project/results/report.md",
  ]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, "ignore");
  assert.equal(unrefCalled, true);
  assert.equal(result.executable, "C:\\Tools\\Code.exe");
});
