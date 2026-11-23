const quote = value => `'${String(value).replaceAll("'", `'"'"'`)}'`;
export function guardPersistentCodexHome(command, home) {
  if (!home) return command;
  if (typeof home !== "string" || !home.startsWith("/") || home === "/" || home.startsWith("/tmp/") || home.includes("\n") || home.split("/").includes("..")) throw new Error("Invalid persistent Codex home");
  return `test -d ${quote(home)} && test "$(readlink -f \"$HOME/.codex\")" = ${quote(home)} || { echo 'SCOPE persistent Codex directory is not attached; refusing restored-image data' >&2; exit 78; }; ${command}`;
}
