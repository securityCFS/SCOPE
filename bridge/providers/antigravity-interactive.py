"""Owned ACP v1 process. Durable controls; never takes over an external terminal."""
import fcntl
import json
import os
import re
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import time
from scope_acp_forms import fields, validate

root = Path.home() / ".local/state/scope/runs" / sys.argv[1]
config = json.loads((root / "claude-config.json").read_text())
controls = root / "controls"
controls.mkdir(mode=0o700, exist_ok=True)
mutex = (root / "control.lock").open("a")
state = {"status": "running", "sessionId": config.get("resumeSessionId"), "events": [],
         "permissions": [], "controlResults": [], "subagents": [], "text": "", "interactive": True, "commands": []}
pending, requests, seen, queue, subagents = {}, {}, set(), [], {}
child, stopping, finished, ready = None, None, False, False
counter, last_snapshot, active_prompt, last_subagent_scan = 0, None, "", 0.0
CREATED_SUBAGENT_RE = re.compile(r'Created the following subagent:\s*\{\s*"conversationId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})"')
SENDER_RE = re.compile(r'sender=([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})')

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

def _agy_home():
    profile = str(config.get("agyProfile") or "").strip()
    if profile and re.fullmatch(r"[a-zA-Z0-9._-]{1,64}", profile) and profile not in (".", ".."):
        return Path.home() / ".agy-profiles" / profile
    return Path.home()

def _agy_env():
    profile = str(config.get("agyProfile") or "").strip()
    if not (profile and re.fullmatch(r"[a-zA-Z0-9._-]{1,64}", profile) and profile not in (".", "..")):
        return None
    agy_home = Path.home() / ".agy-profiles" / profile
    env = dict(os.environ)
    for k in ("DBUS_SESSION_BUS_ADDRESS", "ANTIGRAVITY_APP_DATA_DIR", "ANTIGRAVITY_AGENTAPI_EXE", "ANTIGRAVITY_SOURCE_METADATA"):
        env.pop(k, None)
    env["HOME"] = str(agy_home)
    env["XDG_CONFIG_HOME"] = str(agy_home / ".config")
    env["XDG_CACHE_HOME"] = str(agy_home / ".cache")
    env["AGY_PROFILE"] = profile
    return env

