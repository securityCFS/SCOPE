# Agents, Sessions & Approvals

[English](./agents-and-sessions.md) | [简体中文](./agents-and-sessions.zh-CN.md)

## How SCOPE Connects to Each Agent

### Codex (Local & Remote)

- **Managed sessions**: Run through Codex `app-server` inside a named detached `tmux` socket (`scope-app-server-*`). Closing your browser or restarting SCOPE leaves remote sessions alive; SCOPE reconnects to the existing Unix socket on restart.
- **External terminals / VS Code**: SCOPE discovers running `codex` processes via `/proc/<pid>/fd` matching open rollout `.jsonl` files and displays live transcripts read-only without interfering with your terminal input.
- **Multi-account pool & auto-failover**: Open **Accounts** from the topbar or **Settings → Agents & Accounts** to save multiple Codex auth profiles per host, switch profiles, or inspect automatic failover status when an active profile hits usage/auth limits.
- **Safe CLI upgrades**: Under **Settings → Hosts & Remote Deploy**, **Check & Upgrade Codex** backs up the existing npm-installed CLI, installs the latest stable version, checks for active turns/background commands, and gracefully reconnects idle managed sessions while leaving busy ones untouched.

### Claude Code

- **Streaming & controls**: New turns run via Claude's `stream-json` control protocol, streaming intermediate commentary, collapsible tool calls, interactive `can_use_tool` permission approvals, `AskUserQuestion` single/multi-select cards, queued follow-up messages, and clean turn interruption.
- **Models & permissions**: Available models, reasoning efforts, and `auto` mode support are probed dynamically from the target host's installed CLI. Supported modes: `auto`, `default`, `workspace` (`acceptEdits`), and `plan`.

### Antigravity (`agy`)

- **Streaming & controls**: Runs via the Agent Client Protocol (`ACP`), streaming live text and tool cards, structured elicitation forms, permission choices (allow once / remember / deny), queued messages, and cancellation.
- **Models & permissions**: Models and effort levels are read dynamically from `agy models` on the selected host. Permission modes include `default`, `workspace` (`accept-edits` + sandbox), `auto` (when supported by your account), `plan`, and explicit `full` (`--dangerously-skip-permissions`).

---

## Slash Commands (`/`)

Type `/` in the conversation composer to open the command palette:

- **Built-in UI shortcuts**: `/model`, `/effort`, `/permissions`, `/stop`, `/help`.
- **Codex**: `/compact` invokes `thread/compact/start`; project skills discovered via `skills/list` insert `$<skill-name>`.
- **Claude Code & Antigravity**: Discovers native CLI commands, skills, and MCP prompts on the selected host & directory and sends them unmodified to the underlying CLI.

---

## File & Image Attachments

All chat and prompt composers (Codex active sessions, Claude Code, Antigravity, Coordinator, New Conversation, and Task Queue) support uploading files and images via the **Attach** button, drag-and-drop, or clipboard paste (`Ctrl+V` / `Cmd+V`):

- **Limits**: Up to 8 files per message, 50 MiB per file, 100 MiB total per turn.
- **Storage**: Streams directly to `~/.codex/scope-attachments/` on the target host (or local machine when running on `local`), with automatic 7-day cleanup.
- **Delivery**: Raster images (`png`, `jpeg`, `webp`, `gif`) are passed directly as structured `localImage` inputs to Codex `app-server`, while all attachments include their exact target-host absolute paths in the turn prompt so Codex, Claude Code, Antigravity, and queued jobs can read them directly.

---

## Reversible Session Archiving

Archiving any Codex, Claude Code, or Antigravity session in the left sidebar is **non-destructive**:

- Codex uses `thread/archive` and `thread/unarchive`.
- Claude Code and Antigravity keep their native files untouched and store SCOPE archive/trash metadata separately under `~/.local/state/scope/`.
- You can restore any archived or trashed session from the unified **Archived** drawer at the bottom of the left sidebar.

---

## Optional: Persistent Codex Home Guard

If you symlink `~/.codex` to a separate persistent volume on a cloud instance (for example `/mnt/storage/codex-home`), you can prevent SCOPE from touching ephemeral container storage when a mount drops by adding `.scope/persistent-codex-homes.json`:

```json
{
  "my-cloud-gpu": "/mnt/storage/codex-home"
}
```

If `~/.codex` no longer resolves to that path, SCOPE refuses to spawn sessions on that host until the mount is restored.
