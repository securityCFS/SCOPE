"""Read metadata for native CLI histories. No agent process is started."""
import base64
import glob
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
from urllib.parse import unquote, urlparse

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

def records(filename, full=False):
    with open(filename, "rb") as handle:
        if full:
            # Conversation pages read only a bounded tail; never load an entire log into memory.
            size = os.fstat(handle.fileno()).st_size
            handle.seek(max(0, size - 2_000_000))
            if handle.tell():
                handle.readline()
            data = handle.read(2_000_000)
        else:
            data = handle.read(24_000)
            size = os.fstat(handle.fileno()).st_size
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

def claude_subagents(filename, now_ts):
    sub_dir = Path(filename).with_suffix("") / "subagents"
    if not sub_dir.is_dir():
        return []
    files = []
    for child in sub_dir.glob("agent-*.jsonl"):
        try:
            files.append((child.stat().st_mtime, child))
        except OSError:
            continue
    files.sort(key=lambda item: item[0])
    result = []
    for mtime, child in files[-24:]:
        role = ""
        last_action = ""
        stop_reason = None
        last_type = ""
        try:
            with child.open("rb") as handle:
                size = os.fstat(handle.fileno()).st_size
                head = handle.read(min(8_192, size))
                tail = head if size <= 16_384 else (handle.seek(max(0, size - 16_384)) and False) or handle.read(16_384)
            if size > 16_384 and b"\n" in tail:
                tail = tail.split(b"\n", 1)[1]
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
                try:
                    row = json.loads(raw_line)
                except (ValueError, UnicodeError):
                    continue
                if not isinstance(row, dict):
                    continue
                last_type = row.get("type") or last_type
                msg = row.get("message") if isinstance(row.get("message"), dict) else {}
                if "stop_reason" in msg:
                    stop_reason = msg.get("stop_reason")
                if isinstance(msg.get("content"), list):
                    for blk in msg["content"]:
                        if isinstance(blk, dict) and blk.get("type") == "tool_use" and blk.get("name"):
                            last_action = str(blk["name"])[:80]
        except OSError:
            continue
        working = (now_ts - mtime < 180) and (stop_reason != "end_turn")
        result.append({
            "id": child.stem,
            "role": role or f"Subagent {child.stem[:10]}",
            "typeName": "subagent",
            "background": True,
            "status": "working" if working else "completed",
            "lastAction": last_action or ("运行中" if working else "已完成"),
            "updatedAt": int(mtime * 1000),
        })
    return result

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

if config.get("operation") == "dialogue":
    provider, filename = config["provider"], os.path.realpath(config["path"])
    root = os.path.realpath(roots.get(provider, ""))
    if provider not in ("codex", "claude") or os.path.commonpath([root, filename]) != root or not filename.endswith(".jsonl"):
        raise ValueError("不支持读取这个会话路径")
    messages = []
    for row in records(filename, full=True):
        message = row.get("payload", {}) if provider == "codex" and row.get("type") == "response_item" else row.get("message", {}) if provider == "claude" else {}
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        value = text(message.get("content"))
        if role in ("user", "assistant") and value:
            messages.append({"role": role, "text": value[:30_000]})
    payload = {"messages": messages[-100:], "limited": os.path.getsize(filename) > 2_000_000 or len(messages) > 100}
    if provider == "claude":
        payload["subagents"] = claude_subagents(filename, time.time())
    print(json.dumps(payload, ensure_ascii=False))
else:
    cache_file = Path.home() / ".cache" / "scope" / "session-catalog-v1.json"
    try:
        cache = json.loads(cache_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    entries, errors, next_cache = [], [], {}
    now_ts = time.time()
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
                if provider == "claude" and recent and sub_dir and sub_dir.is_dir():
                    active = sum(1 for sub in claude_subagents(filename, now_ts) if sub["status"] == "working")
                    if active > 0:
                        item = {**item, "activeSubagents": active}
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
        entries.extend(agy_entries())
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
