# Email Notifications & One-Click Remote Bootstrap

[English](./notifications-and-remote.md) | [简体中文](./notifications-and-remote.zh-CN.md)

## 1. Local SMTP Configuration (Zero Credentials on Remote Servers)

SCOPE sends notification emails from your local workstation only—your SMTP password never leaves your machine and is never uploaded to GPU servers.

1. Open **Settings → Email & Notifications**.
2. Pick a provider preset (**Gmail**, **Outlook / 365**, **QQ Mail**, **163 Mail**, **Feishu / Lark**) or enter your custom SMTP host and port (`465` SSL/TLS or `587` STARTTLS).
3. Enter your SMTP username and app password/token, recipient address(es), cooldown window, and choose which events trigger alerts:
   - **Pending approvals & questions** (`humanRequests`)
   - **Remote completion / failure alerts** (`agentCompletion`, via `scope-notify`)
   - **Plugin alert notifications** (`dlcAlerts`)
4. Click **Save settings** (hot-reloads immediately without restarting SCOPE), then click **Verify connection** and **Send test email**.

### How Secrets Are Stored

- Your SMTP username and password are saved locally in `.scope/email-smtp-secret.json` (`chmod 0600`), separate from `.scope/email-notifications.json`.
- You can also provide credentials via environment variables (`SCOPE_EMAIL_SMTP_USER` and `SCOPE_EMAIL_SMTP_PASS`) or an existing Windows DPAPI `.clixml` file (`credentialFile` in `.scope/email-notifications.json`), which take precedence if configured.

---

## 2. One-Click Remote `scope-notify` Bootstrap (Root or Non-Root)

Long training runs or unattended evaluations on remote GPU hosts can notify you the moment they finish or hit an error, using a loopback-only SSH reverse tunnel back to your local relay.

### Setup From the UI

1. Configure your local SMTP settings first (above).
2. Open **Settings → Hosts & Remote Deploy**.
3. Select a reachable remote SSH host and click **Inspect host** (optional) or **One-click deploy**.

SCOPE will automatically:

1. Start the local authenticated HTTP relay (`127.0.0.1:4822`) and open a persistent SSH reverse tunnel (`-R 127.0.0.1:4922:127.0.0.1:4822`) for that host.
2. Install `scope_notify.py` into `~/.local/share/scope-email/` and link `~/.local/bin/scope-notify` (works without `root` or `sudo`).
3. Write `~/.config/scope-email/config.json` (`0600`) with a per-workstation bearer token—never SMTP passwords.
4. Register a `systemd --user` service (`scope-notify.service`) when available, or fall back to a detached retry daemon to flush queued messages if the tunnel temporarily drops.
5. Register the `scope-email` stdio MCP tool (`send_completion_email`) with Codex and Claude Code if installed, and add a short usage note in `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`.

### Setup From the CLI

```sh
npm run remote:bootstrap -- inspect <ssh-host>
npm run remote:bootstrap -- deploy <ssh-host>
npm run remote:bootstrap -- remove <ssh-host>
```
