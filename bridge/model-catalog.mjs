import { profileFromConnection } from "./session-profiles.mjs";

export function modelCatalogTarget(host, connectionKey = "active") {
  const profile = profileFromConnection(connectionKey);
  return {
    key: `${host}:${profile || "host-default"}`,
    profile,
    home: profile
      ? `$HOME/.codex/scope-auth-profiles/${profile}/home`
      : "$HOME/.codex",
  };
}

export function modelCatalogHomeCommands(target) {
  return [
    `export CODEX_HOME="${target.home}"`,
    ...(target.profile
      ? ['test -f "$CODEX_HOME/auth.json" || { echo "Profile is not logged in" >&2; exit 76; }']
      : []),
  ];
}
