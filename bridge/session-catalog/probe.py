"""Read metadata for native CLI histories. No agent process is started."""
import base64
import glob
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
from urllib.parse import unquote, urlparse

try:
    import fcntl
except ImportError:
    fcntl = None

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

config = json.loads(base64.urlsafe_b64decode(sys.argv[1] + "=="))
roots = {
    "codex": os.path.join(os.environ.get("CODEX_HOME", os.path.expanduser("~/.codex")), "sessions"),
    "claude": os.path.join(os.environ.get("CLAUDE_CONFIG_DIR", os.path.expanduser("~/.claude")), "projects"),
    "antigravity": os.path.expanduser("~/.gemini/antigravity-cli"),
}

def text(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") in ("text", "input_text", "output_text"))

def records(filename, full=False, max_bytes=2_000_000):
    with open(filename, "rb") as handle:
        size = os.fstat(handle.fileno()).st_size
        if full:
            # Stream line-by-line over a bounded tail; skip oversized debug/request blobs before json.loads.
            if size > max_bytes:
                handle.seek(size - max_bytes)
                handle.readline()
            for line in handle:
                if not line.strip():
                    continue
                head = line[:160]
                if b'"type":"api-request' in head or b'"type": "api-request' in head or b'"type":"data-flow-records' in head or b'"type": "data-flow-records' in head:
                    continue
                try:
                    value = json.loads(line)
                    if isinstance(value, dict):
                        yield value
                except (ValueError, UnicodeError):
                    pass
            return
        data = handle.read(24_000)
        if size > 24_000:
            data = data.rsplit(b"\n", 1)[0] + b"\n"
            handle.seek(max(24_000, size - 24_000))
            handle.readline()
            data += handle.read(24_000)
    for line in data.splitlines():
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                yield value
        except (ValueError, UnicodeError):
            pass

def metadata(provider, filename):
    item = {"provider": provider, "sessionId": Path(filename).stem, "path": filename,
            "cwd": "", "title": "", "model": "", "updatedAt": int(os.path.getmtime(filename) * 1000)}
    for row in records(filename):
        if provider == "codex":
            payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
            if row.get("type") == "session_meta":
                item.update(sessionId=payload.get("id") or item["sessionId"], cwd=payload.get("cwd") or item["cwd"])
            if row.get("type") == "turn_context":
                item["model"] = payload.get("model") or item["model"]
            if row.get("type") == "response_item" and payload.get("role") == "user":
                value = text(payload.get("content"))
                if value and not value.lstrip().startswith(("<", "# AGENTS", "# Instructions")):
                    item["title"] = item["title"] or value[:160]
        else:
            item["cwd"] = row.get("cwd") or item["cwd"]
            item["sessionId"] = row.get("sessionId") or item["sessionId"]
            message = row.get("message") if isinstance(row.get("message"), dict) else {}
            item["model"] = message.get("model") or item["model"]
            if row.get("type") == "user" and not row.get("isMeta"):
                value = text(message.get("content"))
                if value and not value.lstrip().startswith("<"):
                    item["title"] = item["title"] or value[:160]
            if row.get("type") == "summary":
                item["title"] = (row.get("summary") or item["title"])[:160]
    item["title"] = item["title"] or f"{provider} · {item['sessionId'][:8]}"
    return item

CREATED_SUBAGENT_RE = re.compile(r'Created the following subagent:\s*\{\s*"conversationId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})"')
SENDER_RE = re.compile(r'sender=([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})')
CLAUDE_AGENT_ID_RE = re.compile(r'^agent-[a-zA-Z0-9_-]{1,64}$')
CLAUDE_LOOKUP_ID_RE = re.compile(r'^[a-zA-Z0-9_-]{4,96}$')

def read_claude_subagent_meta(jsonl_path):
    meta_path = jsonl_path.with_suffix(".meta.json")
    try:
        if not meta_path.is_file():
            return {}, 0
        st = meta_path.stat()
        with meta_path.open("rb") as h:
            raw = h.read(16_384)
        data = json.loads(raw.decode("utf-8", errors="replace"))
        return (data if isinstance(data, dict) else {}), st.st_mtime_ns
    except (OSError, ValueError):
        return {}, 0

def summarize_tool_input(name, raw_input):
    if isinstance(raw_input, dict):
        for key in ("description", "file_path", "path", "command", "cmd", "pattern", "query", "url", "glob", "notebook_path", "prompt"):
            val = raw_input.get(key)
            if isinstance(val, str) and val.strip():
                line = val.strip().splitlines()[0].strip()
                if key in ("file_path", "path", "notebook_path") and ("/" in line or "\\" in line):
                    short = line.replace("\\", "/").split("/")[-1] or line
                    return short[:90]
                return line[:90]
    if isinstance(raw_input, str) and raw_input.strip():
        return raw_input.strip().splitlines()[0][:90]
    return ""

def clip_text(value, limit):
    if len(value) <= limit:
        return value, False
    omitted = len(value) - limit
    return value[:limit] + f"\n\n… [已截断 {omitted} 个字符]", True

def extract_tool_result_text(content, limit=6000):
    if isinstance(content, str):
        return clip_text(content.replace("\x00", ""), limit)
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                ptype = part.get("type")
                if ptype in ("text", "input_text", "output_text") and isinstance(part.get("text"), str):
                    parts.append(part["text"])
                elif ptype == "image":
                    parts.append("[image]")
                elif isinstance(part.get("content"), str):
                    parts.append(part["content"])
        return clip_text("\n".join(parts).replace("\x00", ""), limit)
    if isinstance(content, dict):
        return clip_text(json.dumps(content, ensure_ascii=False).replace("\x00", ""), limit)
    return "", False

AGENT_MSG_RE = re.compile(r'<agent-message\s+from="([^"]+)"[^>]*>([\s\S]*?)</agent-message>')
TASK_NOTIF_RE = re.compile(r'<task-notification>([\s\S]*?)</task-notification>')

def _xml_tag(body, tag):
    m = re.search(rf'<{tag}>([\s\S]*?)</{tag}>', body)
    return m.group(1).strip() if m else ""

def parse_claude_agent_message(raw_text):
    if not isinstance(raw_text, str) or "<agent-message" not in raw_text:
        return None
    m = AGENT_MSG_RE.search(raw_text)
    if not m:
        return None
    sender = m.group(1).strip()[:120]
    body = m.group(2).strip()
    is_handback = "[Subagent hand-back]" in body[:200]
    if is_handback:
        marker = "The report follows:"
        idx = body.find(marker)
        if idx >= 0:
            body = body[idx + len(marker):].lstrip("\r\n")
            body = "\n".join(line[2:] if line.startswith("  ") else line for line in body.splitlines()).strip()
    first_line = next((ln.strip().lstrip("#*- ").strip() for ln in body.splitlines() if ln.strip()), "")[:110]
    return {
        "from": sender,
        "kind": "handback" if is_handback else "message",
        "summary": first_line,
        "text": body[:16_000],
    }

def parse_claude_task_notification(raw_text):
    if not isinstance(raw_text, str) or "<task-notification>" not in raw_text:
        return None
    m = TASK_NOTIF_RE.search(raw_text)
    if not m:
        return None
    inner = m.group(1)
    task_id = _xml_tag(inner, "task-id")
    tool_use_id = _xml_tag(inner, "tool-use-id")
    status = _xml_tag(inner, "status") or "completed"
    summary = _xml_tag(inner, "summary")
    result = _xml_tag(inner, "result")
    return {
        "taskId": task_id,
        "toolUseId": tool_use_id,
        "status": status,
        "summary": summary[:160],
        "text": (result or summary)[:12_000],
    }

UUID_RE = re.compile(r"^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$")

def collect_tmux_ttys():
    if os.name == "nt":
        return set()
    try:
        proc = subprocess.run(
            ["tmux", "list-panes", "-a", "-F", "#{pane_tty}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1.5,
        )
        if proc.returncode == 0 and proc.stdout:
            return {line.strip() for line in proc.stdout.splitlines() if line.strip()}
    except (OSError, subprocess.SubprocessError):
        pass
    return set()

def scope_lock_active(provider, sid):
    if fcntl is None or not sid:
        return False
    lock_file = Path.home() / ".local/state/scope" / f"{provider}-sessions" / f"{sid}.lock"
    if not lock_file.is_file():
        return False
    try:
        with lock_file.open("r") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return True
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)
                return False
    except OSError:
        return False

def _read_proc_cmdline(pid):
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
        return [part for part in raw.decode("utf-8", errors="replace").split("\0") if part]
    except OSError:
        return []

def _read_proc_ppid(pid):
    try:
        stat_txt = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8", errors="replace")
        rparen = stat_txt.rfind(")")
        if rparen < 0:
            return 0
        fields = stat_txt[rparen + 2:].split()
        return int(fields[1]) if len(fields) > 1 else 0
    except (OSError, ValueError):
        return 0

def pid_tty_and_scope(pid, tmux_ttys):
    if os.name == "nt" or not pid or pid <= 0:
        return "", False, False
    args = _read_proc_cmdline(pid)
    is_scope = False
    if "--input-format" in args and "stream-json" in args:
        is_scope = True
    elif len(args) >= 2 and Path(args[0]).name == "agy" and args[1] == "acp":
        is_scope = True
    if not is_scope:
        cur = pid
        for _ in range(5):
            ppid = _read_proc_ppid(cur)
            if ppid <= 1 or ppid == cur:
                break
            pargs = " ".join(_read_proc_cmdline(ppid))
            if (
                ".local/state/scope/runs" in pargs
                or "claude-interactive" in pargs
                or "antigravity-interactive" in pargs
                or "native-session-state" in pargs
            ):
                is_scope = True
                break
            cur = ppid
    full_tty = ""
    short_tty = ""
    try:
        link = os.readlink(f"/proc/{pid}/fd/0")
        if link.startswith("/dev/pts/") or link.startswith("/dev/tty"):
            full_tty = link
            short_tty = link[len("/dev/"):]
    except OSError:
        pass
    return short_tty, bool(full_tty and full_tty in tmux_ttys), is_scope

def _format_lock_reason(tty, pid, in_tmux):
    where = f"tmux ({tty})" if (in_tmux and tty) else (tty or "远端终端")
    return f"外部终端占用 ({where} · PID {pid})" if pid else f"外部终端占用 ({where})"

def detect_claude_external_locks(tmux_ttys, target_sid=None):
    if os.name == "nt":
        return {}
    locks = {}
    registry = Path(roots["claude"]).parent / "sessions"
    if registry.is_dir():
        for entry in registry.glob("*.json"):
            try:
                record = json.loads(entry.read_text(encoding="utf-8", errors="replace"))
            except (OSError, ValueError):
                continue
            if not isinstance(record, dict):
                continue
            sid = str(record.get("sessionId") or "")
            if not sid or (target_sid and sid != target_sid):
                continue
            try:
                pid = int(record.get("pid") or 0)
            except (TypeError, ValueError):
                continue
            if pid <= 0:
                continue
            try:
                os.kill(pid, 0)
            except OSError:
                continue
            if scope_lock_active("claude", sid):
                continue
            tty, in_tmux, is_scope = pid_tty_and_scope(pid, tmux_ttys)
            if is_scope:
                continue
            locks[sid] = {
                "locked": True,
                "pid": pid,
                "tty": tty,
                "inTmux": in_tmux,
                "entrypoint": str(record.get("entrypoint") or "cli")[:40],
                "status": str(record.get("status") or "active")[:40],
                "name": str(record.get("name") or "")[:80],
                "reason": _format_lock_reason(tty, pid, in_tmux),
            }
    proc_root = Path("/proc")
    if proc_root.is_dir():
        for cmd_file in proc_root.glob("[0-9]*/cmdline"):
            try:
                pid = int(cmd_file.parent.name)
                args = [p for p in cmd_file.read_bytes().decode("utf-8", errors="replace").split("\0") if p]
            except (OSError, ValueError):
                continue
            if not args or not any("claude" in Path(a).name for a in args[:2]):
                continue
            for idx, arg in enumerate(args):
                if arg in ("--resume", "--session-id", "-r") and idx + 1 < len(args):
                    sid = args[idx + 1]
                    if not UUID_RE.fullmatch(sid) or sid in locks or (target_sid and sid != target_sid):
                        continue
                    if scope_lock_active("claude", sid):
                        continue
                    tty, in_tmux, is_scope = pid_tty_and_scope(pid, tmux_ttys)
                    if is_scope:
                        continue
                    locks[sid] = {
                        "locked": True,
                        "pid": pid,
                        "tty": tty,
                        "inTmux": in_tmux,
                        "entrypoint": "cli",
                        "status": "active",
                        "reason": _format_lock_reason(tty, pid, in_tmux),
                    }
    return locks

def detect_agy_external_locks(tmux_ttys, target_sid=None):
    if os.name == "nt":
        return {}
    locks = {}
    locked_sids = set()
    presence_dir = Path(roots["antigravity"]) / "presence"
    if fcntl is not None and presence_dir.is_dir():
        candidates = [presence_dir / f"{target_sid}.lock"] if target_sid else list(presence_dir.glob("*.lock"))
        for lock_file in candidates:
            if not lock_file.is_file():
                continue
            sid = lock_file.stem
            try:
                with lock_file.open("r") as handle:
                    try:
                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        locked_sids.add(sid)
                    else:
                        fcntl.flock(handle, fcntl.LOCK_UN)
            except OSError:
                continue
    pid_by_sid = {}
    proc_root = Path("/proc")
    if proc_root.is_dir():
        for cmd_file in proc_root.glob("[0-9]*/cmdline"):
            try:
                pid = int(cmd_file.parent.name)
                args = [p for p in cmd_file.read_bytes().decode("utf-8", errors="replace").split("\0") if p]
            except (OSError, ValueError):
                continue
            if not args or not any(Path(a).name == "agy" or "antigravity" in Path(a).name for a in args[:2]):
                continue
            for idx, arg in enumerate(args):
                if arg in ("--conversation", "-c") and idx + 1 < len(args):
                    sid = args[idx + 1]
                    if (not target_sid or sid == target_sid) and sid not in pid_by_sid:
                        pid_by_sid[sid] = pid
                        locked_sids.add(sid)
            fd_dir = cmd_file.parent / "fd"
            try:
                for fd_link in fd_dir.iterdir():
                    try:
                        target = os.readlink(str(fd_link))
                    except OSError:
                        continue
                    if "/antigravity-cli/presence/" in target and target.endswith(".lock"):
                        sid = Path(target).stem
                        if not target_sid or sid == target_sid:
                            pid_by_sid[sid] = pid
                            locked_sids.add(sid)
            except OSError:
                continue
    for sid in locked_sids:
        if scope_lock_active("antigravity", sid):
            continue
        pid = pid_by_sid.get(sid, 0)
        tty, in_tmux, is_scope = pid_tty_and_scope(pid, tmux_ttys) if pid else ("", False, False)
        if is_scope:
            continue
        locks[sid] = {
            "locked": True,
            "pid": pid or None,
            "tty": tty,
            "inTmux": in_tmux,
            "entrypoint": "cli",
            "status": "active",
            "reason": _format_lock_reason(tty, pid, in_tmux),
        }
    return locks

def claude_subagents(filename, now_ts, limit=60):
    sub_dir = Path(filename).with_suffix("") / "subagents"
    if not sub_dir.is_dir():
        return [], 0
    files = []
    for child in sub_dir.glob("agent-*.jsonl"):
        try:
            st = child.stat()
            files.append((st.st_mtime, st.st_size, child))
        except OSError:
            continue
    total_count = len(files)
    files.sort(key=lambda item: item[0])
    result = []
    for mtime, size, child in files[-limit:]:
        meta, _ = read_claude_subagent_meta(child)
        role = str(meta.get("description") or "").strip()[:120]
        type_name = str(meta.get("agentType") or "subagent")[:60]
        tool_use_id = str(meta.get("toolUseId") or "")[:96]
        model = str(meta.get("pickedEffortModel") or meta.get("model") or "")[:80]
        spawn_depth = meta.get("spawnDepth") if isinstance(meta.get("spawnDepth"), int) else None
        finished = meta.get("finished") if isinstance(meta.get("finished"), bool) else None
        background = meta.get("requestShape") != "foreground"
        last_action = ""
        stop_reason = None
        need_tail = (not role) or (finished is not True) or (not model)
        if need_tail:
            try:
                with child.open("rb") as handle:
                    head = handle.read(min(8_192, size)) if not role else b""
                    if size <= 16_384:
                        handle.seek(0)
                        tail = handle.read(16_384)
                    else:
                        handle.seek(max(0, size - 16_384))
                        tail = handle.read(16_384)
                if size > 16_384 and b"\n" in tail:
                    tail = tail.split(b"\n", 1)[1]
                if not role and head:
                    for raw_line in head.splitlines():
                        try:
                            row = json.loads(raw_line)
                        except (ValueError, UnicodeError):
                            continue
                        if isinstance(row, dict) and row.get("type") == "user":
                            val = text((row.get("message") or {}).get("content")).strip()
                            if val:
                                role = val.splitlines()[0][:120]
                                break
                for raw_line in tail.splitlines():
                    if b'"type":"api-request' in raw_line or b'"type": "api-request' in raw_line:
                        continue
                    try:
                        row = json.loads(raw_line)
                    except (ValueError, UnicodeError):
                        continue
                    if not isinstance(row, dict):
                        continue
                    msg = row.get("message") if isinstance(row.get("message"), dict) else {}
                    if "stop_reason" in msg:
                        stop_reason = msg.get("stop_reason")
                    if not model and isinstance(msg.get("model"), str):
                        model = msg["model"][:80]
                    if isinstance(msg.get("content"), list):
                        for blk in msg["content"]:
                            if isinstance(blk, dict) and blk.get("type") == "tool_use" and blk.get("name"):
                                summary = summarize_tool_input(blk["name"], blk.get("input"))
                                last_action = f"{blk['name']} · {summary}"[:96] if summary else str(blk["name"])[:80]
            except OSError:
                continue
        if finished is True:
            working = False
        elif finished is False:
            working = (now_ts - mtime) < 300
        else:
            working = (now_ts - mtime < 180) and (stop_reason != "end_turn")
        entry = {
            "id": child.stem,
            "agentId": child.stem,
            "role": role or f"Subagent {child.stem[:10]}",
            "typeName": type_name,
            "background": background,
            "status": "working" if working else "completed",
            "lastAction": last_action or ("运行中" if working else "已完成"),
            "updatedAt": int(mtime * 1000),
            "sizeBytes": size,
            "hasWorkflow": True,
        }
        if tool_use_id:
            entry["toolUseId"] = tool_use_id
        if model:
            entry["model"] = model
        if spawn_depth is not None:
            entry["spawnDepth"] = spawn_depth
        result.append(entry)
    return result, total_count

def resolve_claude_subagent_file(sub_dir, subagent_id):
    if not isinstance(subagent_id, str) or not subagent_id:
        raise ValueError("缺少子代理标识")
    sub_root = os.path.realpath(str(sub_dir))
    candidate = None
    if CLAUDE_AGENT_ID_RE.fullmatch(subagent_id):
        candidate = sub_dir / f"{subagent_id}.jsonl"
    elif CLAUDE_LOOKUP_ID_RE.fullmatch(subagent_id):
        direct = sub_dir / f"agent-{subagent_id}.jsonl"
        if direct.is_file():
            candidate = direct
        else:
            for meta_file in sub_dir.glob("*.meta.json"):
                try:
                    data = json.loads(meta_file.read_bytes()[:16_384].decode("utf-8", errors="replace"))
                except (OSError, ValueError):
                    continue
                if isinstance(data, dict) and data.get("toolUseId") == subagent_id:
                    stem = meta_file.name[:-len(".meta.json")]
                    if CLAUDE_AGENT_ID_RE.fullmatch(stem):
                        candidate = sub_dir / f"{stem}.jsonl"
                        break
    else:
        raise ValueError("子代理标识无效")
    if candidate is None or not candidate.is_file():
        return None
    resolved = os.path.realpath(str(candidate))
    if os.path.commonpath([sub_root, resolved]) != sub_root:
        raise ValueError("子代理路径超出允许范围")
    return Path(resolved)

def claude_subagent_workflow(parent_filename, subagent_id, known_version=None):
    sub_dir = Path(parent_filename).with_suffix("") / "subagents"
    if not sub_dir.is_dir():
        return {"found": False, "steps": [], "status": "unknown"}
    target = resolve_claude_subagent_file(sub_dir, subagent_id)
    if target is None:
        return {"found": False, "steps": [], "status": "unknown"}
    st = target.stat()
    meta, meta_mtime_ns = read_claude_subagent_meta(target)
    version = f"{st.st_mtime_ns}:{st.st_size}:{meta_mtime_ns}"
    if known_version and known_version == version:
        return {"found": True, "notModified": True, "version": version}

    steps = []
    tools_by_id = {}
    prompt_captured = False
    stop_reason = None
    model = str(meta.get("pickedEffortModel") or meta.get("model") or "")[:80]
    role = str(meta.get("description") or "").strip()[:160]
    step_seq = 0

    with target.open("rb") as handle:
        for raw_line in handle:
            if not raw_line.strip():
                continue
            if (
                b'"type":"api-request' in raw_line
                or b'"type": "api-request' in raw_line
                or b'"type":"data-flow-records' in raw_line
                or b'"type": "data-flow-records' in raw_line
            ):
                continue
            try:
                row = json.loads(raw_line.decode("utf-8", errors="replace"))
            except ValueError:
                continue
            if not isinstance(row, dict):
                continue
            rtype = row.get("type")
            if rtype not in ("user", "assistant"):
                continue
            ts = row.get("timestamp")
            msg = row.get("message") if isinstance(row.get("message"), dict) else {}
            if not model and isinstance(msg.get("model"), str):
                model = msg["model"][:80]
            if "stop_reason" in msg:
                stop_reason = msg.get("stop_reason")
            content = msg.get("content")

            if rtype == "user":
                if isinstance(content, str):
                    val = content.strip()
                    if val and not row.get("isMeta"):
                        is_first = not prompt_captured
                        prompt_captured = True
                        if is_first and not role:
                            role = val.splitlines()[0][:160]
                        clipped, trunc = clip_text(val, 16_000)
                        step_seq += 1
                        steps.append({
                            "id": f"prompt-{step_seq}",
                            "kind": "prompt",
                            "title": "子代理任务" if is_first else "主会话追加指令",
                            "text": clipped,
                            "truncated": trunc,
                            "timestamp": ts,
                        })
                elif isinstance(content, list):
                    plain_parts = []
                    for blk in content:
                        if not isinstance(blk, dict):
                            continue
                        btype = blk.get("type")
                        if btype == "tool_result":
                            tid = str(blk.get("tool_use_id") or "")
                            out_text, out_trunc = extract_tool_result_text(blk.get("content"), 6000)
                            is_err = bool(blk.get("is_error"))
                            tool_step = tools_by_id.get(tid)
                            if tool_step is not None:
                                tool_step["output"] = out_text
                                tool_step["outputTruncated"] = out_trunc
                                tool_step["isError"] = is_err
                                tool_step["status"] = "failed" if is_err else "completed"
                            elif out_text:
                                step_seq += 1
                                steps.append({
                                    "id": f"tool-out-{step_seq}",
                                    "kind": "tool",
                                    "toolName": "tool_result",
                                    "title": "工具输出",
                                    "summary": "",
                                    "output": out_text,
                                    "outputTruncated": out_trunc,
                                    "isError": is_err,
                                    "status": "failed" if is_err else "completed",
                                    "timestamp": ts,
                                })
                        elif btype in ("text", "input_text") and isinstance(blk.get("text"), str):
                            plain_parts.append(blk["text"])
                    if plain_parts and not row.get("isMeta"):
                        val = "\n".join(plain_parts).strip()
                        if val:
                            is_first = not prompt_captured
                            prompt_captured = True
                            if is_first and not role:
                                role = val.splitlines()[0][:160]
                            clipped, trunc = clip_text(val, 16_000)
                            step_seq += 1
                            steps.append({
                                "id": f"prompt-{step_seq}",
                                "kind": "prompt",
                                "title": "子代理任务" if is_first else "主会话追加指令",
                                "text": clipped,
                                "truncated": trunc,
                                "timestamp": ts,
                            })
            elif rtype == "assistant" and isinstance(content, list):
                thinking_ms = row.get("thinkingDurationMs") if isinstance(row.get("thinkingDurationMs"), (int, float)) else None
                for blk in content:
                    if not isinstance(blk, dict):
                        continue
                    btype = blk.get("type")
                    if btype == "thinking":
                        tval = str(blk.get("thinking") or blk.get("text") or "").strip()
                        if tval:
                            clipped, trunc = clip_text(tval, 6000)
                            step_seq += 1
                            steps.append({
                                "id": f"think-{step_seq}",
                                "kind": "thinking",
                                "title": "思考过程",
                                "text": clipped,
                                "truncated": trunc,
                                "durationMs": int(thinking_ms) if thinking_ms is not None else None,
                                "timestamp": ts,
                            })
                    elif btype == "text":
                        tval = str(blk.get("text") or "").strip()
                        if tval:
                            clipped, trunc = clip_text(tval, 24_000)
                            step_seq += 1
                            steps.append({
                                "id": f"asst-{step_seq}",
                                "kind": "assistant",
                                "title": "回复",
                                "text": clipped,
                                "truncated": trunc,
                                "timestamp": ts,
                            })
                    elif btype == "tool_use":
                        tname = str(blk.get("name") or "Tool")[:80]
                        tid = str(blk.get("id") or f"tool-{step_seq + 1}")
                        raw_in = blk.get("input")
                        summary = summarize_tool_input(tname, raw_in)
                        try:
                            in_str = json.dumps(raw_in, ensure_ascii=False, indent=2) if raw_in is not None else ""
                        except (TypeError, ValueError):
                            in_str = str(raw_in)
                        in_clipped, in_trunc = clip_text(in_str, 4000)
                        step_seq += 1
                        tstep = {
                            "id": tid,
                            "kind": "tool",
                            "toolName": tname,
                            "title": tname,
                            "summary": summary,
                            "inputPreview": in_clipped,
                            "inputTruncated": in_trunc,
                            "output": "",
                            "outputTruncated": False,
                            "isError": False,
                            "status": "running",
                            "timestamp": ts,
                        }
                        steps.append(tstep)
                        tools_by_id[tid] = tstep

    finished = meta.get("finished") if isinstance(meta.get("finished"), bool) else None
    now_ts = time.time()
    if finished is True:
        working = False
    elif finished is False:
        working = (now_ts - st.st_mtime) < 300
    else:
        working = (now_ts - st.st_mtime < 180) and (stop_reason != "end_turn")

    if not working:
        for s in steps:
            if s.get("kind") == "tool" and s.get("status") == "running":
                s["status"] = "completed"

    total_steps = len(steps)
    truncated = False
    MAX_STEPS = 160
    if total_steps > MAX_STEPS:
        truncated = True
        if steps and steps[0].get("kind") == "prompt":
            steps = [steps[0]] + steps[-(MAX_STEPS - 1):]
        else:
            steps = steps[-MAX_STEPS:]

    return {
        "found": True,
        "provider": "claude",
        "subagentId": target.stem,
        "toolUseId": str(meta.get("toolUseId") or ""),
        "role": role or f"Subagent {target.stem[:10]}",
        "typeName": str(meta.get("agentType") or "subagent")[:60],
        "model": model,
        "spawnDepth": meta.get("spawnDepth") if isinstance(meta.get("spawnDepth"), int) else None,
        "background": meta.get("requestShape") != "foreground",
        "status": "working" if working else "completed",
        "updatedAt": int(st.st_mtime * 1000),
        "sizeBytes": st.st_size,
        "version": version,
        "totalSteps": total_steps,
        "truncated": truncated,
        "steps": steps,
    }

def agy_active_subagents(brain_root, transcript_file, now_ts):
    try:
        size = transcript_file.stat().st_size
        start = max(0, size - 131_072)
        with transcript_file.open("rb") as h:
            h.seek(start)
            data = h.read(131_072)
        if start > 0 and b"\n" in data:
            data = data.split(b"\n", 1)[1]
        cids, done = [], set()
        for line in data.splitlines():
            try:
                row = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if not isinstance(row, dict):
                continue
            if row.get("type") == "GENERIC" and isinstance(row.get("content"), str):
                for m in CREATED_SUBAGENT_RE.finditer(row["content"]):
                    cid = m.group(1)
                    if cid not in cids:
                        cids.append(cid)
            elif row.get("type") == "SYSTEM_MESSAGE" and isinstance(row.get("content"), str):
                m = SENDER_RE.search(row["content"])
                if m:
                    done.add(m.group(1))
        count = 0
        for cid in cids[-24:]:
            if cid in done:
                continue
            logs = brain_root / cid / ".system_generated/logs"
            cf = next((p for p in (logs / "transcript_full.jsonl", logs / "transcript.jsonl") if p.is_file()), None)
            if cf is not None and (now_ts - cf.stat().st_mtime) < 180:
                count += 1
        return count
    except OSError:
        return 0

def agy_entries():
    filename = os.path.join(roots["antigravity"], "conversation_summaries.db")
    if not os.path.exists(filename):
        return []
    connection = sqlite3.connect(Path(filename).resolve().as_uri() + "?mode=ro", uri=True, timeout=2)
    try:
        rows = connection.execute("SELECT conversation_id,title,preview,workspace_uris,last_modified_time FROM conversation_summaries").fetchall()
        result = []
        now_ts = time.time()
        brain_root = (Path(roots["antigravity"]) / "brain").resolve()
        for sid, title, preview, workspaces, updated in rows:
            try:
                workspaces = json.loads(workspaces or "[]")
            except ValueError:
                workspaces = [workspaces] if workspaces else []
            if isinstance(workspaces, str):
                workspaces = [workspaces]
            workspace = next((value for value in workspaces if isinstance(value, str)), "")
            cwd = unquote(urlparse(workspace).path) if workspace.startswith("file:") else workspace
            if os.name == "nt" and len(cwd) > 2 and cwd[0] == "/" and cwd[2] == ":":
                cwd = cwd[1:]
            item = {"provider": "antigravity", "sessionId": sid, "cwd": cwd, "title": (title or preview or sid)[:160], "preview": (preview or "")[:1000], "model": "", "updatedAt": str(updated or ""), "path": filename}
            # Metadata only: scans never transfer conversation bodies.
            if isinstance(sid, str) and sid and all(c.isalnum() or c in "-_" for c in sid):
                folder = Path(roots["antigravity"]) / "brain" / sid / ".system_generated/logs"
                for name in ("transcript_full.jsonl", "transcript.jsonl"):
                    try:
                        tf = folder / name
                        stat = tf.stat()
                        item["historyVersion"] = f"{name}:{stat.st_mtime_ns}:{stat.st_size}"
                        if now_ts - stat.st_mtime < 600:
                            active = agy_active_subagents(brain_root, tf, now_ts)
                            if active > 0:
                                item["activeSubagents"] = active
                        break
                    except OSError:
                        continue
            result.append(item)
        return result
    finally:
        connection.close()

def codex_labels():
    root = Path(roots["codex"]).parent
    labels = {}
    database = root / "state_5.sqlite"
    if database.exists():
        connection = None
        try:
            connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True, timeout=2)
            columns = {row[1] for row in connection.execute("PRAGMA table_info(threads)")}
            selected = [name for name in ("id", "title", "name", "model", "cwd") if name in columns]
            if "id" in selected:
                for row in connection.execute("SELECT " + ",".join(selected) + " FROM threads"):
                    item = dict(zip(selected, row))
                    labels[item["id"]] = item
        except sqlite3.Error:
            pass  # The index is optional; JSONL remains the source of discoverable records.
        finally:
            if connection:
                connection.close()
    try:
        with (root / "session_index.jsonl").open(encoding="utf-8") as handle:
            for line in handle:
                try:
                    item = json.loads(line)
                    if item.get("id") and item.get("thread_name"):
                        labels.setdefault(item["id"], {})["name"] = item["thread_name"]
                except ValueError:
                    pass
    except OSError:
        pass
    return labels