def sync_brain_subagents():
    sid = state.get("sessionId")
    if not isinstance(sid, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}", sid):
        return
    brain_root = (_agy_home() / ".gemini/antigravity-cli/brain").resolve()
    logs = brain_root / sid / ".system_generated/logs"
    parent_file = next((p for p in (logs / "transcript_full.jsonl", logs / "transcript.jsonl") if p.is_file()), None)
    if parent_file is None or brain_root not in parent_file.resolve().parents:
        return
    try:
        size = parent_file.stat().st_size
        start = max(0, size - 262_144)
        with parent_file.open("rb") as h:
            h.seek(start)
            data = h.read(262_144)
        if start > 0 and b"\n" in data:
            data = data.split(b"\n", 1)[1]
        pending_meta, ordered_cids, completed_cids, killed_cids = [], [], set(), set()
        for line in data.splitlines():
            try: row = json.loads(line)
            except (ValueError, UnicodeError): continue
            if not isinstance(row, dict): continue
            kind = row.get("type")
            if kind == "PLANNER_RESPONSE":
                for call in row.get("tool_calls") or []:
                    if not isinstance(call, dict): continue
                    cname = call.get("name") or call.get("tool_name")
                    args = call.get("args") or call.get("arguments") or {}
                    if not isinstance(args, dict): continue
                    if cname == "invoke_subagent":
                        pending_meta.append({"role": _clean_arg(args.get("Role"))[:120] or "子代理", "typeName": _clean_arg(args.get("TypeName"))[:60] or "subagent"})
                    elif cname == "swarm" and _clean_arg(args.get("action")) == "add":
                        pending_meta.append({"role": (_clean_arg(args.get("name")) or "worker")[:120], "typeName": "swarm"})
                    elif cname == "manage_subagents":
                        act = _clean_arg(args.get("Action"))
                        if act == "kill_all": killed_cids.update(ordered_cids)
                        elif act == "kill":
                            ids = args.get("ConversationIds") or []
                            if isinstance(ids, str):
                                try: ids = json.loads(ids)
                                except ValueError: ids = []
                            for x in ids if isinstance(ids, list) else []: killed_cids.add(str(x))
            elif kind == "GENERIC" and isinstance(row.get("content"), str):
                for m in CREATED_SUBAGENT_RE.finditer(row["content"]):
                    cid = m.group(1)
                    meta = pending_meta.pop(0) if pending_meta else {"role": f"子代理 {cid[:8]}", "typeName": "subagent"}
                    if cid not in ordered_cids: ordered_cids.append(cid)
                    existing = next((e for k, e in subagents.items() if e.get("childId") == cid or k == cid), None)
                    if existing is None:
                        unbound = next((e for e in subagents.values() if not e.get("childId") and e.get("role") == meta["role"]), None)
                        if unbound is not None:
                            unbound["childId"] = cid
                            existing = unbound
                    if existing is None:
                        subagents[cid] = {"id": cid, "childId": cid, "role": meta["role"], "typeName": meta["typeName"], "background": True, "status": "working", "lastAction": "运行中", "updatedAt": int(time.time() * 1000)}
            elif kind == "SYSTEM_MESSAGE" and isinstance(row.get("content"), str):
                m = SENDER_RE.search(row["content"])
                if m: completed_cids.add(m.group(1))
        now_ts = time.time()
        for cid in ordered_cids[-24:]:
            entry = next((e for k, e in subagents.items() if e.get("childId") == cid or k == cid), None)
            if not entry: continue
            c_logs = brain_root / cid / ".system_generated/logs"
            c_file = next((p for p in (c_logs / "transcript_full.jsonl", c_logs / "transcript.jsonl") if p.is_file()), None)
            if c_file is not None and brain_root in c_file.resolve().parents:
                st = c_file.stat()
                entry["updatedAt"] = int(st.st_mtime * 1000)
                with c_file.open("rb") as ch:
                    ch.seek(max(0, st.st_size - 16_384))
                    cdata = ch.read(16_384)
                if st.st_size > 16_384 and b"\n" in cdata:
                    cdata = cdata.split(b"\n", 1)[1]
                last_action, last_row = "", {}
                for cline in cdata.splitlines():
                    try: crow = json.loads(cline)
                    except (ValueError, UnicodeError): continue
                    if isinstance(crow, dict):
                        last_row = crow
                        for ccall in crow.get("tool_calls") or []:
                            if isinstance(ccall, dict) and (ccall.get("name") or ccall.get("tool_name")):
                                last_action = str(ccall.get("name") or ccall.get("tool_name"))[:80]
                if cid in killed_cids: entry["status"] = "stopped"
                elif last_row.get("type") == "ERROR_MESSAGE" or last_row.get("status") == "ERROR": entry["status"] = "failed"
                elif last_row.get("type") == "PLANNER_RESPONSE" and last_row.get("status") == "DONE" and not (last_row.get("tool_calls") or []): entry["status"] = "completed"
                elif cid in completed_cids: entry["status"] = "completed"
                elif now_ts - st.st_mtime < 600: entry["status"] = "working"
                else: entry["status"] = "completed"
                if last_action: entry["lastAction"] = last_action
                elif entry["status"] == "completed": entry["lastAction"] = "已完成"
            elif cid in killed_cids: entry["status"] = "stopped"
            elif cid in completed_cids:
                entry["status"] = "completed"; entry["lastAction"] = "已完成"
    except Exception:
        pass

