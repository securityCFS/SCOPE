"""Linux integration regression: run with python3 tests/native-session-state.test.py."""
import base64
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SOURCE = (base64.b64decode(os.environ["SCOPE_TEST_GUARD_B64"]).decode()
          if "SCOPE_TEST_GUARD_B64" in os.environ else
          (Path(__file__).resolve().parents[1] / "bridge/providers/native-session-state.py").read_text())
SID = "00000000-1111-2222-3333-444444444444"

class NativeStateTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="scope-guard-test-")
        self.addCleanup(self.folder.cleanup)
        self.home = Path(self.folder.name)
        self.env = {**os.environ, "HOME": str(self.home), "CLAUDE_CONFIG_DIR": str(self.home / ".claude")}

    def call(self, action, provider="antigravity"):
        payload = base64.urlsafe_b64encode(json.dumps(dict(action=action, sessionId=SID, provider=provider)).encode()).decode()
        return subprocess.run([sys.executable, "-c", SOURCE, payload], env=self.env, capture_output=True, text=True, timeout=5)

    def test_reversible_visibility_preserves_native_history_and_provider_isolation(self):
        history = self.home / ".gemini/antigravity-cli/brain" / SID / "transcript.jsonl"
        history.parent.mkdir(parents=True)
        history.write_text("original history\n")
        for action, phase in [("archive", "archived"), ("delete", "deleted"), ("restore", "active")]:
            result = self.call(action)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["phase"], phase)
            self.assertEqual(history.read_text(), "original history\n")
            self.assertEqual(json.loads(self.call("status", "claude").stdout)["phase"], "active")
            if phase != "active": self.assertNotEqual(self.call("check").returncode, 0)

    def test_native_presence_lock_blocks_but_stale_file_does_not(self):
        filename = self.home / ".gemini/antigravity-cli/presence" / (SID + ".lock")
        filename.parent.mkdir(parents=True)
        with filename.open("w") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            for action in ["check", "archive", "restore"]:
                result = self.call(action)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("native presence lock", result.stderr)
            fcntl.flock(handle, fcntl.LOCK_UN)
        self.assertEqual(self.call("check").returncode, 0)

    def test_scope_lock_and_live_claude_registry_block(self):
        filename = self.home / ".local/state/scope/antigravity-sessions" / (SID + ".lock")
        filename.parent.mkdir(parents=True)
        with filename.open("w") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            self.assertNotEqual(self.call("check").returncode, 0)
        registry = self.home / ".claude/sessions/test.json"
        registry.parent.mkdir(parents=True)
        registry.write_text(json.dumps(dict(sessionId=SID, pid=os.getpid())))
        self.assertNotEqual(self.call("archive", "claude").returncode, 0)

if __name__ == "__main__":
    unittest.main()
