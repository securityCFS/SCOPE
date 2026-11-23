#!/usr/bin/env python3
"""SCOPE completion email CLI and stdio MCP server.

The remote host never receives SMTP credentials. Events are delivered through a
loopback-only SSH reverse tunnel to the SCOPE relay on the operator's workstation. If
the tunnel is unavailable, events are durably queued and retried by `service`.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import time
import urllib.error
import urllib.request
import uuid


CONFIG_PATH = Path.home() / ".config" / "scope-email" / "config.json"
STATE_DIRECTORY = Path.home() / ".local" / "state" / "scope-email"
OUTBOX_DIRECTORY = STATE_DIRECTORY / "outbox"
LOCK_PATH = STATE_DIRECTORY / "service.lock"
STATE_PATH = STATE_DIRECTORY / "state.json"
VALID_STATUSES = {"completed", "failed", "needs_attention"}
SERVER_VERSION = "1.0.0"


def clean(value: object, limit: int = 4000) -> str:
    return str(value or "").replace("\x00", "").strip()[:limit]


def write_json_atomic(filename: Path, value: object, mode: int = 0o600) -> None:
    filename.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = filename.with_suffix(filename.suffix + f".{os.getpid()}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, filename)
        os.chmod(filename, mode)
    finally:
        if temporary.exists():
            temporary.unlink()


def read_config() -> dict:
    try:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"missing configuration: {CONFIG_PATH}") from exc
    endpoint = clean(config.get("endpoint"), 2000)
    token = clean(config.get("token"), 2000)
    if not endpoint.startswith("http://127.0.0.1:") or not endpoint.endswith("/v1/notify"):
        raise RuntimeError("relay endpoint must be a loopback /v1/notify URL")
    if len(token) < 32:
        raise RuntimeError("relay token is invalid")
    return {"endpoint": endpoint, "token": token}


def normalize_event(arguments: dict) -> dict:
    status = clean(arguments.get("status"), 40).lower()
    title = clean(arguments.get("title"), 240)
    summary = clean(arguments.get("summary"), 8000)
    if status not in VALID_STATUSES:
        raise ValueError("status must be completed, failed, or needs_attention")
    if not title or not summary:
        raise ValueError("title and summary are required")
    details = arguments.get("details", [])
    if isinstance(details, str):
        details = [details]
    if not isinstance(details, list):
        raise ValueError("details must be an array of strings")
    return {
        "status": status,
        "title": title,
        "summary": summary,
        "details": [clean(item, 2000) for item in details[:12] if clean(item, 2000)],
        "session": clean(arguments.get("session"), 300),
        "agent": clean(arguments.get("agent"), 80) or infer_agent(),
        "cwd": clean(arguments.get("cwd"), 1000) or os.getcwd(),
        "host": socket.gethostname(),
        "timestamp": clean(arguments.get("timestamp"), 100) or time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
        ),
    }


def infer_agent() -> str:
    if os.environ.get("CLAUDE_PROJECT_DIR"):
        return "claude-code"
    if os.environ.get("CODEX_HOME") or os.environ.get("CODEX_THREAD_ID"):
        return "codex"
    return "agent"


def post_event(event: dict) -> dict:
    config = read_config()
    request = urllib.request.Request(
        config["endpoint"],
        data=json.dumps(event, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {config['token']}",
            "Content-Type": "application/json",
            "User-Agent": f"scope-notify/{SERVER_VERSION}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            result = json.loads(response.read(32768).decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read(4096).decode("utf-8", "replace")
        raise RuntimeError(f"relay returned HTTP {exc.code}: {clean(body, 500)}") from exc
    if not result.get("accepted"):
        raise RuntimeError(clean(result.get("error"), 500) or "relay rejected event")
    return result


def queue_event(event: dict) -> Path:
    OUTBOX_DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
    fingerprint = hashlib.sha256(
        json.dumps(event, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]
    filename = OUTBOX_DIRECTORY / f"{int(time.time() * 1000)}-{fingerprint}-{uuid.uuid4().hex[:8]}.json"
    write_json_atomic(filename, event)
    return filename


def record_delivery(result: dict) -> None:
    write_json_atomic(
        STATE_PATH,
        {
            "lastDeliveredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "lastResult": result,
        },
    )


def deliver_or_queue(arguments: dict) -> dict:
    event = normalize_event(arguments)
    try:
        result = post_event(event)
        record_delivery(result)
        return {"ok": True, "delivery": "sent", **result}
    except Exception as exc:  # The durable queue is the availability boundary.
        queued = queue_event(event)
        return {
            "ok": True,
            "delivery": "queued",
            "reason": clean(exc, 500),
            "queueId": queued.stem,
        }


def flush_outbox() -> dict:
    OUTBOX_DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
    sent = 0
    failed = 0
    for filename in sorted(OUTBOX_DIRECTORY.glob("*.json")):
        try:
            event = json.loads(filename.read_text(encoding="utf-8"))
            result = post_event(event)
            filename.unlink()
            record_delivery(result)
            sent += 1
        except Exception:
            failed += 1
            break
    return {"sent": sent, "remaining": len(list(OUTBOX_DIRECTORY.glob("*.json"))), "failed": failed}


def service() -> int:
    STATE_DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
    with LOCK_PATH.open("a+", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("scope-notify service is already running", file=sys.stderr)
            return 0
        while True:
            flush_outbox()
            time.sleep(15)


def relay_status() -> dict:
    queued = len(list(OUTBOX_DIRECTORY.glob("*.json"))) if OUTBOX_DIRECTORY.exists() else 0
    state = {}
    try:
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    reachable = False
    error = ""
    try:
        config = read_config()
        health = config["endpoint"].removesuffix("/v1/notify") + "/health"
        with urllib.request.urlopen(health, timeout=3) as response:
            reachable = response.status == 200
    except Exception as exc:
        error = clean(exc, 300)
    return {
        "service": "scope-notify",
        "version": SERVER_VERSION,
        "relayReachable": reachable,
        "queued": queued,
        "lastDeliveredAt": state.get("lastDeliveredAt"),
        "error": error or None,
    }


TOOL = {
    "name": "send_completion_email",
    "description": (
        "Send the operator one email when a long-running or unattended task completes, fails, "
        "or needs attention. Do not use for routine progress updates or ordinary chat replies."
    ),
    "inputSchema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["status", "title", "summary"],
        "properties": {
            "status": {"type": "string", "enum": sorted(VALID_STATUSES)},
            "title": {"type": "string", "maxLength": 240},
            "summary": {"type": "string", "maxLength": 8000},
            "details": {
                "type": "array",
                "maxItems": 12,
                "items": {"type": "string", "maxLength": 2000},
            },
            "session": {"type": "string", "maxLength": 300},
            "agent": {"type": "string", "maxLength": 80},
        },
    },
}


def mcp_response(identifier: object, result: object = None, error: object = None) -> dict:
    response = {"jsonrpc": "2.0", "id": identifier}
    if error is not None:
        response["error"] = error
    else:
        response["result"] = result
    return response


def handle_mcp(message: dict) -> dict | None:
    method = message.get("method")
    identifier = message.get("id")
    if identifier is None:
        return None
    if method == "initialize":
        requested = clean(message.get("params", {}).get("protocolVersion"), 40)
        return mcp_response(
            identifier,
            {
                "protocolVersion": requested or "2025-06-18",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "scope-email", "version": SERVER_VERSION},
                "instructions": (
                    "Use send_completion_email exactly once when a long-running or unattended task "
                    "finishes, fails, or is blocked on human input. Never send routine progress email."
                ),
            },
        )
    if method == "ping":
        return mcp_response(identifier, {})
    if method == "tools/list":
        return mcp_response(identifier, {"tools": [TOOL]})
    if method == "tools/call":
        params = message.get("params") or {}
        if params.get("name") != TOOL["name"]:
            return mcp_response(identifier, error={"code": -32602, "message": "unknown tool"})
        try:
            result = deliver_or_queue(params.get("arguments") or {})
            text = json.dumps(result, ensure_ascii=False)
            return mcp_response(
                identifier,
                {"content": [{"type": "text", "text": text}], "structuredContent": result},
            )
        except Exception as exc:
            return mcp_response(
                identifier,
                {
                    "content": [{"type": "text", "text": clean(exc, 800)}],
                    "isError": True,
                },
            )
    return mcp_response(identifier, error={"code": -32601, "message": "method not found"})


def read_mcp_message(stream) -> tuple[dict | None, str]:
    while True:
        line = stream.readline()
        if not line:
            return None, "newline"
        if not line.strip():
            continue
        if line.lower().startswith(b"content-length:"):
            length = int(line.split(b":", 1)[1].strip())
            while True:
                header = stream.readline()
                if header in (b"\r\n", b"\n", b""):
                    break
            return json.loads(stream.read(length).decode("utf-8")), "header"
        return json.loads(line.decode("utf-8")), "newline"


def write_mcp_message(stream, message: dict, framing: str) -> None:
    payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if framing == "header":
        stream.write(f"Content-Length: {len(payload)}\r\n\r\n".encode("ascii"))
        stream.write(payload)
    else:
        stream.write(payload + b"\n")
    stream.flush()


def mcp_server() -> int:
    source = sys.stdin.buffer
    sink = sys.stdout.buffer
    while True:
        try:
            message, framing = read_mcp_message(source)
            if message is None:
                return 0
            response = handle_mcp(message)
            if response is not None:
                write_mcp_message(sink, response, framing)
        except Exception as exc:
            print(f"scope-email MCP error: {clean(exc, 500)}", file=sys.stderr)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="scope-notify")
    subparsers = parser.add_subparsers(dest="command", required=True)
    send = subparsers.add_parser("send", help="send or queue a completion email")
    send.add_argument("--status", required=True, choices=sorted(VALID_STATUSES))
    send.add_argument("--title", required=True)
    send.add_argument("--summary", required=True)
    send.add_argument("--detail", action="append", dest="details", default=[])
    send.add_argument("--session", default="")
    send.add_argument("--agent", default="")
    subparsers.add_parser("status", help="show relay and queue status")
    subparsers.add_parser("flush", help="retry queued notifications now")
    subparsers.add_parser("service", help="run the durable queue worker")
    subparsers.add_parser("mcp", help="run the stdio MCP server")
    return parser


def main() -> int:
    arguments = vars(build_parser().parse_args())
    command = arguments.pop("command")
    if command == "send":
        result = deliver_or_queue(arguments)
    elif command == "status":
        result = relay_status()
    elif command == "flush":
        result = flush_outbox()
    elif command == "service":
        return service()
    elif command == "mcp":
        return mcp_server()
    else:
        raise RuntimeError("unknown command")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:
        print(f"scope-notify: {clean(error, 800)}", file=sys.stderr)
        raise SystemExit(1)
