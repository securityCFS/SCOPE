"""Linux protocol regression; fake CLI never contacts a model or real user session."""
import base64
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

SOURCE = (base64.b64decode(os.environ["SCOPE_TEST_WORKER_B64"]).decode()
          if "SCOPE_TEST_WORKER_B64" in os.environ else
          (Path(__file__).resolve().parents[1] / "bridge/providers/claude-interactive.py").read_text())
FAKE = r'''#!/usr/bin/env python3
import json, sys, os, signal, time
from pathlib import Path

def emit(value): print(json.dumps(value), flush=True)
def text(value): emit({"type":"assistant", "message":{"content":[{"type":"text", "text":value}]}})
turn = 0
background = False
for line in sys.stdin:
    value = json.loads(line)
    if value.get("request", {}).get("subtype") == "initialize":
        emit({"type":"control_response", "response":{"request_id":"scope-init", "subtype":"success", "response":{}}})
    elif value.get("type") == "user":
        turn += 1
        prompt = value["message"]["content"]
        if prompt == "stop-test":
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            Path("ready").write_text(str(os.getpid()))
            text("waiting")
        elif turn == 1:
            if prompt == "question-test":
                emit({"type":"control_request", "request_id":"question-1", "request":{"subtype":"can_use_tool", "tool_name":"AskUserQuestion", "input":{"questions":[{"question":"Colors?", "multiSelect":True, "options":[{"label":"Red"},{"label":"Green"}]}]}}})
                continue
            if prompt == "background-test":
                background = True
                emit({"type":"system", "subtype":"session_state_changed", "state":"running"})
                emit({"type":"system", "subtype":"task_started", "task_id":"agent-1", "task_type":"local_agent"})
                emit({"type":"result", "is_error":False, "result":"delegated"})
                time.sleep(0.4)
            text("progress before approval")
            emit({"type":"control_request", "request_id":"permission-1", "request":{"subtype":"can_use_tool", "tool_name":"Write", "input":{"file_path":"allowed.txt", "content":"test"}}})
        else:
            text(prompt)
            emit({"type":"result", "session_id":"native-id", "is_error":False, "result":prompt})
    elif value.get("type") == "control_response":
        response = value["response"]["response"]
        if response["behavior"] == "allow":
            if value["response"]["request_id"] == "question-1":
                assert response["updatedInput"]["answers"] == {"Colors?":"Red, Green"}
                assert response["updatedInput"]["questions"][0]["multiSelect"] is True
                text("answered")
                emit({"type":"result", "session_id":"native-id", "is_error":False, "result":"answered"})
                continue
            assert response["updatedInput"] == {"file_path":"allowed.txt", "content":"test"}
            Path("allowed.txt").write_text("test")
        if background:
            emit({"type":"system", "subtype":"task_notification", "task_id":"agent-1"})
            emit({"type":"system", "subtype":"session_state_changed", "state":"idle"})
        text(response["behavior"])
        emit({"type":"result", "session_id":"native-id", "is_error":False, "result":response["behavior"]})
'''

class InteractiveTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="scope-stream-fixture-")
        self.addCleanup(self.folder.cleanup)
        self.home = Path(self.folder.name)
        self.root = self.home / ".local/state/scope/runs" / str(uuid.uuid4())
        self.root.mkdir(parents=True)
        self.fake = self.home / "fake-claude"
        self.fake.write_text(FAKE)
        self.fake.chmod(0o700)
        self.sequence = 0
        self.env = {**os.environ, "HOME": str(self.home)}

    def start(self, prompt="first"):
        payload = dict(id=self.root.name, cwd=str(self.home), executable=str(self.fake), prompt=prompt, permissionMode="default")
        (self.root / "claude-config.json").write_text(json.dumps(payload))
        self.worker = subprocess.Popen([sys.executable, "-c", SOURCE, self.root.name], env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(self.cleanup_worker)

    def cleanup_worker(self):
        if self.worker.poll() is None: self.worker.terminate()
        self.worker.wait(timeout=5)

    def wait(self, predicate, timeout=5):
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            snapshot = self.root / "interactive.json"
            if snapshot.exists():
                value = json.loads(snapshot.read_text())
                if predicate(value): return value
            time.sleep(0.05)
        self.fail(f"Snapshot did not match: {snapshot.read_text() if snapshot.exists() else 'missing'}")

    def control(self, action, **data):
        self.sequence += 1
        value = dict(id=str(uuid.uuid4()), action=action, _sequence=self.sequence, **data)
        with (self.root / "control.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            (self.root / "controls" / (value["id"] + ".json")).write_text(json.dumps(value))
        return value["id"]

    def test_live_approval_and_ordered_followups_preserve_input(self):
        self.start()
        live = self.wait(lambda v: v["status"] == "waiting_permission")
        self.assertEqual(live["events"][0]["text"], "progress before approval")
        self.control("message", prompt="followup-one")
        self.control("message", prompt="followup-two")
        self.control("permission", requestId="permission-1", decision="allow")
        done = self.wait(lambda v: v["status"] == "completed")
        self.assertEqual((self.home / "allowed.txt").read_text(), "test")
        texts = [e["text"] for e in done["events"] if e["kind"] == "assistant"]
        self.assertEqual(texts[-2:], ["followup-one", "followup-two"])
        self.assertEqual(done["sessionId"], "native-id")
        self.worker.wait(timeout=3)

    def test_denied_tool_never_runs(self):
        self.start()
        self.wait(lambda v: v["status"] == "waiting_permission")
        self.control("permission", requestId="permission-1", decision="deny")
        self.wait(lambda v: v["status"] == "completed")
        self.assertFalse((self.home / "allowed.txt").exists())

    def test_incomplete_answer_does_not_consume_request(self):
        self.start("question-test")
        self.wait(lambda v: v["status"] == "waiting_permission")
        rid = self.control("permission", requestId="question-1", decision="allow", answers={})
        invalid = self.wait(lambda v: any(c["id"] == rid for c in v["controlResults"]))
        self.assertEqual(invalid["controlResults"][-1]["status"], "rejected")
        self.assertEqual(invalid["permissions"][0]["id"], "question-1")
        self.control("permission", requestId="question-1", decision="allow", answers={"Colors?":"Red, Green"})
        self.assertEqual(self.wait(lambda v: v["status"] == "completed")["text"], "answered")

    def test_background_result_does_not_close_approval_channel(self):
        self.start("background-test")
        live = self.wait(lambda v: v["status"] == "waiting_permission")
        self.assertEqual(live["subagents"][0]["status"], "working")
        self.control("permission", requestId="permission-1", decision="allow")
        done = self.wait(lambda v: v["status"] == "completed")
        self.assertEqual(done["subagents"][0]["status"], "completed")
        self.assertEqual(done["text"], "allow")
        self.assertTrue((self.home / "allowed.txt").exists())

    def test_stop_escalates_only_owned_process_group(self):
        external = subprocess.Popen(["sleep", "30"])
        self.addCleanup(lambda: (external.terminate(), external.wait()))
        self.start("stop-test")
        self.wait(lambda v: bool(v["events"]))
        owned_pid = int((self.home / "ready").read_text())
        self.control("stop")
        self.wait(lambda v: v["status"] == "stopping")
        self.wait(lambda v: v["status"] == "stopped", timeout=14)
        with self.assertRaises(ProcessLookupError): os.kill(owned_pid, 0)
        self.assertIsNone(external.poll())

if __name__ == "__main__": unittest.main()
