/** Remote probe, kept independent of HTTP and local mutable state. */
export const RAW_CONTEXT_PROBE = String.raw`
import collections
import json
import os
import sys

path = os.path.realpath(sys.argv[1])
if not os.path.isfile(path):
    raise SystemExit("rollout file does not exist")

max_payload_bytes = 7_500_000
records = collections.deque()
record_sizes = collections.deque()
payload_bytes = 0
truncated = False
session_meta = None

with open(path, "r", encoding="utf-8", errors="replace") as handle:
    for line in handle:
        try:
            event = json.loads(line)
        except Exception:
            continue
        event_type = event.get("type")
        if event_type == "session_meta" and session_meta is None:
            session_meta = event
            continue
        if event_type not in ("response_item", "compacted", "turn_context"):
            continue
        if event_type == "compacted":
            records.clear()
            record_sizes.clear()
            payload_bytes = 0
            truncated = False
        encoded_size = len(json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        records.append(event)
        record_sizes.append(encoded_size)
        payload_bytes += encoded_size
        while payload_bytes > max_payload_bytes and len(records) > 1:
            records.popleft()
            payload_bytes -= record_sizes.popleft()
            truncated = True

print(json.dumps({
    "format": "codex-rollout-context/v1",
    "path": path,
    "sessionMeta": session_meta,
    "records": list(records),
    "truncated": truncated,
    "payloadBytes": payload_bytes,
}, ensure_ascii=False, separators=(",", ":")))
`;
