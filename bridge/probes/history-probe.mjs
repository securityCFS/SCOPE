/** Remote probe, kept independent of HTTP and local mutable state. */
export const HISTORY_PROBE = String.raw`
import ast
import collections
import datetime
import glob
import json
import os
import sys

limit = max(1, min(300, int(sys.argv[1])))
order = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] == "oldest" else "recent"

def text_from_content(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for item in content:
        if not isinstance(item, dict) or item.get("type") == "encrypted_content":
            continue
        text = item.get("text")
        if isinstance(text, str):
            parts.append(text)
    return "\n".join(parts)

def tool_output_text(value):
    parsed = value
    if isinstance(value, str):
        stripped = value.strip()
        for parser in (json.loads, ast.literal_eval):
            try:
                parsed = parser(stripped)
                break
            except Exception:
                parsed = value
    if isinstance(parsed, dict):
        parsed = parsed.get("content") or parsed.get("output") or parsed
    if isinstance(parsed, list):
        extracted = text_from_content(parsed)
        if extracted:
            return extracted
    return value if isinstance(value, str) else str(value or "")

def clean(value, limit=600):
    if not isinstance(value, str):
        return ""
    value = " ".join(value.replace("\x00", "").split())
    return value[:limit]

def parse_subagent_notification(value):
    text = text_from_content(value) if not isinstance(value, str) else value
    if not isinstance(text, str):
        return None
    stripped = text.strip()
    markers = ("<subagent_notification>", "{subagent_notification}")
    marker = next((item for item in markers if stripped.startswith(item)), None)
    if not marker:
        return None
    try:
        notification, _ = json.JSONDecoder().raw_decode(
            stripped[len(marker):].strip()
        )
    except Exception:
        return None
    status = notification.get("status") if isinstance(notification, dict) else None
    if not isinstance(status, dict):
        return None
    state = next(
        (key for key in ("completed", "failed", "errored", "cancelled") if key in status),
        "updated",
    )
    content = status.get(state)
    if not isinstance(content, str):
        content = json.dumps(content, ensure_ascii=False) if content is not None else ""
    return content

def is_context_message(value):
    if not isinstance(value, str):
        return True
    return value.lstrip().startswith((
        "<environment_context>",
        "<permissions",
        "<INSTRUCTIONS>",
        "<collaboration_mode>",
        "<apps_instructions>",
        "<plugins_instructions>",
        "<skills_instructions>",
        "<recommended_plugins>",
        "<in-app-browser-context",
        "# AGENTS.md instructions",
        "A previous agent produced",
        "You are Codex",
    ))

def sampled_lines(filename):
    size = os.path.getsize(filename)
    with open(filename, "rb") as handle:
        first = handle.readline()
        head = handle.read(64000)
        if size > 256000:
            handle.seek(max(0, size - 192000))
        tail = handle.read()
    chunks = (first + head + b"\n" + tail).decode("utf-8", errors="replace")
    seen = set()
    for line in chunks.splitlines():
        if line in seen:
            continue
        seen.add(line)
        yield line

def timestamp_epoch(value):
    if not isinstance(value, str) or not value:
        return 0.0
    try:
        return datetime.datetime.fromisoformat(
            value.replace("Z", "+00:00")
        ).timestamp()
    except Exception:
        return 0.0

def latest_event(filename):
    try:
        size = os.path.getsize(filename)
        with open(filename, "rb") as handle:
            # The final event normally fits in a few KiB. This keeps ordering
            # based on the true event timestamp without reading 256 KiB from
            # every rollout as the previous implementation did.
            handle.seek(max(0, size - 16384))
            tail = handle.read().decode("utf-8", errors="replace")
        for raw in reversed(tail.splitlines()):
            try:
                event = json.loads(raw)
            except Exception:
                continue
            value = event.get("timestamp")
            epoch = timestamp_epoch(value)
            if epoch:
                return epoch, value
    except Exception:
        pass
    try:
        return os.path.getmtime(filename), ""
    except Exception:
        return 0.0, ""

paths = list(dict.fromkeys(
    glob.glob(os.path.expanduser("~/.codex/sessions/**/*.jsonl"), recursive=True)
    + glob.glob(
        os.path.expanduser("~/.codex/archived_sessions/**/*.jsonl"),
        recursive=True,
    )
))
path_mtimes = {}
path_activity = {}
for filename in paths:
    try:
        path_mtimes[filename] = os.path.getmtime(filename)
    except Exception:
        path_mtimes[filename] = 0.0
    path_activity[filename] = latest_event(filename)
paths.sort(
    key=lambda item: (path_activity[item][0], path_mtimes[item]),
    reverse=order == "recent",
)
records = []

for filename in paths:
    if len(records) >= limit:
        break
    try:
        with open(filename, "r", encoding="utf-8", errors="replace") as handle:
            first_obj = json.loads(handle.readline())
        meta = (
            first_obj.get("payload", {})
            if first_obj.get("type") == "session_meta"
            else {}
        )
    except Exception:
        continue

    source = meta.get("source")
    subagent = source.get("subagent", {}) if isinstance(source, dict) else {}
    spawn = subagent.get("thread_spawn", {}) if isinstance(subagent, dict) else {}
    if spawn or meta.get("parent_thread_id"):
        continue

    record = {
        "id": meta.get("id") or meta.get("session_id") or os.path.basename(filename),
        "rootSessionId": meta.get("session_id") or meta.get("id") or "",
        "parentThreadId": "",
        "agentPath": "",
        "agentNickname": "",
        "isSubagent": False,
        "cwd": meta.get("cwd") or "",
        "startedAt": meta.get("timestamp") or first_obj.get("timestamp"),
        "cliVersion": meta.get("cli_version") or "",
        "path": filename,
        "archived": "/.codex/archived_sessions/" in filename.replace("\\", "/"),
        "mtimeMs": int(path_mtimes.get(filename, 0.0) * 1000),
        "firstUser": "",
        "lastUser": "",
        "lastAssistant": "",
        "lastAction": "",
        "lastError": "",
        "userMessages": [],
        "assistantMessages": [],
        "model": "",
        "reasoningEffort": "",
        "approvalPolicy": "",
        "sandboxPolicy": "",
        "collaborationMode": "",
        "account": None,
        "tokenUsage": None,
        "turnState": "idle",
        "lastEventAt": path_activity.get(filename, (0, ""))[1]
        or first_obj.get("timestamp"),
    }

    for raw in sampled_lines(filename):
        try:
            event = json.loads(raw)
        except Exception:
            continue
        payload = event.get("payload", {})
        if not isinstance(payload, dict):
            payload = {}
        event_type = event.get("type")
        event_timestamp = event.get("timestamp")
        if timestamp_epoch(event_timestamp) >= timestamp_epoch(record["lastEventAt"]):
            record["lastEventAt"] = event_timestamp or record["lastEventAt"]

        if event_type == "turn_context":
            record["model"] = payload.get("model") or record["model"]
            record["reasoningEffort"] = (
                payload.get("effort")
                or payload.get("reasoning_effort")
                or record["reasoningEffort"]
            )
            record["approvalPolicy"] = (
                payload.get("approval_policy") or record["approvalPolicy"]
            )
            sandbox = payload.get("sandbox_policy")
            if isinstance(sandbox, dict):
                record["sandboxPolicy"] = (
                    sandbox.get("type")
                    or sandbox.get("mode")
                    or record["sandboxPolicy"]
                )
            elif isinstance(sandbox, str):
                record["sandboxPolicy"] = sandbox
            collaboration = payload.get("collaboration_mode")
            if isinstance(collaboration, dict):
                record["collaborationMode"] = (
                    collaboration.get("mode")
                    or collaboration.get("name")
                    or record["collaborationMode"]
                )
            elif isinstance(collaboration, str):
                record["collaborationMode"] = collaboration

        if event_type == "event_msg":
            kind = payload.get("type")
            if kind in ("user_message", "user_input"):
                raw_candidate = (
                    payload.get("message") or payload.get("text") or payload.get("content")
                )
                notification = parse_subagent_notification(raw_candidate)
                if notification is not None:
                    candidate = clean(notification, 1200)
                    if candidate:
                        record["lastAssistant"] = candidate
                        record["assistantMessages"].append(candidate)
                        record["assistantMessages"] = record["assistantMessages"][-4:]
                else:
                    candidate = clean(raw_candidate)
                    if candidate and not is_context_message(candidate):
                        record["firstUser"] = record["firstUser"] or candidate
                        record["lastUser"] = candidate
                        record["userMessages"].append(candidate)
                        record["userMessages"] = record["userMessages"][-4:]
            elif kind == "agent_message":
                candidate = clean(
                    payload.get("message") or payload.get("text"),
                    1200,
                )
                if candidate:
                    record["lastAssistant"] = candidate
                    record["assistantMessages"].append(candidate)
                    record["assistantMessages"] = record["assistantMessages"][-4:]
            elif kind in ("task_complete", "turn_complete", "task_completed"):
                candidate = clean(payload.get("last_agent_message"), 1200)
                if candidate:
                    record["lastAssistant"] = candidate
                    record["assistantMessages"].append(candidate)
                    record["assistantMessages"] = record["assistantMessages"][-4:]
            continue

        if event_type != "response_item":
            continue
        kind = payload.get("type")
        role = payload.get("role")
        if kind == "message" and role == "user":
            raw_candidate = text_from_content(payload.get("content"))
            notification = parse_subagent_notification(raw_candidate)
            if notification is not None:
                candidate = clean(notification, 1200)
                if candidate:
                    record["lastAssistant"] = candidate
                    record["assistantMessages"].append(candidate)
                    record["assistantMessages"] = record["assistantMessages"][-4:]
            else:
                candidate = clean(raw_candidate)
                if candidate and not is_context_message(candidate):
                    record["firstUser"] = record["firstUser"] or candidate
                    record["lastUser"] = candidate
                    record["userMessages"].append(candidate)
                    record["userMessages"] = record["userMessages"][-4:]
        elif kind == "message" and role == "assistant":
            candidate = clean(text_from_content(payload.get("content")), 1200)
            if candidate:
                record["lastAssistant"] = candidate
                record["assistantMessages"].append(candidate)
                record["assistantMessages"] = record["assistantMessages"][-4:]
        elif kind in ("function_call", "custom_tool_call"):
            name = payload.get("name") or "tool"
            arguments = payload.get("arguments") or payload.get("input") or ""
            record["lastAction"] = clean(f"{name}: {arguments}", 500)
        elif kind in ("function_call_output", "custom_tool_call_output"):
            output = clean(tool_output_text(payload.get("output")), 500)
            if (
                "exit code 1" in output.lower()
                or "process exited with code 1" in output.lower()
                or "traceback" in output.lower()
            ):
                record["lastError"] = output

    records.append(record)

print(json.dumps({
    "totalFiles": len(paths),
    "limit": limit,
    "truncated": len(records) >= limit,
    "sessions": records,
}, ensure_ascii=False, separators=(",", ":")))
`;
