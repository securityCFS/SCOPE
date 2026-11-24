"""One owned Claude stream-json process, with durable UI control and event snapshots."""
import fcntl
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time

root = Path.home() / ".local/state/scope/runs" / sys.argv[1]
config = json.loads((root / "claude-config.json").read_text(encoding="utf-8"))
controls = root / "controls"
controls.mkdir(mode=0o700, exist_ok=True)
mutex = (root / "control.lock").open("a")
state = {"status": "running", "sessionId": config.get("resumeSessionId"), "events": [],
         "permissions": [], "controlResults": [], "text": "", "interactive": True}
pending = {}
queue = []
seen = set()
subagents = {}
finished = False
stopping = None
closing = None
initialized = False
partial = ""
result_value = None
last_snapshot = None
signal_stage = 0
inflight = set()
session_state = None

def save():
    global last_snapshot
    state["permissions"] = list(pending.values())
    state["events"] = state["events"][-300:]
    while len(state["events"]) > 1 and len(json.dumps(state["events"])) > 800_000:
        state["events"].pop(0)
        state["truncated"] = True
    state["controlResults"] = state["controlResults"][-30:]
    sub_list = list(subagents.values())[-24:]
    # Keep total subagent workflow buffer bounded inside interactive.json
    while len(json.dumps(sub_list)) > 240_000:
        trimmed = False
        for item in sub_list:
            steps = item.get("steps")
            if isinstance(steps, list) and len(steps) > 4:
                item["steps"] = ([steps[0]] + steps[2:]) if steps[0].get("kind") == "prompt" else steps[1:]
                trimmed = True
        if not trimmed:
            break
    state["subagents"] = sub_list
    state["partial"] = partial[-60000:]
    encoded = json.dumps(state)
    if encoded == last_snapshot: return
    temporary = root / "interactive.tmp"
    temporary.write_text(encoded, encoding="utf-8")
    temporary.replace(root / "interactive.json")
    last_snapshot = encoded

def event(kind, **data):
    state["events"].append({"kind": kind, "at": int(time.time() * 1000), **data})

def send(value):
    child.stdin.write((json.dumps(value) + "\n").encode())
    child.stdin.flush()

def user(prompt):
    send({"type": "user", "message": {"role": "user", "content": prompt},
          "parent_tool_use_id": None, "session_id": state.get("sessionId") or ""})

def respond(request_id, response):
    send({"type": "control_response", "response": {"subtype": "success", "request_id": request_id, "response": response}})

def find_subagent(task_id=None, tool_id=None):
    if tool_id and tool_id in subagents:
        return subagents[tool_id]
    if task_id and task_id in subagents:
        return subagents[task_id]
    if task_id:
        for entry in subagents.values():
            if entry.get("taskId") == task_id:
                return entry
    if tool_id:
        for entry in subagents.values():
            if entry.get("toolUseId") == tool_id:
                return entry
    return None

def subagent_tool_summary(name, raw_input):
    if isinstance(raw_input, dict):
        for key in ("description", "file_path", "path", "command", "cmd", "pattern", "query", "url", "glob", "prompt"):
            val = raw_input.get(key)
            if isinstance(val, str) and val.strip():
                line = val.strip().splitlines()[0].strip()
                if key in ("file_path", "path") and ("/" in line or "\\" in line):
                    return (line.replace("\\", "/").split("/")[-1] or line)[:80]
                return line[:80]
    return ""

def append_subagent_step(entry, step):
    steps = entry.setdefault("steps", [])
    steps.append(step)
    if len(steps) > 40:
        if steps[0].get("kind") == "prompt":
            entry["steps"] = [steps[0]] + steps[-39:]
        else:
            entry["steps"] = steps[-40:]
    entry["hasWorkflow"] = True

