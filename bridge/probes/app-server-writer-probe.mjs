/** Remote probe, kept independent of HTTP and local mutable state. */
export const APP_SERVER_WRITER_PROBE = String.raw`
import glob
import json
import os
import re
import sys

session_id = sys.argv[1]
if not re.fullmatch(r"[A-Za-z0-9._-]{8,200}", session_id):
    print(json.dumps({"connectionKey": None, "error": "invalid session id"}))
    raise SystemExit(2)

expected_lock = os.path.realpath(
    os.path.expanduser(f"~/.codex/thread-writer-locks/{session_id}.lock")
)
control_dir = os.path.realpath(os.path.expanduser("~/.codex/app-server-control"))

def process_args(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as handle:
            return [
                value.decode("utf-8", errors="replace")
                for value in handle.read().split(b"\x00")
                if value
            ]
    except Exception:
        return []

owners = []
for fd_path in (fd for proc in glob.glob("/proc/[0-9]*")
                if "app-server" in process_args(proc.rsplit("/", 1)[-1])
                for fd in glob.glob(proc + "/fd/*")):
    try:
        target = os.path.realpath(os.readlink(fd_path))
    except Exception:
        continue
    if target != expected_lock:
        continue
    try:
        owners.append(int(fd_path.split("/")[2]))
    except Exception:
        pass

for pid in sorted(set(owners)):
    args = process_args(pid)
    try:
        app_server_index = args.index("app-server")
        listen_index = args.index("--listen", app_server_index + 1)
        endpoint = args[listen_index + 1]
    except (ValueError, IndexError):
        continue
    prefix = "unix://" + control_dir + "/scope-"
    if endpoint.startswith(prefix) and endpoint.endswith(".sock"):
        connection_key = endpoint[len(prefix):-len(".sock")]
    else:
        isolated_prefix = "unix://" + os.path.realpath(os.path.expanduser("~/.codex/scope-auth-profiles")) + "/"
        suffix = endpoint[len(isolated_prefix):] if endpoint.startswith(isolated_prefix) else ""
        match = re.fullmatch(r"([A-Za-z0-9][A-Za-z0-9._-]{0,47})/(?:home|scope-home)/app-server-control/scope-account-\1\.sock", suffix)
        if not match:
            continue
        connection_key = "account-" + match.group(1)
    if re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", connection_key):
        print(json.dumps({
            "connectionKey": connection_key,
            "ownerPid": pid,
            "endpoint": endpoint,
        }, ensure_ascii=False, separators=(",", ":")))
        raise SystemExit(0)

print(json.dumps({"connectionKey": None, "owners": sorted(set(owners))}))
`;
