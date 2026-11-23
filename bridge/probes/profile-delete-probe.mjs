/** Remote probe, kept independent of HTTP and local mutable state. */
export const PROFILE_DELETE_PROBE = String.raw`
import json
import os
import shutil
import sys

slug, confirmation = sys.argv[1:3]
if confirmation != slug:
    raise RuntimeError("删除确认与 Profile 不匹配")
root = os.path.realpath(os.path.expanduser("~/.codex/scope-auth-profiles"))
target = os.path.realpath(os.path.join(root, slug))
if os.path.commonpath([root, target]) != root or target == root:
    raise RuntimeError("拒绝删除 Profile 根目录之外的路径")
marker_path = os.path.join(root, "active")
try:
    with open(marker_path, "r", encoding="utf-8") as handle:
        active_slug = handle.read().strip()
except Exception:
    active_slug = ""
if active_slug == slug:
    raise RuntimeError("当前正在使用的 Profile 不能删除；请先切换账号")
removed = False
if os.path.isdir(target):
    shutil.rmtree(target)
    removed = True
print(json.dumps({"ok": True, "slug": slug, "removed": removed}, separators=(",", ":")))
`;
