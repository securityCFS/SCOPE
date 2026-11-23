/** Remote probe, kept independent of HTTP and local mutable state. */
export const REMOTE_PROBE = String.raw`
set +e
printf 'META\t'
hostname

ps -eo pid=,etimes=,stat=,tty=,comm= 2>/dev/null | awk '$5 ~ /^(codex|node)$/ {print}' | while read pid etimes stat tty comm; do
  if [ "$comm" = "node" ]; then
    cmdline=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
    case "$cmdline" in
      *"/codex "*|*"/codex --"*) ;;
      *) continue ;;
    esac
  fi
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
  printf 'PROC\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$etimes" "$stat" "$tty" "$comm" "$cwd"
done

nvidia-smi --query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | while IFS= read -r gpu; do
  printf 'GPU\t%s\n' "$gpu"
done

python3 - <<'PY' 2>/dev/null
import ast
import base64
import glob
import json
import os
import re
import subprocess
import time

try:
    encoded_fingerprints = os.environ.get("SCOPE_SESSION_FINGERPRINTS_B64", "")
    encoded_fingerprints += "=" * (-len(encoded_fingerprints) % 4)
    cached_fingerprints = json.loads(
        base64.urlsafe_b64decode(encoded_fingerprints).decode("utf-8")
    ) if encoded_fingerprints else {}
    if not isinstance(cached_fingerprints, dict):
        cached_fingerprints = {}
except Exception:
    cached_fingerprints = {}

def text_from_content(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for item in content:
        if not isinstance(item, dict):
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

def clean(value, limit=260):
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
    encoded = stripped[len(marker):].strip()
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
    return value.startswith(
        (
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
        )
    )

training_command_pattern = re.compile(
    r"(?i)(?:\btorchrun\b|\bdeepspeed\b|\baccelerate\s+launch\b|"
    r"(?:^|[\s/_.-])(?:train|eval|evaluate|rollout|benchmark|inference)"
    r"(?:[\s/_.-]|$)|\blibero\b|\beval_suite\b)"
)

def command_values(value):
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            parsed = None
        if parsed is not None and parsed != value:
            return command_values(parsed)
        commands = []
        for match in re.finditer(
            r'(?:"(?:cmd|command)"|(?<![\w])(?:cmd|command))\s*:\s*'
            r'("(?:\\.|[^"\\])*")',
            value,
        ):
            try:
                commands.append(json.loads(match.group(1)))
            except Exception:
                pass
        return commands or [value]
    if isinstance(value, dict):
        commands = []
        for key in ("cmd", "command"):
            candidate = value.get(key)
            if isinstance(candidate, str):
                commands.append(candidate)
        for key, nested in value.items():
            if key not in ("cmd", "command"):
                commands.extend(command_values(nested))
        return commands
    if isinstance(value, list):
        commands = []
        for nested in value:
            commands.extend(command_values(nested))
        return commands
    return []

all_paths = glob.glob(
    os.path.join(os.environ.get("CODEX_HOME", os.path.expanduser("~/.codex")), "sessions", "**", "*.jsonl"), recursive=True
)
all_paths = list(dict.fromkeys(os.path.realpath(filename) for filename in all_paths))
all_paths.sort(key=lambda item: os.path.getmtime(item), reverse=True)

active_paths = set()
for proc_name in os.listdir("/proc"):
    if not proc_name.isdigit():
        continue
    proc_root = os.path.join("/proc", proc_name)
    try:
        with open(os.path.join(proc_root, "comm"), "r") as handle:
            command = handle.read().strip()
        with open(os.path.join(proc_root, "cmdline"), "rb") as handle:
            cmdline = handle.read().replace(b"\x00", b" ").decode(
                "utf-8", errors="replace"
            ).strip()
    except Exception:
        continue
    if command != "codex" and not (
        command == "node" and re.search(r"(?:^|\s)(?:\S*/)?codex(?:\s|$)", cmdline)
    ):
        continue

    session_paths = []
    try:
        for fd in os.listdir(os.path.join(proc_root, "fd")):
            try:
                target = os.readlink(os.path.join(proc_root, "fd", fd))
            except Exception:
                continue
            # /proc exposes the real path, which need not contain '.codex':
            # CODEX_HOME, symlinked homes and account profiles all relocate it.
            target = os.path.realpath(target)
            if "/sessions/" in target and os.path.basename(target).startswith("rollout-") and target.endswith(".jsonl"):
                session_paths.append(target)
                active_paths.add(target)
    except Exception:
        pass

    process_record = {
        "pid": int(proc_name),
        "cmdline": cmdline,
        "sessionPaths": sorted(set(session_paths)),
    }
    encoded_process = base64.urlsafe_b64encode(
        json.dumps(process_record, ensure_ascii=False).encode("utf-8")
    ).decode("ascii")
    print("PROCESS_META\t" + encoded_process)

gpu_processes = {}
try:
    uuid_rows = subprocess.check_output(
        [
            "nvidia-smi",
            "--query-gpu=index,uuid",
            "--format=csv,noheader,nounits",
        ],
        stderr=subprocess.DEVNULL,
        text=True,
    ).splitlines()
    gpu_indices = {}
    for row in uuid_rows:
        fields = [field.strip() for field in row.split(",", 1)]
        if len(fields) == 2:
            gpu_indices[fields[1]] = int(fields[0])
    process_rows = subprocess.check_output(
        [
            "nvidia-smi",
            "--query-compute-apps=pid,gpu_uuid,used_gpu_memory",
            "--format=csv,noheader,nounits",
        ],
        stderr=subprocess.DEVNULL,
        text=True,
    ).splitlines()
    for row in process_rows:
        fields = [field.strip() for field in row.split(",", 2)]
        if len(fields) != 3 or not fields[0].isdigit():
            continue
        gpu_processes.setdefault(int(fields[0]), []).append({
            "index": gpu_indices.get(fields[1]),
            "memoryMiB": int(fields[2]) if fields[2].isdigit() else 0,
        })
except Exception:
    pass

process_table = {}
try:
    rows = subprocess.check_output(
        [
            "ps",
            "-eo",
            "pid=,ppid=,pgid=,sid=,etimes=,tty=,stat=,args=",
        ],
        stderr=subprocess.DEVNULL,
        text=True,
    ).splitlines()
except Exception:
    rows = []

for row in rows:
    fields = row.strip().split(None, 7)
    if len(fields) < 8:
        continue
    try:
        pid, ppid, pgid, sid, elapsed = map(int, fields[:5])
    except Exception:
        continue
    try:
        cwd = os.readlink(f"/proc/{pid}/cwd")
    except Exception:
        cwd = ""
    try:
        with open(f"/proc/{pid}/comm", "r") as handle:
            command = handle.read().strip()
    except Exception:
        command = os.path.basename(fields[7].split(None, 1)[0])
    process_table[pid] = {
        "pid": pid,
        "ppid": ppid,
        "pgid": pgid,
        "sid": sid,
        "elapsedSeconds": elapsed,
        "tty": fields[5].replace("/dev/", ""),
        "stat": fields[6],
        "command": command,
        "cmdline": fields[7],
        "cwd": cwd,
        "gpus": gpu_processes.get(pid, []),
    }

workload_candidates = {}
for pid, process in process_table.items():
    command = process["command"].lower()
    cmdline = process["cmdline"]
    if command in ("codex", "ssh", "sshd", "tmux: server", "tmux"):
        continue
    if "monitor_" in cmdline and not process["gpus"]:
        continue
    if process["gpus"] or training_command_pattern.search(cmdline):
        workload_candidates[pid] = process

workload_groups = {}
for process in workload_candidates.values():
    group_id = process["sid"] if process["sid"] > 1 else process["pgid"]
    if group_id <= 1:
        group_id = process["pid"]
    workload_groups.setdefault(group_id, []).append(process)

for group_id, members in workload_groups.items():
    member_ids = {member["pid"] for member in members}
    roots = [member for member in members if member["ppid"] not in member_ids]
    root = sorted(
        roots or members,
        key=lambda item: (-item["elapsedSeconds"], item["pid"]),
    )[0]
    ancestor_pids = []
    cursor = root["ppid"]
    seen = set()
    while cursor > 1 and cursor not in seen and len(ancestor_pids) < 40:
        seen.add(cursor)
        ancestor_pids.append(cursor)
        parent = process_table.get(cursor)
        if not parent:
            break
        cursor = parent["ppid"]
    gpu_entries = []
    for member in members:
        for gpu in member["gpus"]:
            gpu_entries.append({
                **gpu,
                "pid": member["pid"],
            })
    record = {
        **root,
        "groupId": group_id,
        "workerPids": sorted(member_ids),
        "ancestorPids": ancestor_pids,
        "gpus": gpu_entries,
        "gpuMemoryMiB": sum(gpu["memoryMiB"] for gpu in gpu_entries),
        "kind": (
            "evaluation"
            if re.search(r"(?i)(?:eval|evaluate|benchmark|rollout|libero|eval_suite)", root["cmdline"])
            else "training"
        ),
    }
    encoded_workload = base64.urlsafe_b64encode(
        json.dumps(record, ensure_ascii=False).encode("utf-8")
    ).decode("ascii")
    print("WORKLOAD\t" + encoded_workload)

paths = list(dict.fromkeys(all_paths[:10] + list(active_paths)))
paths.sort(key=lambda item: os.path.getmtime(item), reverse=True)

try:
    panes = subprocess.check_output(
        [
            "tmux",
            "list-panes",
            "-a",
            "-F",
            "#{session_name}\t#{window_index}.#{pane_index}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_tty}\t#{pane_pid}\t#{session_activity}\t#{pane_dead}\t#{pane_dead_status}",
        ],
        stderr=subprocess.DEVNULL,
        text=True,
    ).splitlines()
    for line in panes:
        fields = line.split("\t")
        if len(fields) != 9:
            continue
        target = f"{fields[0]}:{fields[1]}"
        try:
            preview = subprocess.check_output(
                ["tmux", "capture-pane", "-p", "-S", "-24", "-t", target],
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            preview = b""
        encoded_preview = base64.b64encode(preview).decode("ascii")
        print("PANE\t" + "\t".join(fields) + "\t" + encoded_preview)
except Exception:
    pass

def bounded_session_lines(filename, active):
    head_bytes = 2 * 1024 * 1024
    tail_bytes = (8 if active else 2) * 1024 * 1024
    tail_lines = 5000 if active else 500
    with open(filename, "rb") as handle:
        first = handle.readline(1024 * 1024).decode("utf-8", errors="replace")
        head_blob = handle.read(head_bytes)
        size = os.fstat(handle.fileno()).st_size
        handle.seek(max(0, size - tail_bytes))
        tail_blob = handle.read(tail_bytes)
    head = head_blob.decode("utf-8", errors="replace").splitlines(keepends=True)[:400]
    tail = tail_blob.decode("utf-8", errors="replace").splitlines(keepends=True)
    if size > tail_bytes and tail:
        # The first entry begins in the middle of a JSONL record.
        tail = tail[1:]
    return first, head, tail[-tail_lines:]

for filename in paths:
    try:
        stat = os.stat(filename)
        mtime_ms = int(stat.st_mtime * 1000)
        size_bytes = int(stat.st_size)
        cached = cached_fingerprints.get(filename)
        if (
            isinstance(cached, list)
            and len(cached) == 2
            and cached[0] == mtime_ms
            and cached[1] == size_bytes
        ):
            encoded_path = base64.urlsafe_b64encode(
                filename.encode("utf-8")
            ).decode("ascii")
            print("SESSION_REF\t" + encoded_path)
            continue
        first, head, tail = bounded_session_lines(
            filename, filename in active_paths
        )
        first_obj = json.loads(first)
        meta = first_obj.get("payload", {}) if first_obj.get("type") == "session_meta" else {}
    except Exception:
        continue

    source = meta.get("source")
    subagent = source.get("subagent", {}) if isinstance(source, dict) else {}
    spawn = subagent.get("thread_spawn", {}) if isinstance(subagent, dict) else {}
    record = {
        "id": meta.get("id") or meta.get("session_id") or os.path.basename(filename),
        "rootSessionId": meta.get("session_id") or meta.get("id") or "",
        "parentThreadId": meta.get("parent_thread_id")
        or spawn.get("parent_thread_id")
        or "",
        "agentPath": spawn.get("agent_path") or "",
        "agentNickname": spawn.get("agent_nickname") or "",
        "isSubagent": bool(spawn or meta.get("parent_thread_id")),
        "cwd": meta.get("cwd") or "",
        "startedAt": meta.get("timestamp") or first_obj.get("timestamp"),
        "cliVersion": meta.get("cli_version") or "",
        "path": filename,
        "mtimeMs": mtime_ms,
        "sizeBytes": size_bytes,
        "firstUser": "",
        "lastUser": "",
        "lastAssistant": "",
        "lastAction": "",
        "lastError": "",
        "launches": [],
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
        "lastEventAt": first_obj.get("timestamp"),
    }

    seen_lines = set()
    for raw in head + tail:
        if raw in seen_lines:
            continue
        seen_lines.add(raw)
        try:
            event = json.loads(raw)
        except Exception:
            continue
        payload = event.get("payload", {})
        event_type = event.get("type")
        record["lastEventAt"] = event.get("timestamp") or record["lastEventAt"]

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
            if kind == "task_started":
                record["turnState"] = "working"
            elif kind in ("task_complete", "turn_complete", "task_completed"):
                record["turnState"] = "idle"
                candidate = clean(payload.get("last_agent_message"), 1600)
                if candidate:
                    record["lastAssistant"] = candidate
                    record["assistantMessages"].append(candidate)
                    record["assistantMessages"] = record["assistantMessages"][-6:]
            elif kind == "agent_message":
                candidate = clean(
                    payload.get("message") or payload.get("text"),
                    1600,
                )
                if candidate:
                    record["lastAssistant"] = candidate
                    record["assistantMessages"].append(candidate)
                    record["assistantMessages"] = record["assistantMessages"][-6:]
            elif kind in ("user_message", "user_input"):
                raw_candidate = (
                    payload.get("message") or payload.get("text") or payload.get("content")
                )
                notification = parse_subagent_notification(raw_candidate)
                if notification:
                    candidate = clean(notification["text"], 1600)
                    if candidate:
                        record["lastAssistant"] = candidate
                        record["assistantMessages"].append(candidate)
                        record["assistantMessages"] = record["assistantMessages"][-6:]
                else:
                    candidate = clean(raw_candidate, 1200)
                    if candidate and not is_context_message(candidate):
                        record["firstUser"] = record["firstUser"] or candidate
                        record["lastUser"] = clean(candidate)
                        record["userMessages"].append(candidate)
                        record["userMessages"] = record["userMessages"][-8:]
            elif kind == "token_count":
                info = payload.get("info")
                if isinstance(info, dict):
                    record["tokenUsage"] = {
                        "modelContextWindow": info.get("model_context_window"),
                        "total": info.get("total_token_usage"),
                        "last": info.get("last_token_usage"),
                    }
                rate_limits = payload.get("rate_limits")
                if isinstance(rate_limits, dict):
                    primary = rate_limits.get("primary")
                    secondary = rate_limits.get("secondary")
                    credits = rate_limits.get("credits")
                    record["account"] = {
                        "planType": rate_limits.get("plan_type") or "",
                        "primary": primary if isinstance(primary, dict) else None,
                        "secondary": secondary if isinstance(secondary, dict) else None,
                        "credits": credits if isinstance(credits, dict) else None,
                    }

        if event_type != "response_item":
            continue

        kind = payload.get("type")
        role = payload.get("role")
        if kind == "message" and role == "user":
            raw_candidate = text_from_content(payload.get("content"))
            notification = parse_subagent_notification(raw_candidate)
            if notification:
                candidate = clean(notification["text"], 1600)
                if candidate:
                    record["lastAssistant"] = candidate
                    record["assistantMessages"].append(candidate)
                    record["assistantMessages"] = record["assistantMessages"][-6:]
            else:
                candidate = clean(raw_candidate)
                is_context = is_context_message(candidate)
                if candidate and not is_context:
                    record["firstUser"] = record["firstUser"] or candidate
                    record["lastUser"] = candidate
                    record["userMessages"].append(clean(candidate, 1200))
                    record["userMessages"] = record["userMessages"][-8:]
        elif kind == "message" and role == "assistant":
            candidate = clean(text_from_content(payload.get("content")), 1600)
            if candidate:
                record["lastAssistant"] = candidate
                record["assistantMessages"].append(candidate)
                record["assistantMessages"] = record["assistantMessages"][-6:]
        elif kind in ("function_call", "custom_tool_call"):
            name = payload.get("name") or "tool"
            arguments = payload.get("arguments") or payload.get("input") or ""
            record["lastAction"] = clean(f"{name}: {arguments}", 300)
            record["turnState"] = "working"
            for command in command_values(arguments):
                if (
                    training_command_pattern.search(command)
                    or re.search(r"(?i)\btmux\s+(?:new-session|new)\b", command)
                ):
                    record["launches"].append({
                        "timestamp": event.get("timestamp"),
                        "command": clean(command, 2400),
                    })
                    record["launches"] = record["launches"][-80:]
        elif kind in ("function_call_output", "custom_tool_call_output"):
            output = clean(tool_output_text(payload.get("output")), 300)
            if (
                "exit code 1" in output.lower()
                or "process exited with code 1" in output.lower()
                or "traceback" in output.lower()
            ):
                record["lastError"] = output

    encoded = base64.urlsafe_b64encode(
        json.dumps(record, ensure_ascii=False).encode("utf-8")
    ).decode("ascii")
    print("SESSION\t" + encoded)
PY
`;
