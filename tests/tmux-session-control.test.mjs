import { bridgeSource } from "./helpers/bridge-source.mjs";
import { workspaceSource } from "./helpers/workspace-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExactTmuxTerminateCommand,
  normalizeTmuxSessionName,
} from "../bridge/tmux-session-control.mjs";

test("tmux termination uses one exact session target", () => {
  const command = buildExactTmuxTerminateCommand("scope-old-run");
  assert.match(command, /tmux has-session -t '=scope-old-run'/);
  assert.match(command, /tmux kill-session -t '=scope-old-run'/);
  assert.doesNotMatch(command, /kill-server|pkill|killall/);
});

test("tmux termination safely quotes names and rejects control characters", () => {
  const command = buildExactTmuxTerminateCommand("paper's run");
  assert.match(command, /'=paper'\"'\"'s run'/);
  assert.equal(normalizeTmuxSessionName(" run with spaces "), " run with spaces ");
  assert.throws(() => normalizeTmuxSessionName("bad\nname"), /控制字符/);
  assert.throws(() => normalizeTmuxSessionName(""), /为空或过长/);
});

test("tmux termination is separate from app-server close and preserves rollout", async () => {
  const [server, page] = await Promise.all([
    bridgeSource(),
    workspaceSource(),
  ]);
  assert.match(server, /\/api\/tmux\/session\/terminate/);
  assert.match(server, /buildExactTmuxTerminateCommand\(tmuxSession\)/);
  assert.match(server, /rolloutPreserved: true/);
  assert.match(page, /\/api\/tmux\/session\/terminate/);
  assert.match(page, /终止 tmux/);
});
