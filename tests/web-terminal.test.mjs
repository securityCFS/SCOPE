import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRemoteTerminalCommand,
  sshTerminalArguments,
  terminalDimension,
} from "../bridge/web-terminal.mjs";

test("web terminal starts the remote login shell in the selected directory", () => {
  const command = buildRemoteTerminalCommand({
    cwd: "/data/researcher's run",
    cols: 132,
    rows: 41,
  });
  assert.match(command, /stty rows 41 cols 132/);
  assert.match(command, /cd -- '\/data\/researcher'"'"'s run'/);
  assert.match(command, /exec "\$SHELL" -l/);
  assert.doesNotMatch(command, /bashrc|zshrc|kill|pkill/);
});

test("web terminal attaches an exact tmux target without terminating it", () => {
  const command = buildRemoteTerminalCommand({
    tmuxSession: "=scope-lab's-run",
  });
  assert.match(command, /exec tmux attach-session -t '=scope-lab'"'"'s-run'/);
  assert.doesNotMatch(command, /kill-session|kill-server|pkill/);
});

test("web terminal SSH arguments force a PTY and keep the connection alive", () => {
  const arguments_ = sshTerminalArguments({
    host: "gpu-box",
    command: "exec /bin/sh -l",
    timeoutSeconds: 9,
  });
  assert.deepEqual(arguments_.slice(0, 3), ["-tt", "-o", "BatchMode=yes"]);
  assert.ok(arguments_.includes("StrictHostKeyChecking=yes"));
  assert.ok(arguments_.includes("ConnectTimeout=9"));
  assert.ok(arguments_.includes("ServerAliveInterval=15"));
  assert.deepEqual(arguments_.slice(-3), ["--", "gpu-box", "exec /bin/sh -l"]);
});

test("terminal dimensions are clamped to safe bounds", () => {
  assert.equal(terminalDimension("0", 28, 200), 2);
  assert.equal(terminalDimension("999", 28, 200), 200);
  assert.equal(terminalDimension("nope", 28, 200), 28);
});
