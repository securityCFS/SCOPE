/** Remote probe, kept independent of HTTP and local mutable state. */
export const PROFILE_CANCEL_PROBE = String.raw`
import json
import os
import shutil
import sys

slug = sys.argv[1]
root = os.path.realpath(os.path.expanduser("~/.codex/scope-auth-profiles"))
target = os.path.realpath(os.path.join(root, slug))
if os.path.commonpath([root, target]) != root or target == root:
    raise RuntimeError("拒绝清理 Profile 根目录之外的路径")
auth_path = os.path.join(target, "home", "auth.json")
removed = False
if os.path.isdir(target) and not os.path.isfile(auth_path):
    shutil.rmtree(target)
    removed = True
print(json.dumps({"ok": True, "removed": removed}, separators=(",", ":")))
`;