def save():
    global last_snapshot
    state["permissions"] = [{k: v for k, v in p.items() if k != "rpcId"} for p in pending.values()]
    state["events"] = state["events"][-300:]
    while len(state["events"]) > 1 and len(json.dumps(state["events"])) > 800000:
        state["events"].pop(0); state["truncated"] = True
    state["controlResults"] = state["controlResults"][-30:]
    state["subagents"] = list(subagents.values())[-24:]
    encoded = json.dumps(state)
    if encoded != last_snapshot:
        (root / "interactive.tmp").write_text(encoded)
        (root / "interactive.tmp").replace(root / "interactive.json")
        last_snapshot = encoded

def emit(kind, **values):
    state["events"].append({"kind": kind, "at": int(time.time() * 1000), **values})

def send(value):
    child.stdin.write((json.dumps({"jsonrpc": "2.0", **value}) + "\n").encode()); child.stdin.flush()

def call(method, params, phase):
    global counter
    counter += 1; requests[counter] = phase
    send({"id": counter, "method": method, "params": params})

def prompt(text):
    global finished, active_prompt
    finished = False
    name = re.match(r"^/([\w:-]+)(?:\s|$)", text.strip())
    if name and not any(c.get("name") == name[1] for c in state["commands"]):
        raise ValueError("/" + name[1] + " 不在当前 AGY ACP 命令目录中；请在原终端执行")
    active_prompt = text
    call("session/prompt", {"sessionId": state["sessionId"], "prompt": [{"type": "text", "text": text}]}, "prompt")

def next_setting():
    global ready
    if settings:
        method, values = settings.pop(0)
        call(method, {"sessionId": state["sessionId"], **values}, "setting")
    else:
        ready = True; prompt(config["prompt"])

