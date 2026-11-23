/** Remote probe, kept independent of HTTP and local mutable state. */
export const ASSISTANT_SEARCH_PROBE = String.raw`
import base64
import glob
import json
import os
import re
import subprocess
import sys

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

config = json.loads(base64.urlsafe_b64decode(sys.argv[1] + "==").decode("utf-8"))
question = str(config.get("question") or "").strip()
result_limit = max(3, min(20, int(config.get("limit") or 10)))
max_files = max(50, min(1000, int(config.get("maxFiles") or 600)))

ascii_stops = {
    "a", "an", "and", "are", "can", "codex", "confirm", "did", "do", "does",
    "find", "for", "from", "i", "in", "is", "it", "me", "my", "now", "of",
    "on", "one", "please", "session", "sessions", "that", "the", "this", "to",
    "use", "using", "want", "which", "with",
}
chinese_stops = (
    "我现在想确认", "我想确认", "请帮我", "帮我", "现在", "对应", "使用",
    "哪个", "哪一个", "是什么", "是哪", "这个", "那个", "会话", "任务",
    "去做",
)

lowered_question = question.lower()
ascii_terms = []
for term in re.findall(r"[a-z0-9][a-z0-9_.-]*", lowered_question):
    cleaned = term.strip("._-")
    if not cleaned or cleaned in ascii_stops:
        continue
    if len(cleaned) == 1 and cleaned not in {"x", "y", "z"}:
        continue
    if cleaned not in ascii_terms:
        ascii_terms.append(cleaned)

chinese_query = lowered_question
for stop in chinese_stops:
    chinese_query = chinese_query.replace(stop, " ")
chinese_terms = []
for run in re.findall(r"[\u3400-\u9fff]{2,}", chinese_query):
    candidates = [run]
    if len(run) > 6:
        candidates.extend(run[index:index + 3] for index in range(len(run) - 2))
    for candidate in candidates:
        if candidate not in chinese_terms:
            chinese_terms.append(candidate)

terms = (ascii_terms + chinese_terms)[:24]
if not terms:
    terms = [question.lower()[:80]]

sessions_root = os.path.expanduser("~/.codex/sessions")
all_paths = glob.glob(os.path.join(sessions_root, "**", "*.jsonl"), recursive=True)
all_paths.sort(key=lambda item: os.path.getmtime(item), reverse=True)

matching_paths = []
if all_paths:
    if os.name == "nt":
        matching_paths = all_paths[:max_files]
    else:
        pattern = "|".join(re.escape(term) for term in terms if term)
        try:
            grep = subprocess.run(
                ["grep", "-RIilE", pattern, sessions_root],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=15,
            )
            if grep.returncode in (0, 1):
                matching = {
                    os.path.normcase(os.path.normpath(line))
                    for line in grep.stdout.splitlines()
                    if line.endswith(".jsonl")
                }
                matching_paths = [
                    item
                    for item in all_paths
                    if os.path.normcase(os.path.normpath(item)) in matching
                ][:max_files]
            else:
                matching_paths = all_paths[:max_files]
        except Exception:
            matching_paths = all_paths[:max_files]

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

def clean(value, limit=1200):
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False)
    return " ".join(value.replace("\x00", "").split())[:limit]

def snippets_for(value, hits):
    normalized = " ".join(value.replace("\x00", "").split())
    lowered = normalized.lower()
    positions = [lowered.find(term) for term in hits if lowered.find(term) >= 0]
    start = max(0, (min(positions) if positions else 0) - 150)
    return normalized[start:start + 700]

def event_texts(event):
    payload = event.get("payload", {})
    if not isinstance(payload, dict):
        return []
    timestamp = event.get("timestamp")
    event_type = event.get("type")
    output = []
    if event_type == "event_msg":
        kind = payload.get("type")
        if kind in ("user_message", "user_input"):
            text = payload.get("message") or payload.get("text") or payload.get("content")
            if isinstance(text, str) and not is_context_message(text):
                output.append(("user", text, timestamp, 8))
        elif kind in ("agent_message", "task_complete", "turn_complete", "task_completed"):
            text = payload.get("message") or payload.get("text") or payload.get("last_agent_message")
            if isinstance(text, str):
                output.append(("assistant", text, timestamp, 6))
        return output
    if event_type != "response_item":
        return output
    kind = payload.get("type")
    role = payload.get("role")
    if kind == "message" and role in ("user", "assistant"):
        text = text_from_content(payload.get("content"))
        if text and (role != "user" or not is_context_message(text)):
            output.append((role, text, timestamp, 8 if role == "user" else 6))
    elif kind in ("function_call", "custom_tool_call"):
        arguments = payload.get("arguments") or payload.get("input") or ""
        output.append(("command", clean(arguments, 20000), timestamp, 7))
    elif kind in ("function_call_output", "custom_tool_call_output"):
        value = payload.get("output") or ""
        output.append(("output", clean(value, 20000), timestamp, 3))
    return output

records = []
for filename in matching_paths:
    try:
        with open(filename, "r", encoding="utf-8", errors="replace") as handle:
            first_raw = handle.readline()
            first_obj = json.loads(first_raw)
            meta = (
                first_obj.get("payload", {})
                if first_obj.get("type") == "session_meta"
                else {}
            )
            if not isinstance(meta, dict):
                meta = {}
            source = meta.get("source")
            subagent = source.get("subagent", {}) if isinstance(source, dict) else {}
            spawn = subagent.get("thread_spawn", {}) if isinstance(subagent, dict) else {}
            record = {
                "id": meta.get("id") or meta.get("session_id") or os.path.basename(filename),
                "rootSessionId": meta.get("session_id") or meta.get("id") or "",
                "parentThreadId": meta.get("parent_thread_id") or spawn.get("parent_thread_id") or "",
                "agentPath": spawn.get("agent_path") or "",
                "agentNickname": spawn.get("agent_nickname") or "",
                "isSubagent": bool(spawn or meta.get("parent_thread_id")),
                "cwd": meta.get("cwd") or "",
                "startedAt": meta.get("timestamp") or first_obj.get("timestamp"),
                "cliVersion": meta.get("cli_version") or "",
                "path": filename,
                "mtimeMs": int(os.path.getmtime(filename) * 1000),
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
                "launches": [],
                "account": None,
                "tokenUsage": None,
                "turnState": "idle",
                "lastEventAt": first_obj.get("timestamp"),
            }
            matched = set()
            evidence = []
            term_weights = {}
            best_event_hits = 0
            best_event_weight = 0
            proximity_bonus = 0
            for raw in handle:
                try:
                    event = json.loads(raw)
                except Exception:
                    continue
                for kind, text, timestamp, weight in event_texts(event):
                    lowered = text.lower()
                    hits = [term for term in terms if term and term in lowered]
                    if not hits:
                        continue
                    unique_hits = list(dict.fromkeys(hits))
                    matched.update(unique_hits)
                    for term in unique_hits:
                        term_weights[term] = max(
                            term_weights.get(term, 0),
                            weight * (0.6 if len(term) == 1 else 1),
                        )
                    best_event_hits = max(best_event_hits, len(unique_hits))
                    best_event_weight = max(
                        best_event_weight,
                        weight if len(unique_hits) == best_event_hits else 0,
                    )
                    positions = [lowered.find(term) for term in unique_hits]
                    if len(positions) >= 3:
                        span = max(positions) - min(positions)
                        proximity_bonus = max(
                            proximity_bonus,
                            80 if span <= 500 else 45 if span <= 1600 else 20,
                        )
                    snippet = snippets_for(text, hits)
                    if snippet and all(item["text"] != snippet for item in evidence):
                        evidence.append({
                            "kind": kind,
                            "timestamp": timestamp,
                            "text": snippet,
                            "terms": list(dict.fromkeys(hits)),
                            "weight": weight,
                        })
                    if kind == "user":
                        record["firstUser"] = record["firstUser"] or clean(text)
                        record["lastUser"] = clean(text)
                        record["userMessages"].append(clean(text))
                        record["userMessages"] = record["userMessages"][-4:]
                    elif kind == "assistant":
                        record["lastAssistant"] = clean(text)
                        record["assistantMessages"].append(clean(text))
                        record["assistantMessages"] = record["assistantMessages"][-4:]
                    elif kind == "command":
                        record["lastAction"] = clean(text)
            if not matched:
                continue
            coverage = len(matched) / max(1, len(terms))
            phrase_bonus = 0
            ascii_phrase = " ".join(ascii_terms)
            combined_evidence = " ".join(item["text"].lower() for item in evidence)
            if len(ascii_terms) >= 2 and ascii_phrase in combined_evidence:
                phrase_bonus = 18
            score = (
                sum(term_weights.values()) * 4
                + coverage * coverage * 55
                + best_event_hits * best_event_hits * 6
                + best_event_weight
                + proximity_bonus
                + phrase_bonus
            )
            evidence.sort(
                key=lambda item: (len(item["terms"]), item["weight"]),
                reverse=True,
            )
            records.append({
                "rollout": record,
                "score": round(score, 2),
                "coverage": round(coverage, 3),
                "bestEventHits": best_event_hits,
                "matchedTerms": sorted(matched),
                "evidence": [
                    {key: value for key, value in item.items() if key != "weight"}
                    for item in evidence[:6]
                ],
            })
    except Exception:
        continue

records.sort(
    key=lambda item: (
        item["coverage"],
        item["bestEventHits"],
        item["score"],
        item["rollout"]["mtimeMs"],
    ),
    reverse=True,
)
print(json.dumps({
    "terms": terms,
    "filesScanned": len(matching_paths),
    "totalFiles": len(all_paths),
    "results": records[:result_limit],
}, ensure_ascii=False, separators=(",", ":")))
`;
