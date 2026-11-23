import { prepareProfileHome, profileHomeSelection } from "./remote-profile-home.mjs";

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'"'"'`)}'`;
}

function safeKey(value) {
  return String(value || "default")
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .slice(0, 80);
}

export function durableRemoteAppServerCommand({
  executable = "codex",
  key = "default",
  codexHome = "",
  useActiveProfile = false,
  isolatedProfile = "",
} = {}) {
  const id = safeKey(key);
  const setup = [
    "set -eu",
    'test ! -d "$HOME/.scope-codex-migration.lock" || { echo "SCOPE Codex storage migration in progress; retry after completion" >&2; exit 75; }',
    `scope_codex_exe=${shellQuote(executable)}`,
  ];
  if (isolatedProfile) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(isolatedProfile)) throw new Error("Invalid isolated profile");
    setup.push(
      `app_id=${shellQuote(id)}`,
      ...prepareProfileHome(isolatedProfile),
      // A shared rollout requires a shared writer lock across CODEX_HOME values.
      'mkdir -p "$HOME/.codex/thread-writer-locks"',
      'if test -d "$app_codex_home/thread-writer-locks" && test ! -L "$app_codex_home/thread-writer-locks"; then',
      '  rmdir "$app_codex_home/thread-writer-locks" 2>/dev/null || { echo "Profile has private writer locks; refusing unsafe history sharing" >&2; exit 77; }',
      'fi',
      'if test ! -L "$app_codex_home/thread-writer-locks"; then ln -s "$HOME/.codex/thread-writer-locks" "$app_codex_home/thread-writer-locks" 2>/dev/null || test -L "$app_codex_home/thread-writer-locks"; fi',
      'test "$(readlink -f "$app_codex_home/thread-writer-locks")" = "$(readlink -f "$HOME/.codex/thread-writer-locks")" || { echo "Profile writer lock directory mismatch" >&2; exit 77; }',
      // Share instructions/history, never credentials or the runtime database.
      'for scope_shared in config.toml AGENTS.md skills memories sessions archived_sessions; do',
      '  if test ! -e "$app_codex_home/$scope_shared" && test ! -L "$app_codex_home/$scope_shared" && test -e "$HOME/.codex/$scope_shared"; then',
      '    ln -s "$HOME/.codex/$scope_shared" "$app_codex_home/$scope_shared" 2>/dev/null || test -e "$app_codex_home/$scope_shared"',
      '  fi',
      'done',
    );
  } else if (codexHome) {
    setup.push(`app_id=${shellQuote(id)}`, `app_codex_home="${codexHome}"`);
  } else if (useActiveProfile) {
    setup.push(
      'root_codex_home="$HOME/.codex"',
      'active_slug="$(cat "$root_codex_home/scope-auth-profiles/active" 2>/dev/null || true)"',
      "case \"$active_slug\" in",
      '  ""|*[!a-zA-Z0-9._-]*) app_id=default; app_codex_home="$root_codex_home" ;;',
      '  *) candidate_home="$root_codex_home/scope-auth-profiles/$active_slug/home"; if test -f "$candidate_home/auth.json"; then app_id="profile-$active_slug"; app_codex_home="$root_codex_home"; else app_id=default; app_codex_home="$root_codex_home"; fi ;;',
      "esac",
    );
  } else {
    setup.push(
      `app_id=${shellQuote(id)}`,
      'app_codex_home="$HOME/.codex"',
    );
  }
  return [
    ...setup,
    'tmux_name="scope-app-server-$app_id"',
    'state_dir="$app_codex_home/app-server-control"',
    'socket_path="$state_dir/scope-$app_id.sock"',
    'log_path="$state_dir/scope-$app_id.log"',
    'lock_path="$state_dir/app-server-startup.lock"',
    'mkdir -p "$state_dir"',
    'lock_mode=none',
    'if command -v flock >/dev/null 2>&1; then',
    '  exec 9>"$lock_path"',
    '  if ! flock -w 15 9; then echo "SCOPE app-server startup lock timed out" >&2; exit 73; fi',
    '  lock_mode=flock',
    'else',
    '  lock_dir="$lock_path.d"',
    '  lock_attempt=0',
    '  while test "$lock_attempt" -lt 60; do',
    '    if mkdir "$lock_dir" 2>/dev/null; then lock_mode=mkdir; break; fi',
    '    lock_attempt=$((lock_attempt + 1))',
    '    sleep 0.25',
    '  done',
    '  if test "$lock_mode" != mkdir; then echo "SCOPE app-server startup lock timed out" >&2; exit 73; fi',
    'fi',
    'scope_unlock() {',
    '  if test "$lock_mode" = flock; then flock -u 9 || true; exec 9>&-; fi',
    '  if test "$lock_mode" = mkdir; then rmdir "$lock_dir" 2>/dev/null || true; fi',
    '  lock_mode=none',
    '}',
    'trap scope_unlock EXIT',
    "trap 'scope_unlock; exit 74' HUP INT TERM",
    'socket_is_live() {',
    '  test -S "$socket_path" || return 1',
    '  if command -v ss >/dev/null 2>&1; then',
    // Newer Codex daemons expose custom socket paths as symlinks into /tmp.
    // ss reports the bound target, not that public alias. Preserve live writers.
    '    scope_socket_target="$(readlink -f -- "$socket_path" 2>/dev/null || printf \'%s\' "$socket_path")"',
    '    ss -xlH 2>/dev/null | awk -v alias="$socket_path" -v target="$scope_socket_target" \'index($0, " " alias " ") || index($0, " " target " ") { found = 1 } END { exit !found }\'',
    '  else',
    '    tmux has-session -t "=$tmux_name" 2>/dev/null',
    '  fi',
    '}',
    'if test -S "$socket_path" && ! socket_is_live; then',
    '  if tmux has-session -t "=$tmux_name" 2>/dev/null; then',
    '    echo "SCOPE app-server tmux $tmux_name exists but its socket is not listening; preserving it for inspection" >&2',
    '    exit 71',
    '  fi',
    '  rm -f -- "$socket_path"',
    'fi',
    'if ! socket_is_live; then',
    '  if tmux has-session -t "=$tmux_name" 2>/dev/null; then',
    '    echo "SCOPE app-server tmux $tmux_name exists without a live socket; refusing to terminate or replace it" >&2',
    '    exit 71',
    '  fi',
    '  tmux new-session -d -s "$tmux_name" "export CODEX_HOME=\"$app_codex_home\"; exec \"$scope_codex_exe\"' + (isolatedProfile ? ' -c cli_auth_credentials_store=file' : '') + ' app-server --listen \"unix://$socket_path\" >>\"$log_path\" 2>&1"',
    '  ready=0',
    '  ready_attempt=0',
    '  while test "$ready_attempt" -lt 60; do',
    '    if socket_is_live; then ready=1; break; fi',
    '    ready_attempt=$((ready_attempt + 1))',
    '    sleep 0.25',
    '  done',
    '  if test "$ready" != 1; then echo "SCOPE app-server $tmux_name did not create a live socket within 15 seconds; pane preserved for inspection" >&2; tail -n 20 "$log_path" >&2 || true; exit 72; fi',
    "fi",
    'scope_unlock',
    'trap - EXIT HUP INT TERM',
    'export CODEX_HOME="$app_codex_home"',
    'exec "$scope_codex_exe" app-server proxy --sock "$socket_path"',
  ].join("\n");
}

