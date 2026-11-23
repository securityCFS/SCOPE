/** Remote probe, kept independent of HTTP and local mutable state. */
export const APP_SERVER_HANDOFF_PROBE = String.raw`
import glob
import json
import os
import re
import sys

pid = int(sys.argv[1])
expected_rollout = os.path.realpath(sys.argv[2])
expected_cwd = os.path.realpath(sys.argv[3])

def fail(message, code=1):
    print(message, file=sys.stderr)
    raise SystemExit(code)

def process_alive(target_pid):
    stat_path = f"/proc/{target_pid}/stat"
    try:
        with open(stat_path, "r", encoding="utf-8", errors="replace") as handle:
            fields = handle.read().split()
        return len(fields) > 2 and fields[2] != "Z"
    except Exception:
        return False

def rollout_owners():
    owners = []
    for fd_path in glob.glob("/proc/[0-9]*/fd/*"):
        try:
            target = os.path.realpath(os.readlink(fd_path))
        except Exception:
            continue
        if target == expected_rollout:
            try:
                owners.append(int(fd_path.split("/")[2]))
            except Exception:
                pass
    return sorted(set(owners))

def process_args(target_pid):
    try:
        with open(f"/proc/{target_pid}/cmdline", "rb") as handle:
            return [
                value.decode("utf-8", errors="replace")
                for value in handle.read().split(b"\x00")
                if value
            ]
    except Exception:
        return []

def scope_app_server_owner(target_pid):
    args = process_args(target_pid)
    try:
        app_server_index = args.index("app-server")
        listen_index = args.index("--listen", app_server_index + 1)
        endpoint = args[listen_index + 1]
    except (ValueError, IndexError):
        return False
    control_dir = os.path.realpath(
        os.path.expanduser("~/.codex/app-server-control")
    )
    expected_prefix = "unix://" + control_dir + "/scope-"
    isolated_prefix = "unix://" + os.path.realpath(os.path.expanduser("~/.codex/scope-auth-profiles")) + "/"
    isolated_suffix = endpoint[len(isolated_prefix):] if endpoint.startswith(isolated_prefix) else ""
    return (endpoint.startswith(expected_prefix) and endpoint.endswith(".sock")) or bool(
        re.fullmatch(r"([A-Za-z0-9][A-Za-z0-9._-]{0,47})/home/app-server-control/scope-account-\1\.sock", isolated_suffix)
    )

if not os.path.isdir(expected_cwd):
    fail(f"工作目录不存在：{expected_cwd}", 18)

owners = rollout_owners()
if pid > 0:
    fail("安全策略禁止终止活动 CLI/VS Code Session", 23)
foreign_owners = [owner for owner in owners if not scope_app_server_owner(owner)]
if foreign_owners:
    fail(
        "该 Session 已由 PID " + ",".join(map(str, foreign_owners)) + " 打开；请刷新页面",
        17,
    )

print(json.dumps({
    "ok": True,
    "killedPid": None,
    "forced": False,
    "cwd": expected_cwd,
    "reconnectedOwnerPids": owners,
}, ensure_ascii=False, separators=(",", ":")))
`;
