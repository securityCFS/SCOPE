"""Discover session-scoped commands without sending a prompt. No account data exported."""
import json
import os
import selectors
import subprocess
import sys
import time

provider, executable, cwd = sys.argv[1:4]
if provider != "claude": raise ValueError("Use the owned ACP session command catalog")
args = [executable, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence"]
child = subprocess.Popen(args, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
def send(value):
    child.stdin.write((json.dumps(value) + "\n").encode()); child.stdin.flush()
try:
    send({"type": "control_request", "request_id": "commands", "request": {"subtype": "initialize", "hooks": {}}})
    selector = selectors.DefaultSelector(); selector.register(child.stdout, selectors.EVENT_READ)
    buffer, deadline, found = b"", time.monotonic() + 25, False
    while time.monotonic() < deadline and not found:
        if not selector.select(.5): continue
        chunk = os.read(child.stdout.fileno(), 65536)
        if not chunk: break
        buffer += chunk
        if len(buffer) > 1000000: raise RuntimeError("Command catalog exceeds limit")
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            try: value = json.loads(line)
            except ValueError: continue
            if provider == "claude" and value.get("type") == "control_response":
                response = value.get("response", {})
                if response.get("subtype") == "error": raise RuntimeError("Claude command discovery failed")
                print(json.dumps({"commands": response.get("response", {}).get("commands", [])})); found = True; break
    if not found: raise RuntimeError("Agent did not return command catalog")
finally:
    import signal
    os.killpg(child.pid, signal.SIGTERM) if child.poll() is None else None
    try: child.wait(timeout=3)
    except subprocess.TimeoutExpired: os.killpg(child.pid, signal.SIGKILL); child.wait()
