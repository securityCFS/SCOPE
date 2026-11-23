const MAX_TMUX_SESSION_NAME_LENGTH = 512;

function posixShellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

export function normalizeTmuxSessionName(value) {
  if (typeof value !== "string") {
    throw new TypeError("tmux Session 名称必须是字符串");
  }
  if (!value || value.length > MAX_TMUX_SESSION_NAME_LENGTH) {
    throw new Error("tmux Session 名称为空或过长");
  }
  if (/[\0\r\n\t]/.test(value)) {
    throw new Error("tmux Session 名称包含非法控制字符");
  }
  return value;
}

export function buildExactTmuxTerminateCommand(value) {
  const sessionName = normalizeTmuxSessionName(value);
  const target = posixShellQuote(`=${sessionName}`);
  return [
    `tmux has-session -t ${target} 2>/dev/null || { printf '%s\\n' 'SCOPE_TMUX_SESSION_MISSING' >&2; exit 44; }`,
    `tmux kill-session -t ${target} 2>/dev/null || true`,
    `if tmux has-session -t ${target} 2>/dev/null; then printf '%s\\n' 'SCOPE_TMUX_SESSION_STILL_RUNNING' >&2; exit 45; fi`,
    `printf '%s\\n' 'SCOPE_TMUX_SESSION_TERMINATED'`,
  ].join("; ");
}
