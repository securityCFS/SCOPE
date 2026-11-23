"""Query CLI initialization metadata only; never send a user turn or export account data."""
import json
import selectors
import subprocess
import sys
import tempfile
import time

with tempfile.TemporaryDirectory(prefix="scope-claude-probe-") as cwd:
    child = subprocess.Popen([sys.argv[1], "-p", "--input-format", "stream-json", "--output-format",
                              "stream-json", "--verbose", "--no-session-persistence"], cwd=cwd,
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        child.stdin.write(json.dumps({"type": "control_request", "request_id": "scope-models",
                                     "request": {"subtype": "initialize", "hooks": {}}}) + "\n")
        child.stdin.flush()
        selector = selectors.DefaultSelector()
        selector.register(child.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + 20
        found = False
        while time.monotonic() < deadline:
            if not selector.select(1):
                continue
            line = child.stdout.readline()
            if not line:
                break
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if value.get("type") != "control_response":
                continue
            response = value.get("response", {}).get("response", {})
            models = []
            for model in response.get("models", []):
                models.append({"id": model.get("value"), "label": model.get("displayName"),
                               "resolvedModel": model.get("resolvedModel"),
                               "efforts": model.get("supportedEffortLevels", []) if model.get("supportsEffort") else [],
                               "supportsAutoMode": model.get("supportsAutoMode") is True})
            if models:
                print(json.dumps({"models": models, "version": response.get("claude_code_version")}))
                found = True
            break
        if not found:
            raise RuntimeError("Claude CLI did not return model capabilities; check version and login")
    finally:
        child.terminate()
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