def frame(value):
    global initialized, partial, result_value, finished, session_state
    kind = value.get("type")
    now_ms = int(time.time() * 1000)
    if value.get("session_id"):
        state["sessionId"] = value["session_id"]
    if kind == "system":
        subtype = value.get("subtype")
        if subtype == "init": state["commands"] = [{"name": name} for name in value.get("slash_commands", [])]
        task_id = value.get("task_id")
        if subtype == "session_state_changed": session_state = value.get("state")
        elif subtype == "task_started" and value.get("task_type") in ("local_agent", "local_workflow"):
            inflight.add(task_id)
            tool_id = value.get("tool_use_id")
            entry = find_subagent(task_id=task_id, tool_id=tool_id)
            if entry is None:
                entry = {
                    "id": str(tool_id or task_id),
                    "toolUseId": str(tool_id) if tool_id else "",
                    "taskId": str(task_id),
                    "role": str(value.get("description") or "后台子代理")[:120],
                    "typeName": str(value.get("task_type") or "agent")[:60],
                    "background": True,
                    "status": "working",
                    "lastAction": "后台运行中",
                    "updatedAt": now_ms,
                    "hasWorkflow": True,
                    "steps": [],
                    "partial": "",
                }
                subagents[entry["id"]] = entry
            else:
                entry["taskId"] = str(task_id)
                if tool_id and not entry.get("toolUseId"):
                    entry["toolUseId"] = str(tool_id)
                entry["background"] = True
                entry["status"] = "working"
                entry["updatedAt"] = now_ms
        elif subtype in ("task_progress", "task_updated"):
            patch_status = value.get("patch", {}).get("status") if isinstance(value.get("patch"), dict) else None
            if subtype == "task_updated" and patch_status in ("completed", "failed", "stopped"):
                inflight.discard(task_id)
            entry = find_subagent(task_id=task_id, tool_id=value.get("tool_use_id"))
            if entry is not None:
                action = value.get("last_tool_name") or value.get("description") or patch_status
                if action: entry["lastAction"] = str(action)[:120]
                if patch_status in ("completed", "failed", "stopped"):
                    entry["status"] = patch_status
                entry["updatedAt"] = now_ms
        elif subtype == "task_notification":
            inflight.discard(task_id)
            entry = find_subagent(task_id=task_id, tool_id=value.get("tool_use_id"))
            if entry is None and task_id:
                entry = {
                    "id": str(task_id),
                    "taskId": str(task_id),
                    "role": str(value.get("description") or "后台子代理")[:120],
                    "typeName": "local_agent",
                    "background": True,
                    "status": "completed",
                    "lastAction": "已完成",
                    "updatedAt": now_ms,
                }
                subagents[entry["id"]] = entry
            if entry is not None:
                done_status = value.get("status")
                entry["status"] = done_status if done_status in ("completed", "failed", "stopped") else "completed"
                entry["lastAction"] = str(value.get("summary") or "已完成")[:120]
                entry["updatedAt"] = now_ms
    if kind in ("assistant", "stream_event") and value.get("parent_tool_use_id") is None:
        finished = False
    if kind == "control_response" and value.get("response", {}).get("request_id") == "scope-init":
        if value["response"].get("subtype") == "error":
            raise RuntimeError(value["response"].get("error", "Claude initialization failed"))
        initialized = True
        state["commands"] = value["response"].get("response", {}).get("commands", [])
        user(config["prompt"])
    elif kind == "control_request":
        request = value.get("request", {})
        rid = value["request_id"]
        if request.get("subtype") == "can_use_tool" and not stopping:
            if len(json.dumps(request)) > 500_000:
                respond(rid, {"behavior": "deny", "message": "Approval input exceeds display limit; split the operation"})
                event("permission", text="审批内容过大，已拒绝；请拆分操作")
                return
            pending[rid] = {"id": rid, "tool": request.get("tool_name", "Tool"),
                            "input": request.get("input", {}), "description": request.get("description", ""),
                            "reason": request.get("decision_reason", ""), "path": request.get("blocked_path", "")}
            state["status"] = "waiting_permission"
        else:
            respond(rid, {"behavior": "deny", "message": "SCOPE cannot handle this request or is stopping"})
    elif kind == "control_cancel_request":
        pending.pop(value.get("request_id"), None)
        if not pending and not stopping: state["status"] = "running"
    elif kind == "stream_event":
        parent_id = value.get("parent_tool_use_id")
        data = value.get("event", {})
        if parent_id:
            entry = find_subagent(tool_id=parent_id)
            if entry is not None and data.get("type") == "content_block_delta" and data.get("delta", {}).get("type") == "text_delta":
                entry["partial"] = (entry.get("partial", "") + data["delta"].get("text", ""))[-8000:]
                entry["updatedAt"] = now_ms
                entry["hasWorkflow"] = True
            return
        if data.get("type") == "content_block_delta" and data.get("delta", {}).get("type") == "text_delta":
            partial += data["delta"].get("text", "")
    elif kind == "assistant":
        parent_id = value.get("parent_tool_use_id")
        if parent_id:
            entry = find_subagent(tool_id=parent_id)
            if entry is not None:
                entry["updatedAt"] = now_ms
                entry["partial"] = ""
                msg = value.get("message") if isinstance(value.get("message"), dict) else {}
                if isinstance(msg.get("model"), str) and not entry.get("model"):
                    entry["model"] = msg["model"][:80]
                for block in msg.get("content", []):
                    if not isinstance(block, dict):
                        continue
                    btype = block.get("type")
                    if btype == "thinking":
                        tval = str(block.get("thinking") or block.get("text") or "").strip()
                        if tval:
                            append_subagent_step(entry, {
                                "id": f"live-think-{now_ms}-{len(entry.get('steps', []))}",
                                "kind": "thinking",
                                "title": "思考过程",
                                "text": tval[:2500],
                                "timestamp": now_ms,
                            })
                    elif btype == "tool_use":
                        tname = str(block.get("name") or "工具调用")[:80]
                        tinput = block.get("input")
                        summary = subagent_tool_summary(tname, tinput)
                        entry["lastAction"] = f"{tname} · {summary}"[:96] if summary else tname
                        try:
                            in_str = json.dumps(tinput, ensure_ascii=False, indent=2) if tinput is not None else ""
                        except (TypeError, ValueError):
                            in_str = str(tinput)
                        append_subagent_step(entry, {
                            "id": str(block.get("id") or f"live-tool-{now_ms}-{len(entry.get('steps', []))}"),
                            "kind": "tool",
                            "toolName": tname,
                            "title": tname,
                            "summary": summary,
                            "inputPreview": in_str[:2500],
                            "output": "",
                            "isError": False,
                            "status": "running",
                            "timestamp": now_ms,
                        })
                    elif btype == "text":
                        tval = str(block.get("text") or "").strip()
                        if tval:
                            if not entry.get("lastAction"):
                                entry["lastAction"] = "生成回复中"
                            append_subagent_step(entry, {
                                "id": f"live-asst-{now_ms}-{len(entry.get('steps', []))}",
                                "kind": "assistant",
                                "title": "回复",
                                "text": tval[:6000],
                                "timestamp": now_ms,
                            })
            return
        partial = ""
        for block in value.get("message", {}).get("content", []):
            if block.get("type") == "text":
                event("assistant", text=block.get("text", "")[-60000:])
            elif block.get("type") == "tool_use":
                tool_name = block.get("name")
                tool_input = block.get("input", {})
                if tool_name in ("Agent", "Task") and isinstance(tool_input, dict):
                    tid = str(block.get("id") or f"sub-{len(subagents) + 1}")
                    prompt_val = str(tool_input.get("prompt") or "").strip()
                    subagents[tid] = {
                        "id": tid,
                        "toolUseId": tid,
                        "role": str(tool_input.get("description") or prompt_val or "子代理任务")[:120],
                        "typeName": str(tool_input.get("subagent_type") or "agent")[:60],
                        "background": bool(tool_input.get("run_in_background")),
                        "status": "working",
                        "lastAction": "启动中",
                        "updatedAt": now_ms,
                        "hasWorkflow": True,
                        "steps": ([{"id": f"prompt-{tid}", "kind": "prompt", "title": "子代理任务", "text": prompt_val[:4000], "timestamp": now_ms}] if prompt_val else []),
                        "partial": "",
                    }
                if len(json.dumps(tool_input)) > 60000: tool_input = {"preview": json.dumps(tool_input, ensure_ascii=False)[:60000], "truncated": True}
                event("tool", id=block.get("id"), name=tool_name, input=tool_input)
    elif kind == "user" and isinstance(value.get("message", {}).get("content"), list):
        if value.get("parent_tool_use_id"):
            entry = find_subagent(tool_id=value.get("parent_tool_use_id"))
            if entry is not None:
                entry["updatedAt"] = now_ms
                for block in value["message"]["content"]:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        tid = str(block.get("tool_use_id") or "")
                        raw_out = block.get("content", "")
                        if isinstance(raw_out, list):
                            out_text = "\n".join(
                                (p.get("text", "") if isinstance(p, dict) else str(p))
                                for p in raw_out
                                if not (isinstance(p, dict) and p.get("type") == "image")
                            )
                        elif isinstance(raw_out, str):
                            out_text = raw_out
                        else:
                            out_text = json.dumps(raw_out, ensure_ascii=False)
                        is_err = bool(block.get("is_error"))
                        for step in reversed(entry.get("steps", [])):
                            if step.get("kind") == "tool" and step.get("id") == tid:
                                step["output"] = out_text[:3000]
                                step["isError"] = is_err
                                step["status"] = "failed" if is_err else "completed"
                                break
            return
        for block in value["message"]["content"]:
            if block.get("type") == "tool_result":
                content = block.get("content", "")
                tid = block.get("tool_use_id")
                text_val = content if isinstance(content, str) else json.dumps(content)
                if tid and tid in subagents:
                    entry = subagents[tid]
                    if "Async agent launched" in text_val or (entry.get("taskId") and entry["taskId"] in inflight):
                        entry["background"] = True
                        entry["lastAction"] = "后台运行中"
                        entry["updatedAt"] = now_ms
                    else:
                        entry["status"] = "failed" if block.get("is_error") else "completed"
                        entry["lastAction"] = "失败" if block.get("is_error") else "已完成"
                        entry["updatedAt"] = now_ms
                event("tool_result", id=tid, text=text_val[-12000:])
    elif kind == "result":
        partial = ""
        result_value = value
        state["text"] = value.get("result", "")[-120000:]
        state["error"] = (value.get("result") or "; ".join(value.get("errors", []))) if value.get("is_error") else None
        finished = True

