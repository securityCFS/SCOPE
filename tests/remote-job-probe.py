"""Exercise the remote spool on an isolated filesystem without running an agent."""
import base64
import json
from pathlib import Path
import runpy
import sys
import tempfile
from unittest.mock import patch

source = Path(sys.argv[1]).resolve()
task_id = "11111111-1111-4111-8111-111111111111"
with tempfile.TemporaryDirectory(prefix="scope-spool-test-") as directory:
    home = Path(directory)
    def call(payload):
        encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
        with patch("sys.argv", [str(source), encoded]), patch("pathlib.Path.home", return_value=home):
            return runpy.run_path(str(source))

    request = {"operation": "launch", "id": task_id, "command": "harmless placeholder", "input": "test prompt"}
    with patch("subprocess.Popen") as spawn:
        result = call(request)
        assert spawn.call_count == 1
        call(request)
        call({"operation": "status", "id": task_id})
        assert spawn.call_count == 1, "duplicate launch or status must never spawn"
        try:
            call({**request, "input": "different"})
            raise AssertionError("mismatched request accepted")
        except ValueError:
            pass
        assert spawn.call_count == 1

    root = home / ".local/state/scope/runs" / task_id
    with patch("subprocess.Popen") as spawn, patch("sys.argv", ["worker", str(root)]):
        spawn.return_value.returncode = 0
        exec(compile(result["WORKER"], "remote-worker", "exec"), {})
        spawn.assert_called_once()
        assert spawn.call_args.args[0] == ["bash", "-ic", request["command"]]
        spawn.return_value.communicate.assert_called_once_with(b"test prompt")
    assert json.loads((root / "status.json").read_text())["status"] == "completed"
    with patch("subprocess.Popen") as spawn:
        call({"operation": "status", "id": task_id})
        spawn.assert_not_called()

    with patch("subprocess.Popen") as spawn:
        result = call({"operation": "archive", "id": task_id})
        archived = home / ".local/state/scope/archives" / task_id
        assert archived.exists() and not root.exists()
        assert result["result"]["status"] == "completed"
        call({"operation": "archive", "id": task_id})
        call(request)
        spawn.assert_not_called()
        call({"operation": "restore", "id": task_id})
        assert root.exists() and not archived.exists()
        (root / "status.json").write_text(json.dumps({"status": "running", "pid": 999}))
        try:
            call({"operation": "archive", "id": task_id})
            raise AssertionError("running task archived")
        except ValueError:
            pass
        assert root.exists() and not archived.exists()
        spawn.assert_not_called()
