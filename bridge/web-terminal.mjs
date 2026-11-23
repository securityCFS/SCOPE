function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

export function terminalDimension(value, fallback, maximum) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric)
    ? Math.max(2, Math.min(maximum, numeric))
    : fallback;
}

export function buildRemoteTerminalCommand({
  cwd,
  tmuxSession = "",
  cols = 100,
  rows = 28,
}) {
  const size = `stty rows ${terminalDimension(rows, 28, 200)} cols ${terminalDimension(cols, 100, 400)} 2>/dev/null || true;`;
  if (tmuxSession) {
    return `${size} exec tmux attach-session -t ${shellQuote(tmuxSession)}`;
  }
  const changeDirectory = cwd ? `cd -- ${shellQuote(cwd)} || exit $?;` : "";
  return [
    size,
    changeDirectory,
    'if [ -n "$SHELL" ] && [ -x "$SHELL" ]; then exec "$SHELL" -l; fi;',
    "exec /bin/sh -l",
  ]
    .filter(Boolean)
    .join(" ");
}

export function sshTerminalArguments({ host, command, timeoutSeconds = 7 }) {
  return [
    "-tt",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    `ConnectTimeout=${Math.max(2, Math.ceil(Number(timeoutSeconds) || 7))}`,
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "--",
    host,
    command,
  ];
}
