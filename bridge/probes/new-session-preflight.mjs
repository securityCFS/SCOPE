/** Remote probe, kept independent of HTTP and local mutable state. */
export const NEW_SESSION_PREFLIGHT = String.raw`
import json
import os
import sys

requested = sys.argv[1]
if not requested.startswith("/") or "\n" in requested or "\r" in requested:
    print("工作目录必须是远端绝对路径", file=sys.stderr)
    raise SystemExit(2)
resolved = os.path.realpath(requested)
if not os.path.isdir(resolved):
    print("工作目录不存在：" + resolved, file=sys.stderr)
    raise SystemExit(3)
print(json.dumps({"ok": True, "cwd": resolved}, ensure_ascii=False))
`;
