/** Remote probe, kept independent of HTTP and local mutable state. */
export const DIALOGUE_PROBE = String.raw`
import json
import os
import sys

MAX_TOOL_EVENTS = 300
MAX_TOOL_TEXT = 6000
MAX_DIALOGUE_TEXT = 200000

path = os.path.realpath(sys.argv[1])
page_limit = max(1, min(100, int(sys.argv[2]) if len(sys.argv) > 2 else 10))
dialogue_only = len(sys.argv) > 4 and sys.argv[4] == "dialogue-only"
file_size = os.path.getsize(path)
before_byte = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else file_size
scan_end = max(0, min(file_size, before_byte))
scan_start = max(0, scan_end - (8000000 if dialogue_only else 2000000))
events = []
call_events = {}
last_dialogue_line = {}
event_ordinals = {}
hidden_reasoning_count = 0
tool_event_count = 0
line_count = 0
current_byte = scan_start

def readable_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            if item.get("type") == "encrypted_content":
                continue
            for key in ("text", "content", "output"):
                candidate = item.get(key)
                if isinstance(candidate, str):
                    parts.append(candidate)
                    break
        return "\n".join(parts)
    if isinstance(value, dict):
        for key in ("text", "content", "output", "message"):
            candidate = value.get(key)
            if isinstance(candidate, str):
                return candidate
        return json.dumps(value, ensure_ascii=False)
    if value is None:
        return ""
    return str(value)

def clean_text(value, limit):
    text = readable_text(value).replace("\x00", "")
    if len(text) <= limit:
        return text
    omitted = len(text) - limit
    return text[:limit] + f"\n\n… [已压缩 {omitted} 个字符]"

def parse_subagent_notification(value):
    text = readable_text(value).strip()
    markers = ("<subagent_notification>", "{subagent_notification}")
    marker = next((item for item in markers if text.startswith(item)), None)
    if not marker:
        return None
    encoded = text[len(marker):].strip()
    try:
        notification, _ = json.JSONDecoder().raw_decode(encoded)
    except Exception:
        return None
    if not isinstance(notification, dict):
        return None
    status = notification.get("status")
    if not isinstance(status, dict):
        return None
    state = next(
        (key for key in ("completed", "failed", "errored", "cancelled") if key in status),
        "updated",
    )
    content = status.get(state)
    if not isinstance(content, str):
        content = json.dumps(content, ensure_ascii=False) if content is not None else ""
    return {
        "agentPath": str(notification.get("agent_path") or ""),
        "state": state,
        "text": content,
    }

def is_context_message(value):
    if not isinstance(value, str):
        return True
    stripped = value.lstrip()
    return stripped.startswith((
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

def add_event(kind, title, text="", timestamp=None, **extra):
    global tool_event_count
    category = extra.pop("category", None)
    if category is None:
        if kind == "user":
            category = "dialogue"
        elif kind == "assistant":
            category = "reasoning" if extra.get("phase") == "commentary" else "dialogue"
        elif kind in ("reasoning", "intermediate"):
            category = "reasoning"
        else:
            category = "operations"
    text_limit = MAX_TOOL_TEXT if kind in ("command", "tool") else MAX_DIALOGUE_TEXT
    ordinal = event_ordinals.get(current_byte, 0)
    event_ordinals[current_byte] = ordinal + 1
    record = {
        "id": f"byte-{current_byte}-{ordinal}",
        "kind": kind,
        "category": category,
        "title": title,
        "text": clean_text(text, text_limit),
        "timestamp": timestamp,
        "_sourceByte": current_byte,
    }
    for key, value in extra.items():
        if value not in (None, ""):
            record[key] = value
    events.append(record)
    if kind in ("command", "tool"):
        tool_event_count += 1
    return record

def add_dialogue(kind, title, text, timestamp=None, **extra):
    candidate = clean_text(text, MAX_DIALOGUE_TEXT)
    if not candidate or (kind == "user" and is_context_message(candidate)):
        return None
    signature = (kind, candidate)
    previous_line = last_dialogue_line.get(signature)
    if previous_line is not None and line_count - previous_line <= 4:
        return None
    last_dialogue_line[signature] = line_count
    return add_event(kind, title, candidate, timestamp, **extra)

def reasoning_summary(payload):
    summary = payload.get("summary")
    if not isinstance(summary, list):
        return readable_text(summary)
    parts = []
    for item in summary:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict):
            text = item.get("text") or item.get("summary_text")
            if isinstance(text, str):
                parts.append(text)
    return "\n\n".join(parts)

def call_input(payload):
    value = payload.get("arguments")
    if value in (None, ""):
        value = payload.get("input")
    return readable_text(value)

def command_from_call(name, value):
    lowered = str(name).lower()
    parsed = None
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            parsed = None
    elif isinstance(value, dict):
        parsed = value
    if isinstance(parsed, dict):
        command = parsed.get("cmd") or parsed.get("command")
        if isinstance(command, list):
            command = " ".join(str(part) for part in command)
        if isinstance(command, str):
            return command
    if any(token in lowered for token in ("exec", "shell", "terminal", "write_stdin")):
        return readable_text(value)
    return ""

with open(path, "rb") as handle:
    handle.seek(scan_start)
    window = handle.read(scan_end - scan_start)

if scan_start > 0:
    boundary = window.find(b"\n")
    if boundary < 0:
        window = b""
        scan_start = scan_end
    else:
        scan_start += boundary + 1
        window = window[boundary + 1:]

cursor = scan_start
for raw_bytes in window.splitlines(keepends=True):
        current_byte = cursor
        cursor += len(raw_bytes)
        raw = raw_bytes.decode("utf-8", errors="replace")
        line_count += 1
        try:
            event = json.loads(raw)
        except Exception:
            continue

        timestamp = event.get("timestamp")
        event_type = event.get("type")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            payload = {}

        if event_type == "event_msg":
            kind = payload.get("type")
            if kind in ("user_message", "user_input"):
                content = payload.get("message") or payload.get("text") or payload.get("content")
                notification = parse_subagent_notification(content)
                if notification:
                    agent_label = notification["agentPath"][:8] or "Subagent"
                    add_dialogue(
                        "intermediate",
                        f"Subagent {agent_label} · {notification['state']}",
                        notification["text"],
                        timestamp,
                        category="subagent",
                        agentPath=notification["agentPath"],
                    )
                else:
                    add_dialogue("user", "User", content, timestamp)
            elif kind == "agent_message":
                phase = payload.get("phase") or ""
                title = "Codex · 中间汇报" if phase == "commentary" else "Codex · 回复"
                add_dialogue(
                    "assistant",
                    title,
                    payload.get("message") or payload.get("text"),
                    timestamp,
                    phase=phase,
                )
            elif kind in ("agent_reasoning", "reasoning"):
                summary = payload.get("summary") or payload.get("text") or payload.get("message")
                if summary:
                    add_dialogue("reasoning", "Reasoning summary", summary, timestamp)
                else:
                    hidden_reasoning_count += 1
            elif kind == "task_started":
                add_event("system", "Turn 开始", "", timestamp, turnId=payload.get("turn_id"))
            elif kind in ("task_complete", "turn_complete", "task_completed"):
                add_dialogue(
                    "assistant",
                    "Codex · 最终回复",
                    payload.get("last_agent_message"),
                    timestamp,
                    phase="final_answer",
                )
                add_event("system", "Turn 完成", "", timestamp, turnId=payload.get("turn_id"))
            elif kind == "turn_aborted":
                add_event(
                    "error",
                    "Turn 中止",
                    payload.get("reason") or "该轮已中止",
                    timestamp,
                    turnId=payload.get("turn_id"),
                )
            elif kind in ("error", "stream_error"):
                add_event(
                    "error",
                    "会话错误",
                    payload.get("message") or payload.get("error") or payload,
                    timestamp,
                )
            elif kind == "sub_agent_activity":
                detail = " · ".join(
                    str(part)
                    for part in (payload.get("agent_path"), payload.get("kind"))
                    if part
                )
                add_event(
                    "intermediate",
                    "子代理活动",
                    detail,
                    timestamp,
                    category="subagent",
                )
            elif kind == "context_compacted":
                add_event("system", "上下文已压缩", "", timestamp)
            elif kind == "patch_apply_end" and not payload.get("success", True):
                add_event(
                    "error",
                    "补丁应用失败",
                    payload.get("stderr") or payload.get("stdout") or payload,
                    timestamp,
                )
            continue

        if event_type == "compacted":
            add_event(
                "intermediate",
                "上下文压缩摘要",
                payload.get("message") or "",
                timestamp,
                category="reasoning",
            )
            continue

        if event_type != "response_item":
            continue

        kind = payload.get("type")
        role = payload.get("role")
        if kind == "message" and role == "user":
            content = payload.get("content")
            notification = parse_subagent_notification(content)
            if notification:
                agent_label = notification["agentPath"][:8] or "Subagent"
                add_dialogue(
                    "intermediate",
                    f"Subagent {agent_label} · {notification['state']}",
                    notification["text"],
                    timestamp,
                    category="subagent",
                    agentPath=notification["agentPath"],
                )
            else:
                add_dialogue("user", "User", content, timestamp)
        elif kind == "message" and role == "assistant":
            phase = payload.get("phase") or ""
            title = "Codex · 中间汇报" if phase == "commentary" else "Codex · 回复"
            add_dialogue(
                "assistant",
                title,
                payload.get("content"),
                timestamp,
                phase=phase,
            )
        elif kind == "agent_message":
            author = payload.get("author") or "Codex"
            recipient = payload.get("recipient")
            title = f"{author} → {recipient}" if recipient else str(author)
            add_dialogue(
                "intermediate",
                title,
                payload.get("content"),
                timestamp,
                category="subagent",
            )
        elif kind == "reasoning":
            summary = reasoning_summary(payload)
            if summary:
                add_dialogue("reasoning", "Reasoning summary", summary, timestamp)
            else:
                hidden_reasoning_count += 1
        elif kind in ("function_call", "custom_tool_call"):
            name = payload.get("name") or "tool"
            raw_input = payload.get("arguments")
            if raw_input in (None, ""):
                raw_input = payload.get("input")
            command = command_from_call(name, raw_input)
            event_kind = "command" if command else "tool"
            record = add_event(
                event_kind,
                f"{'命令' if command else '工具'} · {name}",
                call_input(payload),
                timestamp,
                toolName=name,
                command=clean_text(command, MAX_TOOL_TEXT),
                status=payload.get("status") or "started",
            )
            call_id = payload.get("call_id") or payload.get("id")
            if call_id:
                call_events[str(call_id)] = record
        elif kind in ("function_call_output", "custom_tool_call_output"):
            call_id = payload.get("call_id") or payload.get("id")
            output = clean_text(payload.get("output"), MAX_TOOL_TEXT)
            record = call_events.get(str(call_id)) if call_id else None
            if record is not None:
                record["output"] = output
                record["status"] = "completed"
            else:
                add_event(
                    "tool",
                    "工具输出",
                    "",
                    timestamp,
                    output=output,
                    status="completed",
                )

tool_positions = [
    index for index, event in enumerate(events)
    if event["kind"] in ("command", "tool")
]
omitted_tool_events = max(0, len(tool_positions) - MAX_TOOL_EVENTS)
if omitted_tool_events:
    keep_tool_positions = set(tool_positions[-MAX_TOOL_EVENTS:])
    events = [
        event for index, event in enumerate(events)
        if event["kind"] not in ("command", "tool") or index in keep_tool_positions
    ]

dialogue_positions = [
    index for index, event in enumerate(events)
    if event["category"] == "dialogue"
]
if dialogue_positions:
    selected_positions = dialogue_positions[-page_limit:]
    first_source = events[selected_positions[0]]["_sourceByte"]
    if dialogue_only:
        page_events = [
            event for event in events
            if event["category"] == "dialogue"
            and event["_sourceByte"] >= first_source
        ]
    else:
        page_events = [
            event for event in events if event["_sourceByte"] >= first_source
        ]
elif events and not dialogue_only:
    page_start = max(0, len(events) - page_limit)
    first_source = events[page_start]["_sourceByte"]
    page_events = [event for event in events if event["_sourceByte"] >= first_source]
else:
    first_source = scan_start
    page_events = []
has_more = scan_start > 0 or any(
    event["_sourceByte"] < first_source
    and (not dialogue_only or event["category"] == "dialogue")
    for event in events
)
next_before = first_source if has_more and page_events else None

counts = {}
for event in page_events:
    counts[event["kind"]] = counts.get(event["kind"], 0) + 1
    event.pop("_sourceByte", None)

print(json.dumps({
    "path": path,
    "totalLines": line_count,
    "totalBytes": file_size,
    "scannedBytes": scan_end - scan_start,
    "events": page_events,
    "counts": counts,
    "toolEventCount": sum(
        1 for event in page_events if event["kind"] in ("command", "tool")
    ),
    "omittedToolEvents": omitted_tool_events,
    "hiddenReasoningCount": hidden_reasoning_count,
    "pageSize": page_limit,
    "hasMore": has_more,
    "nextBefore": next_before,
}, ensure_ascii=False, separators=(",", ":")))
`;
