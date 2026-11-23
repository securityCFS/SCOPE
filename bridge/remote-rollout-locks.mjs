import { shellQuote } from "./transport/ssh-command.mjs";
import { profileFromConnection } from "./session-profiles.mjs";
import { LOCAL_HOST } from "../lib/execution-host.js";

// A profile runtime must not resume a rollout from a different lock namespace.
// Resolve symlinks so the legacy shared-history homes remain compatible.
export const ROLLOUT_LOCK_NAMESPACE_PROBE = String.raw`
import os
import sys
from pathlib import Path

rollout = Path(sys.argv[1]).resolve()
shared_locks = Path(os.path.expanduser("~/.codex/thread-writer-locks")).resolve()
for parent in rollout.parents:
    if parent.name in ("sessions", "archived_sessions"):
        locks = (parent.parent / "thread-writer-locks").resolve()
        if locks == shared_locks:
            raise SystemExit(0)
        break
print("该历史会话使用独立 CLI 锁目录，暂不能跨账号恢复；请保留原 CLI，会话未被修改", file=sys.stderr)
raise SystemExit(77)
`;

export function remoteResumeValidator(runSshCommand) {
  return async ({ host, path, connectionKey }) => {
    if (host === LOCAL_HOST || !path || !profileFromConnection(connectionKey)) return;
    const result = await runSshCommand(host, `python3 - ${shellQuote(path)}`,
      ROLLOUT_LOCK_NAMESPACE_PROBE, 15_000, 10_000);
    if (result.code !== 0) throw new Error(result.stderr?.trim() || "无法确认会话 writer 锁目录，暂不恢复");
  };
}