args = [config["executable"], "-p", "--input-format", "stream-json", "--output-format", "stream-json",
        "--verbose", "--include-partial-messages", "--permission-prompt-tool", "stdio",
        "--permission-mode", "acceptEdits" if config["permissionMode"] == "workspace" else config["permissionMode"]]
if config.get("model"): args += ["--model", config["model"]]
if config.get("effort"): args += ["--effort", config["effort"]]
if config.get("resumeSessionId"): args += ["--resume", config["resumeSessionId"]]
child = None
try:
    with (root / "claude-stderr").open("wb") as errors:
        child = subprocess.Popen(args, cwd=config["cwd"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=errors, start_new_session=True,
                                 env={**os.environ, "CLAUDE_CODE_SDK_READS_SESSION_STATE": "1"})
        save()
        selector = selectors.DefaultSelector()
        selector.register(child.stdout, selectors.EVENT_READ)
        send({"type": "control_request", "request_id": "scope-init", "request": {"subtype": "initialize", "hooks": {}}})
        buffer = b""
        started = time.monotonic()
        while child.poll() is None:
            for key, _ in selector.select(0.15):
                chunk = os.read(key.fd, 65536)
                if not chunk: continue
                buffer += chunk
                if len(buffer) > 8_000_000: raise RuntimeError("Claude event exceeds size limit")
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    try: value = json.loads(line)
                    except ValueError: continue
                    frame(value)
            fcntl.flock(mutex, fcntl.LOCK_EX)
            try:
                incoming = [(file, json.loads(file.read_text())) for file in controls.glob("*.json") if file.name not in seen]
                for file, command in sorted(incoming, key=lambda item: (item[1].get("_sequence", 0), item[0].stat().st_mtime_ns, item[0].name)):
                    seen.add(file.name)
                    try:
                        action = command["action"]
                        if closing or stopping: raise ValueError("本轮正在结束，请等待后重新发送")
                        if action == "message":
                            queue.append(command["prompt"])
                            event("user", text=command["prompt"], queued=True)
                        elif action == "permission":
                            request = pending.get(command["requestId"])
                            if not request: raise ValueError("权限请求已失效或已处理")
                            response = {"behavior": "deny", "message": "用户拒绝了这次操作"}
                            if command["decision"] == "allow":
                                original = request["input"]
                                if request["tool"] == "AskUserQuestion":
                                    answers = command.get("answers", {})
                                    questions = original.get("questions", [])
                                    if not questions or any(not isinstance(answers.get(q["question"]), str) or not answers[q["question"]].strip() for q in questions):
                                        raise ValueError("请回答所有问题后提交")
                                    original = {**original, "answers": {q["question"]: answers[q["question"]] for q in questions}}
                                response = {"behavior": "allow", "updatedInput": original}
                            respond(request["id"], response)
                            pending.pop(command["requestId"], None)
                            event("permission", text=f'{request["tool"]}: ' + ("允许这次" if command["decision"] == "allow" else "已拒绝"))
                            state["status"] = "waiting_permission" if pending else "running"
                        elif action == "stop":
                            stopping = time.monotonic()
                            if queue: event("permission", text=f"已取消 {len(queue)} 条尚未执行的追加消息")
                            queue.clear()
                            for request in list(pending.values()): respond(request["id"], {"behavior": "deny", "message": "用户已停止", "interrupt": True})
                            pending.clear()
                            send({"type": "control_request", "request_id": "scope-stop", "request": {"subtype": "interrupt"}})
                            state["status"] = "stopping"
                        state["controlResults"].append({"id": command["id"], "status": "accepted"})
                    except (KeyError, ValueError) as error:
                        state["controlResults"].append({"id": command.get("id"), "status": "rejected", "error": str(error)})
                if finished and not stopping and not closing and not pending and not inflight and session_state in (None, "idle"):
                    if queue:
                        user(queue.pop(0))
                        finished = False
                        state["status"] = "running"
                    else:
                        closing = time.monotonic()
                        state["status"] = "finishing"
                        child.stdin.close()
                save()
            finally: fcntl.flock(mutex, fcntl.LOCK_UN)
            now = time.monotonic()
            if not initialized and now - started > 30: raise RuntimeError("Claude initialization timed out")
            if stopping:
                elapsed = now - stopping
                stage = 3 if elapsed > 12 else 2 if elapsed > 8 else 1 if elapsed > 2 else 0
                if stage > signal_stage and child.poll() is None:
                    os.killpg(child.pid, [None, signal.SIGINT, signal.SIGTERM, signal.SIGKILL][stage])
                    signal_stage = stage
            elif closing and now - closing > 15:
                # The completed turn's CLI is owned by this worker only.
                os.killpg(child.pid, signal.SIGTERM)
        child.wait()
        state["status"] = "stopped" if stopping else "failed" if not result_value or result_value.get("is_error") else "completed"
        if state["status"] == "stopped":
            for entry in subagents.values():
                if entry.get("status") == "working": entry["status"] = "stopped"
        elif state["status"] in ("completed", "failed") and not inflight:
            for entry in subagents.values():
                if entry.get("status") == "working":
                    entry["status"] = "completed" if state["status"] == "completed" else "failed"
        if state["status"] == "failed" and not state.get("error"):
            state["error"] = (root / "claude-stderr").read_text(errors="replace")[-2000:] or "Claude exited without a result"
except Exception as error:
    state["status"] = "failed"
    state["error"] = str(error)
finally:
    if child and child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try: child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    pending.clear()
    save()
