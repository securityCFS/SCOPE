"""Bounded, read-only AGY transcript reader. Never launches or resumes an agent."""
import base64
import json
import os
from pathlib import Path
import re
import sys
import time

MAX_BYTES = 2_000_000
MAX_ROWS = 100
MAX_TEXT = 30_000
CREATED_SUBAGENT_RE = re.compile(r'Created the following subagent:\s*\{\s*"conversationId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})"')
SENDER_RE = re.compile(r'sender=([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})')


def message(row):
    kind = row.get("type")
    content = row.get("content") if isinstance(row.get("content"), str) else ""
    result = {"id": str(row.get("step_index", "")), "createdAt": row.get("created_at"), "status": row.get("status")}
    tool_truncated = False
    if kind == "USER_INPUT" and row.get("source") == "USER_EXPLICIT":
        # Strip only the provider's outer envelope, not arbitrary embedded XML.
        if content.startswith("<USER_REQUEST>\n"):
            end = content.rfind("\n</USER_REQUEST>")
            if end >= 0:
                content = content[len("<USER_REQUEST>\n"):end]
        result.update(role="user", text=content[:MAX_TEXT])
    elif kind == "PLANNER_RESPONSE":
        result.update(role="assistant", text=content[:MAX_TEXT])
        calls = row.get("tool_calls")
        if isinstance(calls, list) and calls:
            # `thinking`, system messages and checkpoint internals are not exported.
            activity = json.dumps(calls, ensure_ascii=False)
            result["activity"] = activity[:MAX_TEXT]
            tool_truncated = len(activity) > MAX_TEXT
            result["title"] = "工具调用"
    elif kind in ("GENERIC", "ERROR_MESSAGE"):
        result.update(role="activity", title="执行错误" if kind == "ERROR_MESSAGE" or row.get("status") == "ERROR" else "工具记录", text=(content or str(row.get("error") or ""))[:MAX_TEXT])
    else:
        return None
    result["truncated"] = tool_truncated or len(content) > MAX_TEXT or bool(row.get("truncated_fields"))
    return result if result.get("text") or result.get("activity") else None


def _clean_arg(value):
    if not isinstance(value, str):
        return str(value) if value is not None else ""
    text = value.strip()
    if len(text) >= 2 and text.startswith('"') and text.endswith('"'):
        try:
            decoded = json.loads(text)
            if isinstance(decoded, str):
                return decoded.strip()
        except ValueError:
            pass
        return text[1:-1].strip()
    return text


def _read_tail_rows(filename, max_bytes):
    rows = []
    with filename.open("rb") as handle:
        size = os.fstat(handle.fileno()).st_size
        start = max(0, size - max_bytes)
        handle.seek(start)
        data = handle.read(max_bytes)
    if start > 0:
        nl = data.find(b"\n")
        if nl >= 0:
            data = data[nl + 1:]
    for line in data.splitlines():
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                rows.append(value)
        except (ValueError, UnicodeError):
            continue
    return rows


