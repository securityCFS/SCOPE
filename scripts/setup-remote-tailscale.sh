#!/usr/bin/env bash
set -euo pipefail

# One-click SCOPE remote setup via Tailscale Serve (private tailnet HTTPS, NEVER Funnel).
# Safe to run standalone on Linux or macOS after reviewing this script.
#
# Usage:
#   bash scripts/setup-remote-tailscale.sh [--port 3000] [--bridge-port 4815] [--gateway-port 4820] [--https-port 443] [--dry-run]

UI_PORT="${SCOPE_UI_PORT:-3000}"
BRIDGE_PORT="${SCOPE_BRIDGE_PORT:-4815}"
GATEWAY_PORT="${SCOPE_PRIVATE_PORT:-4820}"
HTTPS_PORT="443"
STATE_DIR="${SCOPE_STATE_DIR:-$HOME/.scope}"
DRY_RUN="0"

while [ $# -gt 0 ]; do
  case "$1" in
    --port) UI_PORT="$2"; shift 2 ;;
    --bridge-port) BRIDGE_PORT="$2"; shift 2 ;;
    --gateway-port) GATEWAY_PORT="$2"; shift 2 ;;
    --https-port) HTTPS_PORT="$2"; shift 2 ;;
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN="1"; shift ;;
    -h|--help)
      echo "Usage: bash scripts/setup-remote-tailscale.sh [--port 3000] [--bridge-port 4815] [--gateway-port 4820] [--https-port 443] [--state-dir ~/.scope] [--dry-run]"
      exit 0
      ;;
    *)
      echo "[scope] Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

run_or_echo() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

echo "[scope] SCOPE One-Click Remote Setup (Tailscale Serve, 127.0.0.1 loopback only)"

if ! command -v node >/dev/null 2>&1; then
  echo "[scope] Node.js >= 22.13 is required. Install from https://nodejs.org/ and rerun." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[scope] Node.js >= 22.13 is required; found $(node -v)." >&2
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "[scope] Tailscale CLI was not found. Install from https://tailscale.com/download and sign in with 'tailscale up'." >&2
  exit 1
fi

if ! command -v scope >/dev/null 2>&1; then
  echo "[scope] Installing @godchaser/scope globally via npm..."
  run_or_echo npm install -g @godchaser/scope
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "[scope] Dry-run plan:"
  if command -v systemctl >/dev/null 2>&1; then
    echo "  scope service install --with-gateway --port $UI_PORT --bridge-port $BRIDGE_PORT --gateway-port $GATEWAY_PORT --state-dir $STATE_DIR"
  else
    echo "  scope start --gateway --port $UI_PORT --bridge-port $BRIDGE_PORT --gateway-port $GATEWAY_PORT --state-dir $STATE_DIR"
  fi
  echo "  scope expose tailscale --gateway-port $GATEWAY_PORT --https-port $HTTPS_PORT --state-dir $STATE_DIR"
  echo "  scope token --url https://<your-machine>.<tailnet>.ts.net --state-dir $STATE_DIR"
  exit 0
fi

# Start persistent background services on Linux systemd --user, or background process on macOS
if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  echo "[scope] Installing and starting systemd --user services (UI + Bridge + Private Gateway)..."
  scope service install \
    --with-gateway \
    --port "$UI_PORT" \
    --bridge-port "$BRIDGE_PORT" \
    --gateway-port "$GATEWAY_PORT" \
    --state-dir "$STATE_DIR"
else
  mkdir -p "$STATE_DIR"
  if ! curl -sfI "http://127.0.0.1:${GATEWAY_PORT}/" >/dev/null 2>&1; then
    echo "[scope] Starting SCOPE + Private Gateway in background (logs: $STATE_DIR/scope-remote.log)..."
    nohup scope start --gateway \
      --port "$UI_PORT" \
      --bridge-port "$BRIDGE_PORT" \
      --gateway-port "$GATEWAY_PORT" \
      --state-dir "$STATE_DIR" > "$STATE_DIR/scope-remote.log" 2>&1 &
  fi
fi

# Wait for Private Gateway loopback health (HTTP 401 expected when unauthenticated)
READY="0"
for _ in $(seq 1 20); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${GATEWAY_PORT}/" || true)"
  if [ "$CODE" = "401" ] || [ "$CODE" = "200" ]; then
    READY="1"
    break
  fi
  sleep 1
done

if [ "$READY" != "1" ]; then
  echo "[scope] Private Gateway did not respond on 127.0.0.1:${GATEWAY_PORT}. Check logs or run 'scope service status'." >&2
  exit 1
fi

echo "[scope] Exposing Private Gateway privately via Tailscale Serve (Funnel stays OFF)..."
scope expose tailscale \
  --gateway-port "$GATEWAY_PORT" \
  --https-port "$HTTPS_PORT" \
  --state-dir "$STATE_DIR"

DNS_NAME="$(tailscale status --json | node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(String(d?.Self?.DNSName || "").replace(/\.$/, ""));')"
if [ -n "$DNS_NAME" ]; then
  SUFFIX=""
  if [ "$HTTPS_PORT" != "443" ]; then
    SUFFIX=":${HTTPS_PORT}"
  fi
  PUBLIC_URL="https://${DNS_NAME}${SUFFIX}"
  echo ""
  echo "[scope] Generating a single-use 10-minute mobile login link (master token is NOT embedded in the URL):"
  scope token --url "$PUBLIC_URL" --state-dir "$STATE_DIR"
  echo ""
  echo "[scope] Manage trusted devices anytime: scope devices list | scope devices revoke <id|--all>"
  echo "[scope] Turn off Tailscale exposure anytime: scope expose tailscale --off"
fi