export function retireProfileAppServerCommand(connectionKey) {
  const id = String(connectionKey || "").trim();
  if (!/^profile-[a-zA-Z0-9_.-]{1,80}$/.test(id)) {
    throw new Error("Refusing to retire a non-profile app-server writer");
  }
  return [
    "set -eu",
    `app_id=${shellQuote(id)}`,
    'tmux_name="scope-app-server-$app_id"',
    'state_dir="$HOME/.codex/app-server-control"',
    'socket_path="$state_dir/scope-$app_id.sock"',
    'if tmux has-session -t "=$tmux_name" 2>/dev/null; then',
    '  pane_count="$(tmux list-panes -t "=$tmux_name" -F \'#{pane_pid}\' | wc -l | tr -d \' \')"',
    '  test "$pane_count" = 1 || { echo "unexpected pane count: $pane_count" >&2; exit 78; }',
    '  pane_pid="$(tmux list-panes -t "=$tmux_name" -F \'#{pane_pid}\')"',
    '  pane_args="$(ps -o args= -p "$pane_pid" 2>/dev/null || true)"',
    '  case "$pane_args" in',
    '    *"codex app-server --listen unix://$socket_path"*) ;;',
    '    *) echo "refusing non-SCOPE tmux command: $pane_args" >&2; exit 79 ;;',
    '  esac',
    '  tmux kill-session -t "=$tmux_name"',
    'fi',
    'attempt=0',
    'while test "$attempt" -lt 40 && test -S "$socket_path"; do',
    '  sleep 0.1',
    '  attempt=$((attempt + 1))',
    'done',
    'if test -S "$socket_path"; then rm -f -- "$socket_path"; fi',
    'printf \'{"retired":true,"tmux":"%s"}\\n\' "$tmux_name"',
  ].join("\n");
}

// Explicit config reload only: exact named SCOPE daemon, never a process-tree kill.
export function retireScopedAppServerCommand(connectionKey) {
  const id = String(connectionKey || "");
  const account = /^account-([a-zA-Z0-9][a-zA-Z0-9._-]{0,47})$/.exec(id);
  if (!account && !/^profile-[a-zA-Z0-9_.-]{1,48}$/.test(id)) {
    throw new Error("无法确认 SCOPE daemon 归属，拒绝重启");
  }
  const base = retireProfileAppServerCommand(account ? `profile-${account[1]}` : id);
  return account ? base
    .replace(`app_id=${shellQuote(`profile-${account[1]}`)}`, `app_id=${shellQuote(id)}`)
    .replace('state_dir="$HOME/.codex/app-server-control"',
      [...profileHomeSelection(account[1]), 'state_dir="$app_codex_home/app-server-control"'].join("\n"))
    .replace('*"codex app-server --listen unix://$socket_path"*', '*"codex -c cli_auth_credentials_store=file app-server --listen unix://$socket_path"*') : base;
}

/** Run the bootstrap handler in the host's preferred interactive shell.
 *
 * `-c` is important for app-server: it keeps the shell from reading JSONL from
 * stdin as another command. The final exec gives that unchanged stream to
 * Codex. Hosts without zsh retain the established Bash bootstrap path.
 */
export function wrapBootstrapAppServer(command, preLaunchCommand = "") {
  const startup = String(preLaunchCommand || "").trim();
  const zshHandler = [startup, command].filter(Boolean).join("; ");
  const bashHandler = [
    "source ~/.bashrc >/dev/null 2>&1 || true",
    startup,
    command,
  ].filter(Boolean).join("; ");
  return [
    "if command -v zsh >/dev/null 2>&1",
    `then exec zsh -ic ${shellQuote(zshHandler)}`,
    `else exec bash -ic ${shellQuote(bashHandler)}`,
    "fi",
  ].join("; ");
}

export function wrapProxyBootstrapAppServer(command, preLaunchCommand = "") {
  return wrapBootstrapAppServer(command, preLaunchCommand);
}