def extract_subagents(root, filename):
    pending_meta = []
    ordered_ids = []
    records = {}
    completed_ids = set()
    killed_ids = set()
    for row in _read_tail_rows(filename, 512_000):
        kind = row.get("type")
        if kind == "PLANNER_RESPONSE":
            for call in row.get("tool_calls") or []:
                if not isinstance(call, dict):
                    continue
                name = call.get("name") or call.get("tool_name")
                args = call.get("args") or call.get("arguments") or {}
                if not isinstance(args, dict):
                    continue
                if name == "invoke_subagent":
                    pending_meta.append({
                        "role": _clean_arg(args.get("Role"))[:120] or "子代理",
                        "typeName": _clean_arg(args.get("TypeName"))[:60] or "subagent",
                    })
                elif name == "swarm" and _clean_arg(args.get("action")) == "add":
                    base = _clean_arg(args.get("name")) or "worker"
                    pending_meta.append({
                        "role": base[:120],
                        "typeName": "swarm",
                    })
                elif name == "manage_subagents":
                    action = _clean_arg(args.get("Action"))
                    if action == "kill_all":
                        killed_ids.update(ordered_ids)
                    elif action == "kill":
                        ids = args.get("ConversationIds") or []
                        if isinstance(ids, str):
                            try:
                                ids = json.loads(ids)
                            except ValueError:
                                ids = []
                        for cid in ids if isinstance(ids, list) else []:
                            killed_ids.add(str(cid))
        elif kind == "GENERIC" and isinstance(row.get("content"), str):
            for match in CREATED_SUBAGENT_RE.finditer(row["content"]):
                cid = match.group(1)
                meta = pending_meta.pop(0) if pending_meta else {"role": f"子代理 {cid[:8]}", "typeName": "subagent"}
                if cid not in records:
                    ordered_ids.append(cid)
                records[cid] = {
                    "id": cid,
                    "role": meta["role"],
                    "typeName": meta["typeName"],
                    "background": True,
                    "status": "working",
                    "lastAction": "运行中",
                    "updatedAt": None,
                }
        elif kind == "SYSTEM_MESSAGE" and isinstance(row.get("content"), str):
            match = SENDER_RE.search(row["content"])
            if match:
                completed_ids.add(match.group(1))

    now_ts = time.time()
    result = []
    for cid in ordered_ids[-24:]:
        item = records[cid]
        child_dir = root / cid / ".system_generated/logs"
        child_file = next(
            (p for p in (child_dir / "transcript_full.jsonl", child_dir / "transcript.jsonl") if p.is_file()),
            None,
        )
        if child_file is not None and root in child_file.resolve().parents:
            try:
                st = child_file.stat()
                item["updatedAt"] = int(st.st_mtime * 1000)
                tail = _read_tail_rows(child_file, 16_384)
                last_action = ""
                for crow in tail:
                    for call in crow.get("tool_calls") or []:
                        if isinstance(call, dict) and (call.get("name") or call.get("tool_name")):
                            last_action = str(call.get("name") or call.get("tool_name"))[:80]
                last_row = tail[-1] if tail else {}
                if cid in killed_ids:
                    item["status"] = "stopped"
                elif last_row.get("type") == "ERROR_MESSAGE" or last_row.get("status") == "ERROR":
                    item["status"] = "failed"
                elif (
                    last_row.get("type") == "PLANNER_RESPONSE"
                    and last_row.get("status") == "DONE"
                    and not (last_row.get("tool_calls") or [])
                ):
                    item["status"] = "completed"
                elif cid in completed_ids:
                    item["status"] = "completed"
                elif now_ts - st.st_mtime < 600:
                    item["status"] = "working"
                else:
                    item["status"] = "completed"
                if last_action:
                    item["lastAction"] = last_action
                elif item["status"] == "completed":
                    item["lastAction"] = "已完成"
            except OSError:
                pass
        elif cid in killed_ids:
            item["status"] = "stopped"
        elif cid in completed_ids:
            item["status"] = "completed"
            item["lastAction"] = "已完成"
        result.append(item)
    return result


def read_history(config):
    sid = config.get("sessionId", "")
    if not isinstance(sid, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}", sid):
        raise ValueError("Invalid AGY session ID")
    root = (Path.home() / ".gemini/antigravity-cli/brain").resolve()
    folder = root / sid / ".system_generated/logs"
    candidates = [folder / "transcript_full.jsonl", folder / "transcript.jsonl"]
    filename = next((p for p in candidates if p.is_file()), None)
    if filename is None:
        return {"messages": [], "subagents": [], "summaryOnly": True, "reason": "此会话尚无可读取的文本历史"}
    if root not in filename.resolve().parents:
        raise ValueError("AGY history path escapes its history directory")
    with filename.open("rb") as handle:
        stamp = os.fstat(handle.fileno())
        version = f"{filename.name}:{stamp.st_mtime_ns}:{stamp.st_size}"
        reset = bool(config.get("version") and config["version"] != version)
        before = config.get("before")
        end = stamp.st_size if before is None or reset else int(before)
        if end < 0 or end > stamp.st_size:
            raise ValueError("Invalid AGY history cursor")
        start = max(0, end - MAX_BYTES)
        handle.seek(max(0, start - 1))
        partial = start > 0 and handle.read(1) != b"\n"
        data = handle.read(max(0, end - start))
        rows, skipped, position = [], False, start
        if partial:
            newline = data.find(b"\n")
            if newline < 0:
                data, skipped = b"", True
            else:
                position += newline + 1
                data = data[newline + 1:]
        page_start = position if position < end else start
        for line in data.splitlines(keepends=True):
            try:
                value = json.loads(line)
                item = message(value) if isinstance(value, dict) else None
                if item:
                    rows.append((position, item))
            except (ValueError, TypeError, UnicodeError):
                skipped = True
            position += len(line)
        selected = rows[-MAX_ROWS:]
        # Keep the partial line for the previous page; never skip it silently.
        next_before = selected[0][0] if len(rows) > MAX_ROWS else page_start
        current = os.fstat(handle.fileno())
        if (stamp.st_mtime_ns, stamp.st_size) != (current.st_mtime_ns, current.st_size):
            raise ValueError("AGY 历史正在更新，请稍后刷新")
    return {"messages": [item for _, item in selected], "subagents": extract_subagents(root, filename), "summaryOnly": False,
            "source": filename.name, "version": version, "reset": reset,
            "nextBefore": next_before if next_before > 0 else None,
            "limited": skipped or any(item.get("truncated") for _, item in selected) or (not selected and start > 0)}


if __name__ == "__main__":
    config = json.loads(base64.urlsafe_b64decode(sys.argv[1] + "==="))
    print(json.dumps(read_history(config), ensure_ascii=False))