def frame(value):
    global finished, settings
    if "method" in value:
        method, params = value["method"], value.get("params", {})
        if "id" in value:
            rid = str(value["id"])
            if stopping:
                send({"id": value["id"], "error": {"code": -32603, "message": "Turn cancelled"}}); return
            if params.get("sessionId") != state["sessionId"]:
                send({"id": value["id"], "error": {"code": -32602, "message": "Unknown session"}}); return
            if len(json.dumps(params)) > 500000:
                send({"id": value["id"], "error": {"code": -32602, "message": "Approval exceeds display limit"}}); return
            if method == "session/request_permission":
                tool = params.get("toolCall", {})
                pending[rid] = {"id": rid, "rpcId": value["id"], "kind": "acp-permission", "tool": tool.get("title", "工具"),
                                "input": tool, "options": params.get("options", [])}
            elif method == "elicitation/create" and params.get("mode") == "form":
                try: form_fields = fields(params["requestedSchema"])
                except (ValueError, KeyError) as error:
                    send({"id": value["id"], "result": {"action": "decline"}})
                    emit("permission", text="未支持的提问表单，已退回 Agent: " + str(error)); return
                pending[rid] = {"id": rid, "rpcId": value["id"], "kind": "acp-form", "tool": "提问", "input": params["requestedSchema"],
                                "fields": form_fields, "description": params.get("message", "")}
            else:
                send({"id": value["id"], "error": {"code": -32601, "message": "Client method not supported"}}); return
            state["status"] = "waiting_permission"
        elif method == "session/update" and params.get("sessionId") == state["sessionId"]:
            update = params.get("update", {}); kind = update.get("sessionUpdate")
            if kind == "agent_message_chunk" and ready:
                text = update.get("content", {}).get("text", "")
                events = state["events"]
                if events and events[-1]["kind"] == "assistant": events[-1]["text"] = (events[-1]["text"] + text)[-60000:]
                else: emit("assistant", text=text)
                state["text"] = (state["text"] + text)[-120000:]
            elif kind in ("tool_call", "tool_call_update") and ready:
                tid = update.get("toolCallId")
                title = str(update.get("title") or "")
                raw_in = update.get("rawInput") if isinstance(update.get("rawInput"), dict) else {}
                item = next((e for e in reversed(state["events"]) if e.get("id") == tid and e["kind"] == "tool"), None)
                if not item:
                    emit("tool", id=tid, name=update.get("title", "工具"), input={}); item = state["events"][-1]
                item["input"].update({k: update[k] for k in ("rawInput", "content", "status", "locations") if k in update})
                if tid and (("Role" in raw_in and "TypeName" in raw_in) or ("subagent" in title.lower() and "manage" not in title.lower()) or (raw_in.get("action") == "add" and ("brief" in raw_in or "tasks" in raw_in))):
                    entry = subagents.get(tid) or {
                        "id": str(tid),
                        "role": str(raw_in.get("Role") or raw_in.get("name") or title or "子代理")[:120],
                        "typeName": str(raw_in.get("TypeName") or ("swarm" if "brief" in raw_in else "subagent"))[:60],
                        "background": True,
                        "status": "working",
                        "lastAction": "启动中",
                        "updatedAt": int(time.time() * 1000),
                    }
                    if raw_in.get("Role"): entry["role"] = str(raw_in["Role"])[:120]
                    if raw_in.get("TypeName"): entry["typeName"] = str(raw_in["TypeName"])[:60]
                    if "content" in update:
                        cm = re.search(r'"conversationId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})"', json.dumps(update["content"]))
                        if cm: entry["childId"] = cm.group(1)
                    if update.get("status") in ("failed", "error"):
                        entry["status"] = "failed"
                        entry["lastAction"] = "启动失败"
                    else:
                        entry["updatedAt"] = int(time.time() * 1000)
                    subagents[tid] = entry
                if len(json.dumps(item["input"])) > 60000:
                    item["input"] = {"preview": json.dumps(item["input"], ensure_ascii=False)[:60000], "truncated": True}
            elif kind == "available_commands_update": state["commands"] = update.get("availableCommands", [])
        return
    phase = requests.pop(value.get("id"), None)
    if not phase: return
    if "error" in value: raise RuntimeError(value["error"].get("message", "ACP request failed"))
    result = value.get("result", {})
    if phase == "initialize":
        if result.get("protocolVersion") != 1: raise RuntimeError("Unsupported ACP version")
        params = {"cwd": config["cwd"], "mcpServers": []}
        if config.get("resumeSessionId"):
            params["sessionId"] = config["resumeSessionId"]
            call("session/load", params, "session")
        else: call("session/new", params, "session")
    elif phase == "session":
        state["sessionId"] = result.get("sessionId") or config.get("resumeSessionId")
        if not state["sessionId"]: raise RuntimeError("ACP missing session ID")
        settings = []
        if config.get("model"): settings.append(("session/set_model", {"modelId": config["model"]}))
        if config.get("effort"): settings.append(("session/set_config_option", {"configId": "thought_level", "value": config["effort"]}))
        mode = {"workspace": "accept-edits", "full": "default"}.get(config["permissionMode"], config["permissionMode"])
        settings.append(("session/set_mode", {"modeId": mode}))
        next_setting()
    elif phase == "setting": next_setting()
    elif phase == "prompt":
        if result.get("stopReason") in ("refusal", "max_tokens", "max_turn_requests"):
            state["error"] = "AGY 未完成本轮: " + result["stopReason"]
        if active_prompt.startswith("/") and result.get("stopReason") == "end_turn":
            emit("permission", text="原生命令已完成：" + active_prompt.split()[0])
        finished = True

