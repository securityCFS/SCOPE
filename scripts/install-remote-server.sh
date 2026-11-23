#!/usr/bin/env bash
set -euo pipefail

# Deploy SCOPE itself as a persistent local-loopback systemd --user service on Linux.
# Expose it remotely via SSH port forwarding (ssh -L 3000:127.0.0.1:3000 -L 4815:127.0.0.1:4815 <host>)
# or behind the built-in TLS + IP-allowlisted private/shared gateway.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${SCOPE_SYSTEMD_SERVICE:-scope-workbench}"
NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"

if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ]; then
  echo "[scope] Node.js (>= 22.13) and npm must be on PATH." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[scope] Node.js >= 22.13 is required; found $("$NODE_BIN" -v)." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[scope] python3 is required." >&2
  exit 1
fi

echo "[scope] Installing dependencies and building production UI in $REPO_DIR..."
cd "$REPO_DIR"
"$NPM_BIN" ci
"$NPM_BIN" run build

if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "[scope] systemd --user session bus is not active. You can still start SCOPE manually with:" >&2
  echo "        cd \"$REPO_DIR\" && nohup \"$NPM_BIN\" run scope -- --skip-build > .scope/scope.log 2>&1 &" >&2
  exit 0
fi

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
UNIT_FILE="$UNIT_DIR/${SERVICE_NAME}.service"

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=SCOPE Cross-Host Multi-Agent Workbench
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
ExecStart=$NODE_BIN $REPO_DIR/bridge/start.mjs --skip-build
Restart=on-failure
RestartSec=5
Environment=PATH=$PATH

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "${SERVICE_NAME}.service"

echo "[scope] Deployed and started systemd user service: ${SERVICE_NAME}.service"
echo "[scope] Local UI:     http://127.0.0.1:3000"
echo "[scope] Local Bridge: http://127.0.0.1:4815"
echo "[scope] Tip: enable linger if you want it to survive logout: loginctl enable-linger $USER"
