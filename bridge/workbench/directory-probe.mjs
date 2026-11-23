export const REMOTE_DIRECTORY_PROBE = String.raw`
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

directories = []
truncated = False
try:
    names = sorted(os.listdir(resolved), key=lambda value: value.lower())
    for name in names:
        candidate = os.path.join(resolved, name)
        try:
            if os.path.isdir(candidate):
                directories.append({"name": name, "path": candidate})
        except OSError:
            continue
        if len(directories) >= 300:
            truncated = True
            break
except OSError as error:
    print("无法读取工作目录：" + str(error), file=sys.stderr)
    raise SystemExit(4)

parent = os.path.dirname(resolved)
print(json.dumps({
    "ok": True,
    "cwd": resolved,
    "parent": parent if parent != resolved else None,
    "directories": directories,
    "truncated": truncated,
}, ensure_ascii=False, separators=(",", ":")))
`;
