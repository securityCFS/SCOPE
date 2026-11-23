/** Remote probe, kept independent of HTTP and local mutable state. */
export const VSCODE_OPEN_PREFLIGHT = String.raw`
import json
import os
import sys

cwd = sys.argv[1]
filename = sys.argv[2] if len(sys.argv) > 2 else ""
if not cwd.startswith("/") or any(value in cwd for value in ("\n", "\r", "\x00")):
    print("工作目录必须是远端绝对路径", file=sys.stderr)
    raise SystemExit(2)
if not os.path.isdir(cwd):
    print("工作目录不存在：" + cwd, file=sys.stderr)
    raise SystemExit(3)
if filename:
    if not filename.startswith("/") or any(value in filename for value in ("\n", "\r", "\x00")):
        print("文件必须是远端绝对路径", file=sys.stderr)
        raise SystemExit(4)
    if not os.path.isfile(filename):
        print("文件不存在：" + filename, file=sys.stderr)
        raise SystemExit(5)
print(json.dumps({"ok": True, "cwd": cwd, "file": filename or None}, ensure_ascii=False))
`;