args = [config["executable"], "acp"]
if config["permissionMode"] in ("workspace", "auto"): args.append("--sandbox")
if config["permissionMode"] == "full": args.append("--dangerously-skip-permissions")
try:
    with (root / "agy-stderr").open("wb") as errors:
        child = subprocess.Popen(args, cwd=config["cwd"], env=_agy_env(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, start_new_session=True)
        selector = selectors.DefaultSelector(); selector.register(child.stdout, selectors.EVENT_READ)
        call("initialize", {"protocolVersion": 1, "clientInfo": {"name": "scope", "version": "0.2.0"},
                            "clientCapabilities": {"elicitation": {"form": {}}}}, "initialize")
        buffer, started = b"", time.monotonic()
        while child.poll() is None:
            for key, _ in selector.select(.15):
                buffer += os.read(key.fd, 65536)
                if len(buffer) > 8000000: raise RuntimeError("ACP event exceeds limit")
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    try: value = json.loads(line)
                    except ValueError: continue
                    frame(value)
            fcntl.flock(mutex, fcntl.LOCK_EX)
            try:
                incoming = [(p, json.loads(p.read_text())) for p in controls.glob("*.json") if p.name not in seen]
                for file, control in sorted(incoming, key=lambda item: item[1].get("_sequence", 0)):
                    seen.add(file.name)
                    try:
                        if stopping: raise ValueError("本轮正在停止")
                        action = control["action"]
                        if action == "message":
                            queue.append(control["prompt"]); emit("user", text=control["prompt"], queued=True)
                        elif action == "permission":
                            request = pending.get(control["requestId"])
                            if not request: raise ValueError("请求已失效")
                            if request["kind"] == "acp-form":
                                decision = control.get("decision")
                                result = {"action": "accept" if decision == "allow" else "cancel" if decision == "cancel" else "decline"}
                                if decision == "allow": result["content"] = validate(request["input"], control.get("content"))
                            else:
                                option = next((o for o in request["options"] if o["optionId"] == control.get("optionId")), None)
                                if control.get("optionId") and not option: raise ValueError("审批选项已失效")
                                if not option and control.get("decision") == "allow": raise ValueError("请选择审批范围")
                                result = {"outcome": {"outcome": "selected", "optionId": option["optionId"]} if option else {"outcome": "cancelled"}}
                            send({"id": request["rpcId"], "result": result}); del pending[control["requestId"]]
                            emit("permission", text="回答已提交" if request["kind"] == "acp-form" else "审批已提交")
                            state["status"] = "waiting_permission" if pending else "running"
                        elif action == "stop":
                            stopping = time.monotonic(); queue.clear()
                            for request in pending.values():
                                send({"id": request["rpcId"], "result": {"action": "cancel"} if request["kind"] == "acp-form" else {"outcome": {"outcome": "cancelled"}}})
                            pending.clear()
                            send({"method": "session/cancel", "params": {"sessionId": state["sessionId"]}})
                            state["status"] = "stopping"
                        else: raise ValueError("未知操作")
                        state["controlResults"].append({"id": control["id"], "status": "accepted"})
                    except (ValueError, KeyError) as error:
                        state["controlResults"].append({"id": control.get("id"), "status": "rejected", "error": str(error)})
                if finished and not pending:
                    if queue and not stopping: prompt(queue.pop(0))
                    else: break
                if time.monotonic() - last_subagent_scan >= 2.0:
                    last_subagent_scan = time.monotonic()
                    sync_brain_subagents()
                save()
            finally: fcntl.flock(mutex, fcntl.LOCK_UN)
            if not ready and time.monotonic() - started > 60: raise RuntimeError("AGY ACP 初始化超时")
            if stopping and time.monotonic() - stopping > 3: break
        sync_brain_subagents()
        state["status"] = "stopped" if stopping else "completed" if finished and not state.get("error") else "failed"
        if state["status"] == "failed" and not state.get("error"):
            state["error"] = (root / "agy-stderr").read_text(errors="replace")[-2000:] or "AGY exited without a result"
except Exception as error:
    state.update(status="failed", error=str(error))
finally:
    if child and child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try: child.wait(timeout=3)
        except subprocess.TimeoutExpired: os.killpg(child.pid, signal.SIGKILL); child.wait()
    pending.clear(); save()
