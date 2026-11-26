"""Reversible SCOPE visibility state; never move/delete native agent history."""
import base64
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

config = json.loads(base64.urlsafe_b64decode(sys.argv[1] + "==="))
provider = config.get("provider", "claude")
if provider not in ("claude", "antigravity"):
    raise ValueError("Unsupported provider")
label = "Claude" if provider == "claude" else "Antigravity"
sid = config.get("sessionId", "")
if not re.fullmatch(r"[a-fA-F0-9-]{36}", sid):
    raise ValueError("Invalid native session ID")
root = Path.home() / ".local/state/scope" / (provider + "-sessions")
root.mkdir(parents=True, exist_ok=True, mode=0o700)
lock = (root / (sid + ".lock")).open("a")
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise RuntimeError("此 Agent 会话正在被 SCOPE 使用，请等待本轮结束")
filename = root / (sid + ".json")
state = json.loads(filename.read_text()) if filename.exists() else {"sessionId": sid, "phase": "active"}

def active_writer():
    if provider == "antigravity":
        # Probe native presence locks; stale files alone do not mean active.
        agy_profile = str(config.get("agyProfile") or "").strip()
        if agy_profile and re.fullmatch(r"[a-zA-Z0-9._-]{1,64}", agy_profile) and agy_profile not in (".", ".."):
            agy_base = Path.home() / ".agy-profiles" / agy_profile / ".gemini/antigravity-cli"
        else:
            agy_base = Path.home() / ".gemini/antigravity-cli"
        native_lock = agy_base / "presence" / (sid + ".lock")
        if native_lock.exists():
            with native_lock.open("r") as presence:
                try:
                    fcntl.flock(presence, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return "native presence lock"
                finally:
                    fcntl.flock(presence, fcntl.LOCK_UN)
        for entry in Path("/proc").glob("[0-9]*/cmdline"):
            try:
                args = entry.read_bytes().decode(errors="replace").split("\0")
                if sid in args and any(Path(a).name == "agy" or "antigravity" in a for a in args[:2]):
                    return entry.parent.name
            except (FileNotFoundError, ProcessLookupError):
                continue
        return None
    registry = Path(os.environ.get("CLAUDE_CONFIG_DIR", str(Path.home() / ".claude"))) / "sessions"
    for entry in registry.glob("*.json"):
        try:
            record = json.loads(entry.read_text())
            if record.get("sessionId") != sid:
                continue
            pid = int(record["pid"])
            if pid <= 0:
                continue
            os.kill(pid, 0)
            # Reject conservatively on a live registered PID; never signal it.
            return pid
        except (FileNotFoundError, ProcessLookupError, ValueError, KeyError):
            continue
    # Older CLIs can lack registry files. Check explicit --resume/--session-id arguments.
    for entry in Path("/proc").glob("[0-9]*/cmdline"):
        try:
            args = entry.read_bytes().decode(errors="replace").split("\0")
            if sid in args and any("claude" in a for a in args[:2]):
                return int(entry.parent.name)
        except (FileNotFoundError, ProcessLookupError):
            continue
    return None

action = config["action"]
if action != "status":
    writer = active_writer()
    if writer:
        raise RuntimeError("%s 会话仍被远端终端或其他客户端使用（%s），请先正常退出该会话" % (label, writer))
if action == "run":
    if state["phase"] != "active":
        raise RuntimeError("会话已归档或在回收站，请先恢复")
    # This lock is held throughout the child turn, serializing SCOPE clients on the same host.
    sys.exit(subprocess.call(["bash", "-ic", config["command"]], stdin=subprocess.DEVNULL))
elif action in ("archive", "delete", "restore"):
    if action == "delete" and state["phase"] not in ("archived", "deleted"):
        raise RuntimeError("请先归档，再移入回收站")
    state.update(phase={"archive": "archived", "delete": "deleted", "restore": "active"}[action],
                 updatedAt=int(time.time() * 1000))
    temporary = filename.with_suffix(".tmp")
    temporary.write_text(json.dumps(state))
    temporary.replace(filename)
elif action not in ("status", "check"):
    raise ValueError("Unsupported action")
elif action == "check" and state["phase"] != "active":
    raise RuntimeError("会话已归档或在回收站，请先恢复")
print(json.dumps(state))
