#!/usr/bin/env bash
set -euo pipefail

# One-click SCOPE remote setup via Cloudflare Named Tunnel + Custom Domain (zero open inbound ports).
# Pair with Cloudflare Zero Trust Access (Emails-only Include allowlist) for double protection.
#
# Usage:
#   bash scripts/setup-remote-cloudflare.sh --domain scope.yourdomain.com [--port-domain scope-ports.yourdomain.com] [--tunnel scope-hub] [--port 3000] [--bridge-port 4815] [--gateway-port 4820] [--dry-run]

DOMAIN=""
PORT_DOMAIN=""
TUNNEL_NAME="scope-hub"
UI_PORT="${SCOPE_UI_PORT:-3000}"
BRIDGE_PORT="${SCOPE_BRIDGE_PORT:-4815}"
GATEWAY_PORT="${SCOPE_PRIVATE_PORT:-4820}"
STATE_DIR="${SCOPE_STATE_DIR:-$HOME/.scope}"
DRY_RUN="0"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --port-domain) PORT_DOMAIN="$2"; shift 2 ;;
    --tunnel) TUNNEL_NAME="$2"; shift 2 ;;
    --port) UI_PORT="$2"; shift 2 ;;
    --bridge-port) BRIDGE_PORT="$2"; shift 2 ;;
    --gateway-port) GATEWAY_PORT="$2"; shift 2 ;;
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN="1"; shift ;;
    -h|--help)
      echo "Usage: bash scripts/setup-remote-cloudflare.sh --domain scope.yourdomain.com [--port-domain scope-ports.yourdomain.com] [--tunnel scope-hub] [--port 3000] [--bridge-port 4815] [--gateway-port 4820] [--state-dir ~/.scope] [--dry-run]"
      exit 0
      ;;
    *)
      echo "[scope] Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$DOMAIN" ]; then
  if [ -t 0 ]; then
    printf "Enter your Cloudflare-managed custom domain (e.g. scope.yourdomain.com): "
    read -r DOMAIN
  fi
fi

if [ -z "$DOMAIN" ]; then
  echo "[scope] Missing --domain. Example: bash scripts/setup-remote-cloudflare.sh --domain scope.yourdomain.com" >&2
  exit 1
fi

echo "[scope] SCOPE One-Click Remote Setup (Cloudflare Custom Domain: $DOMAIN)"

if ! command -v node >/dev/null 2>&1; then
  echo "[scope] Node.js >= 22.13 is required. Install from https://nodejs.org/ and rerun." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[scope] Node.js >= 22.13 is required; found $(node -v)." >&2
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[scope] cloudflared was not found on PATH." >&2
  echo "        Install cloudflared first:" >&2
  echo "          macOS: brew install cloudflared" >&2
  echo "          Linux: curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared" >&2
  exit 1
fi

if ! command -v scope >/dev/null 2>&1; then
  echo "[scope] Installing @godchaser/scope globally via npm..."
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] npm install -g @godchaser/scope"
  else
    npm install -g @godchaser/scope
  fi
fi

EXPOSE_ARGS=(--domain "$DOMAIN" --tunnel "$TUNNEL_NAME" --gateway-port "$GATEWAY_PORT" --state-dir "$STATE_DIR")
SERVICE_ARGS=(--with-gateway --with-cloudflared --tunnel "$TUNNEL_NAME" --port "$UI_PORT" --bridge-port "$BRIDGE_PORT" --gateway-port "$GATEWAY_PORT" --state-dir "$STATE_DIR")
if [ -n "$PORT_DOMAIN" ]; then
  EXPOSE_ARGS+=(--port-domain "$PORT_DOMAIN")
  SERVICE_ARGS+=(--port-origin "https://${PORT_DOMAIN}")
fi

if [ "$DRY_RUN" = "1" ]; then
  scope expose cloudflare "${EXPOSE_ARGS[@]}" --dry-run
  scope service install "${SERVICE_ARGS[@]}" --dry-run
  exit 0
fi

# Step 1: Configure Cloudflare Named Tunnel + DNS CNAME + ~/.cloudflared/config.yml (0600)
scope expose cloudflare "${EXPOSE_ARGS[@]}"

# Step 2: Start persistent UI + Bridge + Private Gateway + cloudflared
if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  echo "[scope] Installing and starting systemd --user services (UI + Bridge + Private Gateway + cloudflared)..."
  scope service install "${SERVICE_ARGS[@]}"
else
  mkdir -p "$STATE_DIR"
  echo "[scope] systemd --user not available; starting SCOPE + cloudflared in background..."
  if [ -n "$PORT_DOMAIN" ]; then
    export SCOPE_PORT_ORIGIN="https://${PORT_DOMAIN}"
  fi
  nohup scope start --gateway \
    --port "$UI_PORT" \
    --bridge-port "$BRIDGE_PORT" \
    --gateway-port "$GATEWAY_PORT" \
    --state-dir "$STATE_DIR" > "$STATE_DIR/scope-remote.log" 2>&1 &
  nohup cloudflared tunnel --no-autoupdate --config "$HOME/.cloudflared/config.yml" run "$TUNNEL_NAME" > "$STATE_DIR/cloudflared.log" 2>&1 &
fi

# Step 3: Wait for Private Gateway loopback health
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
  echo "[scope] Private Gateway did not respond on 127.0.0.1:${GATEWAY_PORT}. Run 'scope service status' to inspect." >&2
  exit 1
fi

echo ""
echo "[scope] Generating a single-use 10-minute login link for https://${DOMAIN} (master token stays off URLs):"
scope token --url "https://${DOMAIN}" --state-dir "$STATE_DIR"
echo ""
echo "[scope] Next (2 minutes): Enable Cloudflare Zero Trust Access on https://${DOMAIN}"
echo "  1. Zero Trust -> Access -> Applications -> Add Self-hosted app for ${DOMAIN}"
echo "  2. Policy Include: ONLY your own Emails (never put Login Methods inside Include)"
echo "  3. Set Session Duration to 1 month so mobile browsers stay signed in"
echo "  4. Manage trusted devices anytime: scope devices list | scope devices revoke <id|--all>"