if config.get("operation") == "subagent_workflow":
    provider, filename = config["provider"], os.path.realpath(config["path"])
    root = os.path.realpath(roots.get(provider, ""))
    if provider != "claude" or os.path.commonpath([root, filename]) != root or not filename.endswith(".jsonl"):
        raise ValueError("不支持读取这个子代理工作流路径")
    payload = claude_subagent_workflow(filename, config.get("subagentId"), config.get("version"))
    print(json.dumps(payload, ensure_ascii=False))
elif config.get("operation") == "dialogue":
    provider, filename = config["provider"], os.path.realpath(config["path"])
    root = os.path.realpath(roots.get(provider, ""))
    if provider not in ("codex", "claude") or os.path.commonpath([root, filename]) != root or not filename.endswith(".jsonl"):
        raise ValueError("不支持读取这个会话路径")
    messages = []
    subs = []
    total_subs = 0
    subs_by_tool = {}
    subs_by_agent = {}
    seen_agent_msgs = set()
    spawned_tool_meta = {}
    session_id = Path(filename).stem
    if provider == "claude":
        subs, total_subs = claude_subagents(filename, time.time(), limit=60)
        for s in subs:
            if s.get("toolUseId"):
                subs_by_tool[s["toolUseId"]] = s
            aid = s.get("agentId") or s.get("id") or ""
            if aid:
                subs_by_agent[aid] = s
                if aid.startswith("agent-"):
                    subs_by_agent[aid[len("agent-"):]] = s
    current_task = ""
    turn_index = 0
    max_tail = 24_000_000 if provider == "claude" else 2_000_000

    def emit_claude_agent_message(raw_str, ts_val):
        parsed = parse_claude_agent_message(raw_str)
        if not parsed:
            return False
        dedup_key = (parsed["from"], parsed["text"][:140])
        if dedup_key in seen_agent_msgs:
            return True
        seen_agent_msgs.add(dedup_key)
        matched = subs_by_agent.get(parsed["from"]) or subs_by_agent.get(f"agent-{parsed['from']}")
        peer_name = matched.get("role") if matched else parsed["from"]
        sub_id = (matched.get("agentId") or matched.get("id")) if matched else ""
        messages.append({
            "id": f"agent-in-{len(messages)}-{parsed['from'][:16]}",
            "role": "agent_interaction",
            "direction": "inbound",
            "interactionKind": parsed["kind"],
            "peerId": parsed["from"],
            "peerName": peer_name,
            "subagentId": sub_id,
            "summary": parsed["summary"],
            "text": parsed["text"],
            **({"createdAt": ts_val} if ts_val else {}),
        })
        return True

    for row in records(filename, full=True, max_bytes=max_tail):
        if provider == "claude" and isinstance(row.get("sessionId"), str) and row.get("sessionId"):
            session_id = row["sessionId"]
        ts = row.get("timestamp")
        rtype = row.get("type")
        if provider == "claude":
            if rtype == "queue-operation" and row.get("operation") == "enqueue":
                emit_claude_agent_message(row.get("content"), ts)
                continue
            if rtype == "attachment":
                att = row.get("attachment")
                if isinstance(att, dict) and att.get("type") == "queued_command":
                    emit_claude_agent_message(att.get("prompt"), ts)
                continue
        message = row.get("payload", {}) if provider == "codex" and rtype == "response_item" else row.get("message", {}) if provider == "claude" else {}
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content")
        value = text(content)
        if role == "user":
            if provider == "claude":
                if value and emit_claude_agent_message(value, ts):
                    continue
                if value:
                    notif = parse_claude_task_notification(value)
                    if notif:
                        matched = subs_by_tool.get(notif["toolUseId"]) if notif.get("toolUseId") else None
                        messages.append({
                            "id": f"task-notif-{len(messages)}-{notif['taskId'] or notif['toolUseId']}",
                            "role": "agent_interaction",
                            "direction": "inbound",
                            "interactionKind": "notification",
                            "peerId": notif["taskId"] or notif["toolUseId"],
                            "peerName": (matched.get("role") if matched else "") or notif["taskId"] or "后台任务",
                            "subagentId": (matched.get("agentId") or matched.get("id")) if matched else "",
                            "status": notif["status"],
                            "summary": notif["summary"],
                            "text": notif["text"],
                            **({"createdAt": ts} if ts else {}),
                        })
                        continue
                if isinstance(content, list):
                    for blk in content:
                        if not isinstance(blk, dict) or blk.get("type") != "tool_result":
                            continue
                        tid = str(blk.get("tool_use_id") or "")
                        if tid not in spawned_tool_meta and tid not in subs_by_tool:
                            continue
                        out_txt, _ = extract_tool_result_text(blk.get("content"), 12_000)
                        if not out_txt.strip():
                            continue
                        if "was delivered to you as a message from" in out_txt[:260]:
                            continue
                        matched = subs_by_tool.get(tid) or spawned_tool_meta.get(tid) or {}
                        sub_id = matched.get("agentId") or matched.get("id") or ""
                        peer_name = matched.get("role") or "Subagent"
                        first_ln = next((ln.strip().lstrip("#*- ").strip() for ln in out_txt.splitlines() if ln.strip()), "")[:110]
                        messages.append({
                            "id": f"agent-res-{len(messages)}-{tid[:16]}",
                            "role": "agent_interaction",
                            "direction": "inbound",
                            "interactionKind": "handback",
                            "peerId": sub_id or tid,
                            "peerName": peer_name,
                            "subagentId": sub_id,
                            "status": "failed" if blk.get("is_error") else "completed",
                            "summary": first_ln,
                            "text": out_txt,
                            **({"createdAt": ts} if ts else {}),
                        })
            if value:
                if provider == "claude" and not row.get("isMeta") and not value.lstrip().startswith("<"):
                    turn_index += 1
                    current_task = value.strip().splitlines()[0][:90]
                messages.append({"role": role, "text": value[:30_000], **({"createdAt": ts} if ts else {})})
        elif role == "assistant":
            if value:
                messages.append({"role": role, "text": value[:30_000], **({"createdAt": ts} if ts else {})})
            if provider == "claude" and isinstance(content, list):
                spawned = []
                outbound_msgs = []
                for blk in content:
                    if not isinstance(blk, dict) or blk.get("type") != "tool_use":
                        continue
                    bname = blk.get("name")
                    tid = str(blk.get("id") or "")
                    inp = blk.get("input") if isinstance(blk.get("input"), dict) else {}
                    if bname == "SendMessage":
                        to_target = str(inp.get("to") or inp.get("recipient") or "").strip()[:120]
                        msg_body = str(inp.get("message") or inp.get("content") or "").strip()
                        msg_summary = str(inp.get("summary") or "").strip()[:120]
                        if to_target or msg_body:
                            matched = subs_by_agent.get(to_target) or subs_by_agent.get(f"agent-{to_target}")
                            outbound_msgs.append({
                                "id": f"agent-out-{len(messages)}-{tid or len(outbound_msgs)}",
                                "role": "agent_interaction",
                                "direction": "outbound",
                                "interactionKind": "message",
                                "peerId": to_target,
                                "peerName": (matched.get("role") if matched else "") or to_target,
                                "subagentId": (matched.get("agentId") or matched.get("id")) if matched else "",
                                "summary": msg_summary or (msg_body.splitlines()[0][:100] if msg_body else ""),
                                "text": msg_body[:12_000],
                                **({"createdAt": ts} if ts else {}),
                            })
                        continue
                    if bname not in ("Agent", "Task"):
                        continue
                    matched = subs_by_tool.get(tid)
                    s_name = str(inp.get("name") or inp.get("description") or "").strip()[:120]
                    s_type = str(inp.get("subagent_type") or "subagent")[:60]
                    s_model = str(inp.get("model") or "")[:80]
                    s_prompt = str(inp.get("prompt") or "").strip()[:480]
                    if matched is not None:
                        if current_task and not matched.get("taskTitle"):
                            matched["taskTitle"] = current_task
                        if turn_index and not matched.get("turnIndex"):
                            matched["turnIndex"] = turn_index
                        if ts and not matched.get("spawnedAt"):
                            matched["spawnedAt"] = ts
                        item_ref = dict(matched)
                        if s_name and item_ref.get("role", "").startswith("Subagent "):
                            item_ref["role"] = s_name
                        if s_prompt:
                            item_ref["promptPreview"] = s_prompt
                        spawned.append(item_ref)
                        if tid:
                            spawned_tool_meta[tid] = item_ref
                    elif tid or s_name:
                        item_ref = {
                            "id": tid or f"spawn-{turn_index}-{len(spawned)}",
                            "toolUseId": tid,
                            "role": s_name or "Subagent",
                            "typeName": s_type,
                            "model": s_model,
                            "background": bool(inp.get("run_in_background", True)),
                            "status": "completed",
                            "lastAction": "已完成",
                            "hasWorkflow": bool(tid),
                            "taskTitle": current_task,
                            "turnIndex": turn_index,
                            "spawnedAt": ts,
                            **({"promptPreview": s_prompt} if s_prompt else {}),
                        }
                        spawned.append(item_ref)
                        if tid:
                            spawned_tool_meta[tid] = item_ref
                if spawned:
                    if messages and messages[-1].get("role") == "subagent_group" and messages[-1].get("turnIndex") == turn_index:
                        existing_ids = {s.get("toolUseId") or s.get("id") for s in messages[-1]["subagents"]}
                        for sp in spawned:
                            k = sp.get("toolUseId") or sp.get("id")
                            if k not in existing_ids:
                                messages[-1]["subagents"].append(sp)
                                existing_ids.add(k)
                    else:
                        messages.append({
                            "id": f"subgrp-{turn_index}-{spawned[0].get('id', '')}",
                            "role": "subagent_group",
                            "text": "",
                            "taskTitle": current_task,
                            "turnIndex": turn_index,
                            "subagents": spawned,
                            **({"createdAt": ts} if ts else {}),
                        })
                messages.extend(outbound_msgs)
    payload = {"messages": messages[-120:], "limited": os.path.getsize(filename) > max_tail or len(messages) > 120}
    if provider == "claude":
        payload["subagents"] = list(reversed(subs))
        payload["totalSubagents"] = total_subs
        tmux_ttys = collect_tmux_ttys()
        ext_lock = detect_claude_external_locks(tmux_ttys, target_sid=session_id).get(session_id)
        payload["externalLock"] = ext_lock
    print(json.dumps(payload, ensure_ascii=False))
