// Existing CLI homes may have their own live writers. Never move their locks.
// A dedicated SCOPE runtime shares the host's rollout/lock namespace and only
// links credentials to the selected profile (including its auth commit lock).
export function profileHomeSelection(slug) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(slug)) throw new Error("Invalid isolated profile");
  return [
    `profile_root="$HOME/.codex/scope-auth-profiles/${slug}"`,
    'profile_auth_home="$profile_root/home"',
    'app_codex_home="$profile_auth_home"',
    'if test -d "$profile_root/scope-home" || { test -d "$profile_auth_home/thread-writer-locks" && test ! -L "$profile_auth_home/thread-writer-locks"; }; then',
    '  app_codex_home="$profile_root/scope-home"',
    'fi',
  ];
}

export function prepareProfileHome(slug) {
  return [
    ...profileHomeSelection(slug),
    'test -f "$profile_auth_home/auth.json" || { echo "Profile is not logged in" >&2; exit 76; }',
    'if test "$app_codex_home" != "$profile_auth_home"; then',
    '  (umask 077; mkdir -p "$app_codex_home")',
    // FileAuthStorage writes auth.json in place; auth.lock serializes commits.
    // https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs
    '  for scope_auth_file in auth.json auth.lock; do',
    '    scope_auth_target="$profile_auth_home/$scope_auth_file"',
    '    scope_auth_link="$app_codex_home/$scope_auth_file"',
    '    if test ! -e "$scope_auth_link" && test ! -L "$scope_auth_link"; then',
    '      ln -s "$scope_auth_target" "$scope_auth_link" 2>/dev/null || test -L "$scope_auth_link"',
    '    fi',
    '    test -L "$scope_auth_link" && test "$(readlink -f "$scope_auth_link")" = "$(readlink -f "$scope_auth_target")" || { echo "SCOPE profile credential link mismatch; preserving existing files" >&2; exit 77; }',
    '  done',
    '  for scope_config in config.toml AGENTS.md skills memories; do',
    '    if test -e "$profile_auth_home/$scope_config" && test ! -e "$app_codex_home/$scope_config" && test ! -L "$app_codex_home/$scope_config"; then',
    '      ln -s "$profile_auth_home/$scope_config" "$app_codex_home/$scope_config" 2>/dev/null || test -L "$app_codex_home/$scope_config"',
    '    fi',
    '  done',
    'fi',
  ];
}
