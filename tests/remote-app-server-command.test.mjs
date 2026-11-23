import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  durableRemoteAppServerCommand,
  retireProfileAppServerCommand,
  wrapBootstrapAppServer,
  wrapProxyBootstrapAppServer,
} from "../bridge/remote-app-server-command.mjs";

test("retires only an exact SCOPE-owned profile app-server tmux", () => {
  const command = retireProfileAppServerCommand("profile-pro-plus");
  assert.match(command, /app_id='profile-pro-plus'/);
  assert.match(command, /scope-app-server-\$app_id/);
  assert.match(command, /codex app-server --listen unix:\/\/\$socket_path/);
  assert.match(command, /tmux kill-session -t "=\$tmux_name"/);
  assert.doesNotMatch(command, /pkill|killall|rm -rf/);
  assert.throws(() => retireProfileAppServerCommand("active"), /non-profile/);
  assert.throws(
    () => retireProfileAppServerCommand("profile-old; touch /tmp/no"),
    /non-profile/,
  );
});

test("proxy bootstrap isolates app-server JSONL from interactive shell startup", () => {
  const direct = wrapProxyBootstrapAppServer(
    "exec '/opt/codex' app-server --listen stdio://",
  );
  assert.doesNotMatch(direct, /proxy/);

  const command = wrapProxyBootstrapAppServer(
    "exec '/opt/codex' app-server --listen stdio://",
    "source /opt/env/proxy.sh",
  );

  assert.match(command, /^if command -v zsh/);
  assert.match(command, /then exec zsh -ic/);
  assert.match(command, /else exec bash -ic/);
  assert.match(command, /source ~\/\.bashrc/);
  assert.match(command, /source \/opt\/env\/proxy\.sh/);
  assert.match(command, /exec .*app-server/);
  assert.doesNotMatch(command, /<\/dev\/null/);
});

test("proxy bootstrap safely quotes commands containing single quotes", () => {
  const command = wrapProxyBootstrapAppServer(
    "export CODEX_HOME=\"$HOME/profile's home\"; '/opt/codex' app-server",
  );

  assert.match(command, /'\"'\"'/);
  assert.match(command, /CODEX_HOME/);
});

test("custom startup commands run in the preferred interactive shell", () => {
  const command = wrapBootstrapAppServer(
    "exec codex app-server --listen stdio://",
    "source /opt/lab/network.sh && export https_proxy=http://127.0.0.1:7890",
  );

  assert.match(command, /source \/opt\/lab\/network\.sh && export https_proxy/);
  assert.match(command, /zsh -ic/);
  assert.match(command, /bash -ic/);
});

test("durable app-server is idempotent and never replaces its remote tmux", () => {
  const command = durableRemoteAppServerCommand({
    executable: "/opt/codex",
    key: "default",
  });
  assert.match(command, /app-server --listen/);
  assert.match(command, /app-server proxy --sock/);
  assert.match(command, /tmux new-session/);
  assert.match(command, /tmux has-session -t "=\$tmux_name"/);
  assert.match(command, /refusing to terminate or replace it/);
  assert.doesNotMatch(command, /kill-session|kill-pane|pkill|SIGTERM|SIGKILL/);
});

test("durable app-server heals only an unowned stale SCOPE socket", () => {
  const command = durableRemoteAppServerCommand({
    executable: "/opt/codex",
    key: "stale-profile",
  });

  assert.match(command, /socket_is_live\(\)/);
  assert.match(command, /app_id='stale-profile'/);
  assert.match(command, /scope-\$app_id\.sock/);
  assert.match(command, /ss -xl/);
  assert.match(command, /flock -w 15/);
  assert.match(
    command,
    /test -S "\$socket_path" && ! socket_is_live[\s\S]*?tmux has-session[\s\S]*?rm -f -- "\$socket_path"/,
  );
  assert.match(command, /did not create a live socket/);
  assert.match(command, /ready_attempt.*-lt 60/);
  assert.doesNotMatch(command, /rm -rf|find .* -delete/);
});

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
test("socket health accepts canonical aliases and rejects stale or prefix-only listeners", { skip: !existsSync(bash) }, () => {
  const command = durableRemoteAppServerCommand();
  const health = command.match(/socket_is_live\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(health);
  const script = [
    'socket_path="/home/test profile/control.sock"',
    'test() { if [ "$1" = "-S" ]; then [ "$FIXTURE_SOCKET" = 1 ]; else builtin test "$@"; fi; }',
    'readlink() { printf "%s" "$FIXTURE_TARGET"; }',
    'ss() { printf "%s\\n" "$FIXTURE_LISTENERS"; }',
    health,
    'socket_is_live',
  ].join("\n");
  const listener = (path) => `u_str LISTEN 0 4096 ${path} 123 * 0`;
  for (const [name, target, listeners, socket, expected] of [
    ["direct", "/home/test profile/control.sock", listener("/home/test profile/control.sock"), "1", 0],
    ["Codex alias", "/tmp/codex-daemon-0/hash", listener("/tmp/codex-daemon-0/hash"), "1", 0],
    ["missing listener", "/tmp/codex-daemon-0/hash", "", "1", 1],
    ["prefix collision", "/tmp/codex-daemon-0/hash", listener("/tmp/codex-daemon-0/hash-other"), "1", 1],
    ["missing socket", "/tmp/codex-daemon-0/hash", listener("/tmp/codex-daemon-0/hash"), "0", 1],
  ]) {
    const result = spawnSync(bash, ["--noprofile", "--norc", "-c", script], {
      encoding: "utf8", env: { ...process.env, FIXTURE_TARGET: target, FIXTURE_LISTENERS: listeners, FIXTURE_SOCKET: socket },
    });
    assert.equal(result.status, expected, `${name}: ${result.stderr}`);
  }
});

test("default host app-server follows the active per-host account profile", () => {
  const command = durableRemoteAppServerCommand({
    executable: "/opt/codex",
    useActiveProfile: true,
  });
  assert.match(command, /scope-auth-profiles\/active/);
  assert.match(command, /candidate_home/);
  assert.match(command, /app_id="profile-\$active_slug"/);
  assert.match(command, /app_codex_home="\$root_codex_home"/);
  assert.match(command, /export CODEX_HOME/);
});