else:
    cache_file = Path.home() / ".cache" / "scope" / "session-catalog-v1.json"
    try:
        cache = json.loads(cache_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    entries, errors, next_cache = [], [], {}
    now_ts = time.time()
    tmux_ttys = collect_tmux_ttys()
    claude_locks = detect_claude_external_locks(tmux_ttys)
    agy_locks = detect_agy_external_locks(tmux_ttys)
    for provider in ("codex", "claude"):
        for filename in glob.iglob(os.path.join(roots[provider], "**", "*.jsonl"), recursive=True):
            if provider == "claude" and "subagents" in Path(filename).parts:
                continue  # Child transcripts share the parent sessionId; they are not resumable sessions.
            try:
                stat = os.stat(filename)
                sub_dir = Path(filename).with_suffix("") / "subagents" if provider == "claude" else None
                sub_mtime = os.stat(sub_dir).st_mtime if sub_dir and sub_dir.is_dir() else 0
                recent = (now_ts - max(stat.st_mtime, sub_mtime)) < 600
                stamp = [stat.st_mtime_ns, stat.st_size]
                saved = cache.get(filename)
                item = dict(saved["item"]) if saved and saved.get("stamp") == stamp else metadata(provider, filename)
                next_cache[filename] = {"stamp": stamp, "item": item}
                if provider == "claude":
                    if recent and sub_dir and sub_dir.is_dir():
                        sub_list, _ = claude_subagents(filename, now_ts, limit=32)
                        active = sum(1 for sub in sub_list if sub["status"] == "working")
                        if active > 0:
                            item = {**item, "activeSubagents": active}
                    ext = claude_locks.get(item.get("sessionId"))
                    if ext:
                        item = {**item, "externalLock": ext}
                entries.append(item)
            except (OSError, ValueError, TypeError) as error:
                errors.append(f"{provider}: {type(error).__name__}")
    labels = codex_labels()
    for item in entries:
        if item["provider"] != "codex":
            continue
        label = labels.get(item["sessionId"], {})
        item["title"] = (label.get("name") or label.get("title") or item["title"])[:160]
        item["cwd"] = label.get("cwd") or item["cwd"]
        item["model"] = label.get("model") or item["model"]
    try:
        for agy_item in agy_entries():
            ext = agy_locks.get(agy_item.get("sessionId"))
            if ext:
                agy_item["externalLock"] = ext
            entries.append(agy_item)
    except (sqlite3.Error, ValueError, TypeError) as error:
        errors.append("antigravity: " + str(error))
    for item in entries:
        if item["provider"] in ("claude", "antigravity"):
            try:
                state = json.loads((Path.home() / ".local/state/scope" / (item["provider"] + "-sessions") / (item["sessionId"] + ".json")).read_text())
                item["phase"] = state.get("phase", "active")
            except FileNotFoundError:
                item["phase"] = "active"
    try:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache_file.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(next_cache, ensure_ascii=False), encoding="utf-8")
        os.chmod(temporary, 0o600)
        os.replace(temporary, cache_file)
    except OSError:
        pass
    print(json.dumps({"entries": entries, "errors": list(dict.fromkeys(errors)), "roots": roots}, ensure_ascii=False))
