# Getting Started & Deployment

[English](./getting-started.md) | [简体中文](./getting-started.zh-CN.md)

> Looking for the full production, gateway, concurrency pool, multi-agent quota, and operations reference? See the **[Complete Deployment Guide](./deployment.md)**.

## 1. SSH Configuration

SCOPE discovers your remote Linux machines directly from `~/.ssh/config` (or the path in `SCOPE_SSH_CONFIG`). Make sure non-interactive SSH works before opening the UI:

```sh
ssh -T -o BatchMode=yes -o ConnectTimeout=5 <your-host-alias> "python3 --version"
```

Wildcard entries (`Host *`) are ignored during host discovery so SCOPE only connects to explicit host aliases.

---

## 2. Outbound Proxy & Environment Setup (Per-Host / Per-Agent)

SCOPE never injects hardcoded proxy commands. Every host and agent launches directly by default.

If a server requires an HTTP/SOCKS proxy or environment script before calling an LLM API:

1. Open **Settings → Hosts & Remote Deploy**.
2. Pick your host and fill in **Pre-launch command**, for example:
   ```sh
   export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890
   ```
   or:
   ```sh
   source ~/.proxy_env
   ```
3. Click **Save host setup**.

If a specific agent needs a different command from the rest of the host, set **Agent pre-launch override** under **Settings → Agents & Accounts** (leaving it blank inherits the host setting). If a pre-launch command exits non-zero, SCOPE aborts launch instead of silently falling back to a direct connection.

---

## 3. Running SCOPE Locally vs. on a Linux Server

### Mode A: Workstation Mode (Default)

Run `npm run scope` on your laptop/desktop (Windows, macOS, or Linux). UI (`http://127.0.0.1:3000`) and Bridge (`http://127.0.0.1:4815`) stay bound to loopback and talk to your GPU machines over OpenSSH.

For development with hot-reload:

```sh
npm run scope:dev
```

### Mode B: Persistent Linux Server Install

If you prefer running SCOPE continuously on a Linux jump host or workstation and forwarding ports to your browser:

```sh
bash scripts/install-remote-server.sh
```

This builds the production UI and installs a `systemd --user` service (`scope-workbench.service`) bound to `127.0.0.1`. Access it safely from your laptop over SSH port forwarding:

```sh
ssh -N -L 3000:127.0.0.1:3000 -L 4815:127.0.0.1:4815 <jump-host>
```

---

## 4. Private & LAN Access Gateways

Never bind the main Bridge (`4815`) or UI (`3000`) to `0.0.0.0` directly.

### Tailscale Serve (Loopback Proxy + Token Auth)

```sh
npm run scope
npm run private-gateway
tailscale serve --bg http://127.0.0.1:4880
```

Your random access token is generated in `.scope/private-access.json`. Use Tailscale **Serve** (tailnet-only), never public Funnel.

### Restricted LAN Gateway (HTTPS + Client IP Allowlist)

Create `.scope/shared-access/config.json`:

```json
{
  "host": "192.168.1.50",
  "port": 8844,
  "allowedClients": ["192.168.1.60"]
}
```

Place your TLS certificate (`server.crt`) and key (`server.key`) in `.scope/shared-access/`, then start:

```sh
npm run shared-gateway
```

The access token is auto-created in `.scope/shared-access/access.json`. Connections outside `allowedClients` receive `403`, and unauthenticated requests receive `401`.
