/** Remote probe, kept independent of HTTP and local mutable state. */
export const SUBMISSION_PROBE = String.raw`
import ast
import concurrent.futures
import glob
import json
import os
import re
import shlex
import subprocess
import sys
import time

display_limit = max(20, min(500, int(sys.argv[1]) if len(sys.argv) > 1 else 200))
window_days = max(0, min(3650, int(sys.argv[2]) if len(sys.argv) > 2 else 1))
summary_mode = len(sys.argv) > 3 and sys.argv[3] == "summary"
all_paths = glob.glob(os.path.expanduser("~/.codex/sessions/**/*.jsonl"), recursive=True)
cutoff = time.time() - window_days * 86400 if window_days else 0
paths = [
    item for item in all_paths
    if not cutoff or os.path.getmtime(item) >= cutoff
]
paths.sort(key=lambda item: os.path.getmtime(item), reverse=True)
submit_pattern = re.compile(
    r"SUBMITTED\s+job=(?P<name>[^\s]+)\s+job_id=(?P<job>[A-Za-z0-9._:-]+)"
)
submitted_arrow_pattern = re.compile(
    r"(?im)^\s*\[(?:submitted|submit)\]\s+(?P<name>.+?)\s+->\s+"
    r"(?P<job>dlc[A-Za-z0-9]+)\s*$"
)
submit_table_pattern = re.compile(
    r"(?im)^\|\s*JobId\s*\|\s*RequestId\s*\|\s*$\n"
    r"(?:^\+[-+]+\+\s*$\n)?^\|\s*(?P<job>dlc[A-Za-z0-9]+)\s*\|"
)
submitting_pattern = re.compile(r"SUBMITTING\s+job=(?P<name>[^\s]+)")
named_job_pattern = re.compile(
    r"(?i)['\"]?(?:job[_\s-]*id|jobid|dlc\s+job)['\"]?\s*[:=]\s*['\"]?"
    r"(?P<job>dlc[A-Za-z0-9]+)"
)
programmatic_submit_patterns = (
    re.compile(
        r"(?is)[\[(]\s*(?:[A-Za-z0-9_]*dlc[A-Za-z0-9_]*|"
        r"['\"][^'\"]*(?:/|^)dlc['\"])\s*,\s*['\"]submit['\"]"
    ),
    re.compile(
        r"(?is)(?:subprocess\.(?:run|Popen|call|check_call|check_output)|"
        r"os\.system)\s*\(\s*[furb]*['\"](?:[^'\"]*/)?dlc\s+submit\b"
    ),
)
training_pattern = re.compile(
    r"(?i)(?:\bsbatch\b|\bsrun\b|"
    r"\btorchrun\b|(?:python\S*\s+|bash\s+)\S*(?:train|launch|submit)\S*)"
)
context_prefixes = (
    "<environment_context>",
    "<permissions",
    "<collaboration_mode>",
    "<apps_instructions>",
    "<plugins_instructions>",
    "<skills_instructions>",
    "<recommended_plugins>",
    "<in-app-browser-context",
    "# AGENTS.md instructions",
)
submissions = {}
launches = []
calls = []
calls_by_rpc = {}
synthetic_job_ids = set()

def readable(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                for key in ("text", "content", "output"):
                    if isinstance(item.get(key), str):
                        parts.append(item[key])
                        break
        return "\n".join(parts)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value or "")

def parse_tool_value(value):
    current = value
    for _ in range(2):
        if not isinstance(current, str):
            break
        try:
            current = json.loads(current)
        except Exception:
            break
    return current

def walk_commands(value, results, inherited_cwd=""):
    value = parse_tool_value(value)
    if isinstance(value, dict):
        cwd = value.get("workdir") if isinstance(value.get("workdir"), str) else inherited_cwd
        for key in ("cmd", "command"):
            if isinstance(value.get(key), str):
                results.append((value[key], cwd))
        for key, nested in value.items():
            if key not in ("cmd", "command", "workdir"):
                walk_commands(nested, results, cwd)
    elif isinstance(value, list):
        for nested in value:
            walk_commands(nested, results, inherited_cwd)

def quoted_js_value(raw, start):
    backtick = chr(96)
    if start >= len(raw) or raw[start] not in "\"'" + backtick:
        return None, start
    quote = raw[start]
    if quote == '"':
        try:
            value, consumed = json.JSONDecoder().raw_decode(raw[start:])
            return value, start + consumed
        except Exception:
            return None, start
    index = start + 1
    escaped = False
    while index < len(raw):
        char = raw[index]
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == quote:
            literal = raw[start:index + 1]
            if quote == "'":
                try:
                    return ast.literal_eval(literal), index + 1
                except Exception:
                    return None, index + 1
            body = literal[1:-1]
            body = body.replace("\\" + backtick, backtick).replace("\\\\", "\\")
            return body, index + 1
        index += 1
    return None, start

def tool_commands(payload):
    raw_value = payload.get("input")
    if raw_value is None:
        raw_value = payload.get("arguments")
    results = []
    walk_commands(raw_value, results)
    name = str(payload.get("name") or "")
    raw = readable(raw_value)
    if name in ("exec", "shell", "bash", "terminal") and not results:
        for match in re.finditer(r"(?:\"cmd\"|(?<![\w])cmd)\s*:\s*", raw):
            value, _ = quoted_js_value(raw, match.end())
            if isinstance(value, str):
                results.append((value, ""))
    if name in ("shell", "bash", "terminal") and not results and isinstance(raw_value, str):
        results.append((raw_value, ""))
    unique = []
    seen = set()
    for command, workdir in results:
        key = (command, workdir)
        if command and key not in seen:
            seen.add(key)
            unique.append(key)
    return unique

def shell_tokens(command):
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|")
        lexer.whitespace_split = True
        lexer.commenters = ""
        return list(lexer)
    except Exception:
        return command.split()

def command_name(token):
    token = str(token or "").strip()
    if "$(" in token:
        token = token.rsplit("$(", 1)[-1]
    token = token.strip("(){}[]'\"")
    token = token.rstrip(";,")
    return os.path.basename(token)

def shell_submit_counts(command, depth=0):
    if depth > 2:
        return 0, 0
    tokens = shell_tokens(command)
    direct = 0
    scripts = 0
    for index, token in enumerate(tokens):
        name = command_name(token)
        next_name = command_name(tokens[index + 1]) if index + 1 < len(tokens) else ""
        if name == "dlc" and next_name == "submit":
            direct += 1
        if name in ("bash", "sh", "zsh") or re.fullmatch(r"python(?:\d+(?:\.\d+)*)?", name):
            cursor = index + 1
            nested_shell = False
            no_execute = False
            while cursor < len(tokens) and str(tokens[cursor]).startswith("-"):
                option = str(tokens[cursor])
                cursor += 1
                if name in ("bash", "sh", "zsh") and (
                    option == "--noexec"
                    or (
                        option.startswith("-")
                        and not option.startswith("--")
                        and "n" in option[1:]
                    )
                ):
                    no_execute = True
                if "c" in option and cursor < len(tokens):
                    if not no_execute:
                        nested_direct, nested_scripts = shell_submit_counts(
                            str(tokens[cursor]), depth + 1
                        )
                        direct += nested_direct
                        scripts += nested_scripts
                    nested_shell = True
                    break
            if nested_shell or no_execute:
                continue
            if cursor < len(tokens):
                candidate = command_name(tokens[cursor]).lower()
                if (
                    ("submit" in candidate or "submission" in candidate)
                    and candidate.endswith((".sh", ".py"))
                ):
                    scripts += 1
    return direct, scripts

def classify_dlc_command(command):
    direct_count, script_count = shell_submit_counts(command)
    programmatic_count = sum(
        len(list(pattern.finditer(command)))
        for pattern in programmatic_submit_patterns
    )
    if direct_count:
        kind = "direct-shell"
        count = direct_count
    elif programmatic_count:
        kind = "programmatic"
        count = programmatic_count
    elif script_count:
        kind = "submit-script"
        count = script_count
    else:
        return None
    inspection = bool(
        (
            direct_count
            and re.search(r"(?i)\bdlc\s+submit\b[^\n;&|]*--help\b", command)
        )
        or (
            script_count
            and re.search(
                r"(?i)\b[^\s;&|]*(?:submit|submission)[^\s;&|]*\.(?:sh|py)\b"
                r"[^\n;&|]*--help\b",
                command,
            )
        )
    )
    dry_run = bool(re.search(
        r"(?i)(?:--dry-run\b|--mode[=\s]+(?:plan|dry-run)\b|"
        r"\bDRY_RUN=1\b|\bSUBMIT=0\b|"
        r"\bDLC=[^\s;&|]*(?:fake|mock|capture|stub)[^\s;&|]*)",
        command,
    ))
    explicit_submit = bool(
        kind != "submit-script"
        or re.search(
            r"(?i)(?:--submit\b|--mode[=\s]+submit\b|"
            r"\bSUBMIT=1\b|\bDRY_RUN=0\b)",
            command,
        )
    )
    return kind, max(1, count), inspection, dry_run, explicit_submit

def exit_code_from(output):
    patterns = (
        r"(?i)process exited with code\s+(-?\d+)",
        r"(?i)exit[_ ]code[\"']?\s*[:=]\s*(-?\d+)",
        r"(?i)script failed with code\s+(-?\d+)",
    )
    for pattern in patterns:
        match = re.search(pattern, output)
        if match:
            return int(match.group(1))
    if "Script completed" in output or "Process exited with code 0" in output:
        return 0
    return None

def plausible_job_id(value):
    return bool(
        re.fullmatch(r"(?i)dlc[A-Za-z0-9]{8,}", str(value or ""))
        and not re.search(r"(?i)(?:fake|mock|stub|capture)", str(value))
    )

for filename in paths:
    try:
        with open(filename, "r", encoding="utf-8", errors="replace") as handle:
            first = json.loads(handle.readline())
            meta = (
                first.get("payload", {})
                if first.get("type") == "session_meta"
                else {}
            )
            source = meta.get("source")
            subagent = source.get("subagent", {}) if isinstance(source, dict) else {}
            session_id = meta.get("id") or meta.get("session_id") or ""
            cwd = meta.get("cwd") or ""
            parent_thread_id = meta.get("parent_thread_id") or ""
            is_subagent = bool(subagent or parent_thread_id)
            first_user = ""
            for line_number, raw in enumerate(handle, 2):
                try:
                    event = json.loads(raw)
                except Exception:
                    continue
                payload = event.get("payload", {})
                if not isinstance(payload, dict):
                    continue
                event_type = event.get("type")
                kind = payload.get("type")
                timestamp = event.get("timestamp")
                if not first_user and event_type == "response_item":
                    if kind == "message" and payload.get("role") == "user":
                        candidate = readable(payload.get("content")).strip()
                        if candidate and not candidate.startswith(context_prefixes):
                            first_user = " ".join(candidate.split())[:240]
                if event_type != "response_item":
                    continue
                if kind in ("function_call_output", "custom_tool_call_output"):
                    output = readable(payload.get("output"))
                    rpc_id = payload.get("call_id") or payload.get("id") or ""
                    matching_calls = calls_by_rpc.get((filename, rpc_id), [])
                    submitted_matches = list(submit_pattern.finditer(output))
                    arrow_matches = list(submitted_arrow_pattern.finditer(output))
                    table_matches = list(submit_table_pattern.finditer(output))
                    strong_submission_pairs = [
                        (match.group("name"), match.group("job"), match.group(0))
                        for match in submitted_matches
                    ] + [
                        (match.group("name").strip(), match.group("job"), match.group(0))
                        for match in arrow_matches
                    ] + [
                        (match.group("job"), match.group("job"), match.group(0))
                        for match in table_matches
                    ]
                    unique_submission_pairs = {}
                    for pair in strong_submission_pairs:
                        if plausible_job_id(pair[1]):
                            unique_submission_pairs.setdefault(pair[1], pair)
                    strong_submission_pairs = list(unique_submission_pairs.values())
                    submitting_names = [
                        match.group("name")
                        for match in submitting_pattern.finditer(output)
                    ]
                    explicit_job_ids = list(dict.fromkeys(
                        pair[1] for pair in strong_submission_pairs
                    ))
                    named_id_calls = [
                        call for call in matching_calls
                        if call["invocationKind"] in ("direct-shell", "programmatic")
                        and call["syntacticInvocations"] == 1
                        and not re.search(
                            r"(?i)\bdlc\s+(?:get|list|stop)\b",
                            call["command"],
                        )
                    ]
                    if named_id_calls and not explicit_job_ids:
                        explicit_job_ids = list(dict.fromkeys(
                            match.group("job")
                            for match in named_job_pattern.finditer(output)
                        ))
                    submission_pairs = list(strong_submission_pairs)
                    if not submission_pairs:
                        for index, job_id in enumerate(explicit_job_ids):
                            name = (
                                submitting_names[index]
                                if index < len(submitting_names)
                                else job_id
                            )
                            submission_pairs.append((name, job_id, job_id))
                    exit_code = exit_code_from(output)
                    for call in matching_calls:
                        call["resultLine"] = line_number
                        call["exitCode"] = exit_code
                        call["jobNames"] = list(dict.fromkeys(
                            call["jobNames"]
                            + submitting_names
                            + [pair[0] for pair in strong_submission_pairs]
                        ))
                        call["jobIds"] = list(dict.fromkeys(
                            call["jobIds"] + explicit_job_ids
                        ))
                        call["observedInvocations"] = max(
                            call["syntacticInvocations"],
                            len(submitting_names),
                            len(strong_submission_pairs),
                            len(explicit_job_ids),
                        )
                        if call["inspection"]:
                            call["outcome"] = "inspection"
                        elif call["dryRun"]:
                            call["outcome"] = "dry-run"
                        elif call["jobIds"]:
                            call["outcome"] = "submitted"
                        elif exit_code not in (None, 0):
                            call["outcome"] = "failed"
                        elif submitting_names:
                            call["outcome"] = "unresolved"
                        else:
                            call["outcome"] = "unknown"
                        call["resultEvidence"] = " ".join(output.split())[:1200]
                    ownership_pairs = (
                        submission_pairs
                        if not matching_calls
                        or any(
                            not call["inspection"] and not call["dryRun"]
                            for call in matching_calls
                        )
                        else []
                    )
                    if ownership_pairs and not matching_calls:
                        synthetic_ids = [
                            job_id for _, job_id, _ in ownership_pairs
                            if job_id not in synthetic_job_ids
                        ]
                        synthetic_job_ids.update(synthetic_ids)
                    else:
                        synthetic_ids = []
                    if synthetic_ids:
                        synthetic = {
                            "id": f"{session_id}:{rpc_id or 'output'}:output-{line_number}",
                            "timestamp": timestamp,
                            "sessionId": session_id,
                            "cwd": cwd,
                            "rolloutPath": filename,
                            "line": line_number,
                            "sessionObjective": first_user,
                            "toolName": "output-only",
                            "callId": rpc_id,
                            "invocationKind": "output-only",
                            "syntacticInvocations": 0,
                            "observedInvocations": len(synthetic_ids),
                            "inspection": False,
                            "dryRun": False,
                            "explicitSubmit": True,
                            "outcome": "submitted",
                            "exitCode": exit_code,
                            "jobIds": synthetic_ids,
                            "jobNames": list(dict.fromkeys(
                                submitting_names
                                + [pair[0] for pair in strong_submission_pairs]
                            )),
                            "resultLine": line_number,
                            "resultEvidence": " ".join(output.split())[:1200],
                            "command": "",
                            "isSubagent": is_subagent,
                            "parentThreadId": parent_thread_id,
                        }
                        calls.append(synthetic)
                    for job_name, job_id, job_evidence in ownership_pairs:
                        candidate = {
                            "jobId": job_id,
                            "name": job_name,
                            "submittedAt": timestamp,
                            "sessionId": session_id,
                            "cwd": cwd,
                            "rolloutPath": filename,
                            "line": line_number,
                            "sessionObjective": first_user,
                            "evidence": " ".join(job_evidence.split())[:500],
                            "callId": rpc_id,
                            "command": matching_calls[0]["command"] if matching_calls else "",
                            "commandLine": matching_calls[0]["line"] if matching_calls else None,
                            "exitCode": exit_code,
                            "invocationKind": (
                                matching_calls[0]["invocationKind"]
                                if matching_calls else "output-only"
                            ),
                            "isSubagent": is_subagent,
                            "parentThreadId": parent_thread_id,
                            "ownershipSource": (
                                "tool-call" if matching_calls else "output-only"
                            ),
                            "ownershipRank": 3 if matching_calls else 2,
                        }
                        existing = submissions.get(job_id)
                        replace = not existing
                        if existing:
                            candidate_rank = candidate["ownershipRank"]
                            existing_rank = existing.get("ownershipRank", 0)
                            if candidate_rank > existing_rank:
                                replace = True
                            elif candidate_rank == existing_rank:
                                candidate_time = candidate.get("submittedAt") or ""
                                existing_time = existing.get("submittedAt") or ""
                                replace = bool(
                                    candidate_time
                                    and (not existing_time or candidate_time < existing_time)
                                )
                        if replace:
                            submissions[job_id] = candidate
                elif kind in ("function_call", "custom_tool_call"):
                    rpc_id = (
                        payload.get("call_id")
                        or payload.get("id")
                        or f"line-{line_number}"
                    )
                    for command_index, (command, command_cwd) in enumerate(
                        tool_commands(payload)
                    ):
                        classification = classify_dlc_command(command)
                        if classification:
                            (
                                invocation_kind,
                                syntactic_count,
                                inspection,
                                dry_run,
                                explicit_submit,
                            ) = classification
                            record = {
                                "id": f"{session_id}:{rpc_id}:{command_index}",
                                "timestamp": timestamp,
                                "sessionId": session_id,
                                "cwd": command_cwd or cwd,
                                "rolloutPath": filename,
                                "line": line_number,
                                "sessionObjective": first_user,
                                "toolName": payload.get("name") or "",
                                "callId": rpc_id,
                                "invocationKind": invocation_kind,
                                "syntacticInvocations": syntactic_count,
                                "observedInvocations": syntactic_count,
                                "inspection": inspection,
                                "dryRun": dry_run,
                                "explicitSubmit": explicit_submit,
                                "outcome": (
                                    "inspection" if inspection
                                    else "dry-run" if dry_run
                                    else "pending"
                                ),
                                "exitCode": None,
                                "jobIds": [],
                                "jobNames": [],
                                "resultLine": None,
                                "resultEvidence": "",
                                "command": " ".join(command.split())[:4000],
                                "isSubagent": is_subagent,
                                "parentThreadId": parent_thread_id,
                            }
                            calls.append(record)
                            calls_by_rpc.setdefault((filename, rpc_id), []).append(record)
                    raw_input = readable(
                        payload.get("input") or payload.get("arguments")
                    )
                    if training_pattern.search(raw_input):
                        launches.append({
                            "kind": (
                                "dlc"
                                if re.search(r"(?i)\bdlc\b", raw_input)
                                else "scheduler"
                                if re.search(r"(?i)\b(?:sbatch|srun)\b", raw_input)
                                else "training"
                            ),
                            "timestamp": timestamp,
                            "sessionId": session_id,
                            "cwd": cwd,
                            "rolloutPath": filename,
                            "line": line_number,
                            "sessionObjective": first_user,
                            "command": " ".join(raw_input.split())[:1200],
                            "isSubagent": is_subagent,
                            "parentThreadId": parent_thread_id,
                        })
    except Exception:
        continue

dlc = "/etc/dsw/runtime/export_bin/dlc"
def status_for(item):
    job_id, record = item
    status = {
        "status": "Unknown",
        "reason": "",
        "message": "",
        "duration": None,
    }
    if not os.path.isfile(dlc) or not re.fullmatch(r"dlc[A-Za-z0-9]+", job_id):
        return job_id, status
    try:
        completed = subprocess.run(
            [dlc, "get", "job", job_id],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=18,
        )
        if completed.returncode == 0:
            payload = json.loads(completed.stdout)
            status = {
                "status": payload.get("Status") or "Unknown",
                "reason": payload.get("ReasonCode") or "",
                "message": payload.get("ReasonMessage") or "",
                "duration": payload.get("Duration"),
            }
        else:
            status["message"] = (completed.stderr or completed.stdout).strip()[:500]
    except Exception as error:
        status["message"] = str(error)[:500]
    return job_id, status

direct_job_ids = {
    job_id
    for call in calls
    if call["invocationKind"] != "output-only"
    for job_id in call["jobIds"]
}
calls = [
    call for call in calls
    if call["invocationKind"] != "output-only"
    or any(job_id not in direct_job_ids for job_id in call["jobIds"])
]
for record in submissions.values():
    record.pop("ownershipRank", None)

ordered = sorted(
    submissions.values(),
    key=lambda item: item.get("submittedAt") or "",
    reverse=True,
)
for record in ordered:
    record.update({
        "status": "Unknown",
        "reason": "",
        "message": "",
        "duration": None,
    })
status_items = [
    (record["jobId"], record)
    for record in ordered[:min(display_limit, 120)]
]
if status_items:
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(status_items))) as pool:
        for job_id, status in pool.map(status_for, status_items):
            submissions[job_id].update(status)

ordered = sorted(
    submissions.values(),
    key=lambda item: item.get("submittedAt") or "",
    reverse=True,
)[:500]
calls.sort(key=lambda item: item.get("timestamp") or "", reverse=True)
launches.sort(key=lambda item: item.get("timestamp") or "", reverse=True)
result = {
    "filesScanned": len(paths),
    "totalFiles": len(all_paths),
    "scanScope": "all-rollouts" if not window_days else f"recent-{window_days}d",
    "windowDays": window_days,
    "calls": calls,
    "totalCalls": len(calls),
    "submissions": ordered,
    "totalSubmissions": len(submissions),
    "launches": launches[:display_limit],
}
if summary_mode:
    result = {
        "filesScanned": result["filesScanned"],
        "totalCalls": result["totalCalls"],
        "totalSubmissions": result["totalSubmissions"],
        "byKind": {
            kind: sum(1 for call in calls if call["invocationKind"] == kind)
            for kind in (
                "direct-shell", "programmatic", "submit-script", "output-only"
            )
        },
        "byOutcome": {
            outcome: sum(1 for call in calls if call["outcome"] == outcome)
            for outcome in (
                "submitted", "failed", "unresolved", "unknown",
                "inspection", "dry-run"
            )
        },
        "subagentCalls": sum(1 for call in calls if call["isSubagent"]),
        "latest": [
            {
                "timestamp": call["timestamp"],
                "invocationKind": call["invocationKind"],
                "outcome": call["outcome"],
                "jobs": len(call["jobIds"]),
                "isSubagent": call["isSubagent"],
                "command": call["command"][:180],
            }
            for call in calls[:12]
        ],
    }
print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
`;
