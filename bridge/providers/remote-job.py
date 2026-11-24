"""Small Linux SSH spool. No agent is invoked by status requests.

A UUID directory is claimed before launching. Repeating launch returns the same
receipt; an incomplete claim is unknown and never launches a duplicate process.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

WORKER = r'''
import json, os, subprocess, sys, time
from pathlib import Path
root = Path(sys.argv[1])
def save(value):
    temporary = root / "status.tmp"
    temporary.write_text(json.dumps(value), encoding="utf-8")
    temporary.replace(root / "status.json")
try:
    request = json.loads((root / "request.json").read_text(encoding="utf-8"))
    save({"status": "running", "pid": os.getpid(), "startedAt": time.time()})
    with (root / "stdout").open("wb") as out, (root / "stderr").open("wb") as err:
        child = subprocess.Popen(["bash", "-ic", request["command"]], stdin=subprocess.PIPE, stdout=out, stderr=err)
        # No remote timeout kill: a disconnected observer must not terminate work.
        child.communicate(request["input"].encode("utf-8"))
    save({"status": "completed" if child.returncode == 0 else "failed", "code": child.returncode, "endedAt": time.time()})
except Exception as error:
    save({"status": "unknown", "error": str(error)})
'''

request = json.loads(base64.urlsafe_b64decode(sys.argv[1] + "==="))
task_id = request.get("id", "")
if not re.fullmatch(r"[a-f0-9-]{36}", task_id):
    raise ValueError("invalid task id")
base = Path.home() / ".local" / "state" / "scope"
active = base / "runs" / task_id
archived = base / "archives" / task_id
root = archived if archived.exists() else active
if active.exists() and archived.exists():
    raise ValueError("conflicting archive receipts; inspect remote state")
if request["operation"] in ("archive", "restore"):
    status = root / "status.json"
    record = json.loads(status.read_text()) if status.exists() else {}
    if record.get("status") not in ("completed", "failed"):
        raise ValueError("remote task is not confirmed finished; not archived")
    target = archived if request["operation"] == "archive" else active
    if root != target:
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        root.rename(target)
        root = target


if request["operation"] == "launch":
    payload = {"command": request["command"], "input": request["input"]}
    if "interactiveConfig" in request: payload["interactiveConfig"] = request["interactiveConfig"]
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    root.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        root.mkdir(mode=0o700)
    except FileExistsError:
        existing = root / "fingerprint"
        if existing.exists() and existing.read_text() != fingerprint:
            raise ValueError("task id already belongs to a different request")
    else:
        (root / "fingerprint").write_text(fingerprint)
        (root / "request.json").write_text(json.dumps(payload), encoding="utf-8")
        if "interactiveConfig" in request:
            (root / "claude-config.json").write_text(json.dumps(request["interactiveConfig"]), encoding="utf-8")
        subprocess.Popen([sys.executable, "-c", WORKER, str(root)], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
elif request["operation"] == "control":
    import fcntl
    with (root / "control.lock").open("a") as mutex:
        fcntl.flock(mutex, fcntl.LOCK_EX)
        snapshot = json.loads((root / "interactive.json").read_text())
        if snapshot.get("status") not in ("running", "waiting_permission"):
            raise ValueError("会话已结束或正在停止，请刷新后重试")
        control = request["control"]
        if not re.fullmatch(r"[a-f0-9-]{36}", control["id"]):
            raise ValueError("invalid control id")
        if control["action"] not in ("message", "permission", "stop"):
            raise ValueError("unsupported control")
        if control["action"] == "permission" and not any(p["id"] == control.get("requestId") for p in snapshot.get("permissions", [])):
            raise ValueError("权限请求已失效或已处理")
        target = root / "controls" / (control["id"] + ".json")
        if target.exists():
            prior = json.loads(target.read_text())
            prior.pop("_sequence", None)
            if prior != control: raise ValueError("conflicting control id")
        else:
            # Filesystem timestamp resolution is insufficient for ordered inputs.
            counter = root / "control-sequence"
            sequence = int(counter.read_text()) + 1 if counter.exists() else 1
            counter.write_text(str(sequence))
            target.write_text(json.dumps({**control, "_sequence": sequence}))
elif request["operation"] not in ("status", "archive", "restore"):
    raise ValueError("unsupported operation")

status_file = root / "status.json"
result = json.loads(status_file.read_text()) if status_file.exists() else {"status": "unknown", "error": "等待启动回执；不会重复启动"}
if result.get("status") == "running":
    try:
        os.kill(result["pid"], 0)
    except ProcessLookupError:
        result = {"status": "unknown", "error": "远端监督进程已退出，执行结果待核实"}

for name in ("stdout", "stderr"):
    filename = root / name
    if filename.exists():
        with filename.open("rb") as handle:
            size = filename.stat().st_size
            if size > 512_000:
                handle.seek(size - 512_000)
                result["truncated"] = True
            result[name] = handle.read(512_000).decode("utf-8", errors="replace")
result["remotePath"] = str(root)
snapshot_file = root / "interactive.json"
if snapshot_file.exists():
    snapshot = json.loads(snapshot_file.read_text(encoding="utf-8"))
    if result.get("status") == "unknown" and snapshot.get("status") in ("running", "waiting_permission", "stopping", "finishing"):
        snapshot.update(status="unknown", error=result.get("error"))
    result["interactive"] = snapshot
print(json.dumps(result, ensure_ascii=False))
