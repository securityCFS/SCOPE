/** Remote probe, kept independent of HTTP and local mutable state. */
export const PROFILE_WRITE_PROBE = String.raw`
import base64
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone

action, slug, encoded = sys.argv[1:4]
payload = json.loads(base64.b64decode(encoded).decode("utf-8"))
root = os.path.realpath(os.path.expanduser("~/.codex/scope-auth-profiles"))
profile_dir = os.path.realpath(os.path.join(root, slug))
if os.path.commonpath([root, profile_dir]) != root or profile_dir == root:
    raise RuntimeError("拒绝访问 Profile 根目录之外的路径")
home_dir = os.path.join(profile_dir, "home")
auth_path = os.path.join(home_dir, "auth.json")
default_home = os.path.expanduser("~/.codex")
default_auth = os.path.join(default_home, "auth.json")
os.makedirs(home_dir, mode=0o700, exist_ok=True)
os.chmod(profile_dir, 0o700)
os.chmod(home_dir, 0o700)

def atomic_copy(source, target):
    if not os.path.isfile(source):
        raise RuntimeError("找不到远端 auth.json；请先在该主机登录 Codex")
    os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".scope-auth-", dir=os.path.dirname(target))
    os.close(fd)
    try:
        shutil.copyfile(source, temporary)
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass

if action == "save-current":
    atomic_copy(default_auth, auth_path)
    os.makedirs(root, mode=0o700, exist_ok=True)
    fd, marker_tmp = tempfile.mkstemp(prefix=".active-", dir=root)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(slug + "\n")
    os.replace(marker_tmp, os.path.join(root, "active"))
elif action == "select-default":
    # Web default selection must not replace credentials used by live writers.
    if not os.path.isfile(auth_path):
        raise RuntimeError("该 Profile 尚未完成登录")
    fd, marker_tmp = tempfile.mkstemp(prefix=".active-", dir=root)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(slug + "\n")
    os.replace(marker_tmp, os.path.join(root, "active"))
elif action == "activate":
    if not os.path.isfile(auth_path):
        raise RuntimeError("该 Profile 尚未完成登录")
    marker_path = os.path.join(root, "active")
    try:
        with open(marker_path, "r", encoding="utf-8") as handle:
            previous_slug = handle.read().strip()
    except Exception:
        previous_slug = ""
    if previous_slug and previous_slug != slug and os.path.isfile(default_auth):
        previous_profile = os.path.realpath(os.path.join(root, previous_slug))
        previous_home = os.path.join(previous_profile, "home")
        if (
            os.path.commonpath([root, previous_profile]) == root
            and previous_profile != root
            and os.path.isdir(previous_home)
            # An isolated writer owns its refreshed credentials. Never replace
            # them with a potentially older canonical-home token snapshot.
            and not os.path.exists(os.path.join(previous_home, "app-server-control", "scope-account-" + previous_slug + ".sock"))
        ):
            atomic_copy(default_auth, os.path.join(previous_home, "auth.json"))
    atomic_copy(auth_path, default_auth)
    os.makedirs(root, mode=0o700, exist_ok=True)
    fd, marker_tmp = tempfile.mkstemp(prefix=".active-", dir=root)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(slug + "\n")
    os.replace(marker_tmp, marker_path)
elif action == "finalize":
    if not os.path.isfile(auth_path):
        raise RuntimeError("Device auth 已返回成功，但远端未生成 auth.json")
    os.chmod(auth_path, 0o600)
else:
    raise RuntimeError("未知 Profile 操作")

metadata_path = os.path.join(profile_dir, "metadata.json")
existing = {}
try:
    with open(metadata_path, "r", encoding="utf-8") as handle:
        existing = json.load(handle)
except Exception:
    pass
now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
metadata = {
    "name": str(payload.get("name") or slug)[:80],
    "createdAt": existing.get("createdAt") or now,
    "updatedAt": now,
    "account": payload.get("account") if isinstance(payload.get("account"), dict) else existing.get("account"),
}
fd, metadata_tmp = tempfile.mkstemp(prefix=".metadata-", dir=profile_dir)
with os.fdopen(fd, "w", encoding="utf-8") as handle:
    json.dump(metadata, handle, ensure_ascii=False, separators=(",", ":"))
    handle.write("\n")
os.chmod(metadata_tmp, 0o600)
os.replace(metadata_tmp, metadata_path)
print(json.dumps({"ok": True, "slug": slug, "action": action}, separators=(",", ":")))
`;
