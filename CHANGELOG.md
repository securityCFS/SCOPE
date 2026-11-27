# Changelog

All notable changes to **SCOPE** (`scope-agent-workbench`) are documented in this file.

## [Unreleased]

### Changed

- **Claude Code quota via official `/usage`**: Claude 5h / weekly / per-model quotas are now read from the unmodified Claude Code binary (`claude -p /usage --output-format json --no-session-persistence --strict-mcp-config`, zero tokens). SCOPE no longer reads `~/.claude/.credentials.json` or the macOS keychain and no longer calls Anthropic's OAuth usage endpoint with the user's token, in line with Anthropic's policy that third-party tools must not collect or intermediate Claude.ai credentials. Extra-usage credit balances are no longer shown for Claude.

### Security

- **Single-use login URLs**: `scope token --url <https://host>` now prints a `?scope_login=` link with a one-time code that expires after 10 minutes and is consumed on first use; the master access token never appears in a URL (use `--show` to print it for manual entry). Legacy `?token=<master token>` links are stripped from the address bar but no longer sign in. The Windows `enable-private-access.ps1` bootstrap uses the same single-use links.
- **Revocable temporary gateway sessions**: Untrusted-device logins no longer receive a cookie deterministically derived from the master access token (which could never be revoked short of rotating the token). Each login now mints a random secret held only in gateway memory with a 24h server-side expiry; **Sign out**, **Revoke others**, upgrading to a trusted device, or restarting the gateway invalidates it. Cookies issued by older versions stop working, so every browser must sign in once after upgrading.

## [0.2.3] — 2026-11-25

### Added

- **Collapsible Long User Messages**: Long user-sent prompts (rendered height `> 216px`) across **Codex**, **Claude Code**, **Antigravity**, and **Manager Chat** now auto-collapse to a clean 5–6 line preview (`156px`) with a smooth bottom gradient fade and one-click **Expand · N lines / chars** / **Collapse** pill button, leaving short messages completely untouched.
- **Unified One-Click Message Copy**: Added a shared copy button beneath user and assistant messages across **Claude Code**, **Antigravity**, **Codex**, and **Manager Chat**, with 1.8s **Copied** auto-reset and a `document.execCommand("copy")` fallback for non-HTTPS LAN access.

## [0.2.2] — 2026-11-25

### Added

- **Parent ↔ Subsession Bidirectional Interaction Timeline (Claude Code & Codex)**:
  - Surfaces dispatched task instructions (`promptPreview`), subagent handback reports (`SubagentHandback` / `<agent-message>`), cross-session `SendMessage` / `send_message` / `send_input` / `wait_agent` exchanges, and `<task-notification>` / `<subagent_notification>` cards chronologically inside the conversation feed with clean Markdown rendering, deduplication, encrypted payload handling, and one-click **Inspect workflow** drawer links.
  - Displays follow-up parent prompts (`Follow-up prompt from parent`) inside the subagent workflow drawer and resolves native disk subagents cleanly for SCOPE-launched `cli:` Claude Code sessions.
- **Session Subagents Directory & Inline Per-Task Cards**:
  - Upgrades the right slide-over drawer into a dual-mode **Session Subagents Directory Overview** (with search and per-task grouping) ↔ **Step-by-Step Workflow Detail** (`All subagents` back button, dropdown switcher, prev/next arrows, step category filters, and Expand/Collapse all).
  - Renders inline **`Spawned N subagents`** cards directly inside each task turn showing exact subagent names, types, models, statuses, and dispatched prompt previews.
- **External Terminal Lock Detection & Read-Only Mode (Claude Code & Antigravity)**:
  - Detects active non-SCOPE, non-tmux terminal sessions via `~/.claude/sessions/*.json` + `/proc` + `tmux` (Claude Code) and `~/.gemini/antigravity-cli/presence/*.lock` `fcntl.flock` + `/proc/<pid>/fd` (Antigravity).
  - Marks externally locked sessions with a sidebar **`TTY`** badge (disabling archive), an amber header lock pill (`Terminal locked · pts/N`), a read-only banner with **Check unlock**, disabled composer input, and 4-second live tail auto-refresh while locked.
- **Subagent Display Toggles (Sliding Switch UI)**:
  - Adds four instant-apply `localStorage`-persisted display switches (`Inline spawn cards`, `Parent ↔ subagent feed`, `Auto-expand handbacks`, `Header shortcut badge`) with custom theme-aware sliding toggle switches in both **Settings → General → Subagent Display** and the drawer header **`Display`** tray.

### Fixed

- **Subagent Workflow Drawer Scrolling**: Fixed a flexbox shrinking bug in `.subagent-drawer-body` that squished long 60–160+ step timelines into overlapping slivers instead of scrolling smoothly.
- **Large Claude History Streaming**: Raised the tail streaming budget in `probe.py` to 24 MB while skipping oversized `api-request*` / `data-flow-records` payloads so long sessions retain complete subagent discovery and interaction history.

## [0.2.1] — 2026-11-24

### Added

- **Subagent Workflow Drawer for Claude Code & Codex**: Click any subagent row or the header **`Subagents · N`** button in a Claude Code or Codex session to open a right slide-over inspector drawer displaying the full step-by-step workflow timeline — task prompt, thinking/reasoning duration, shell commands & tool calls with concise summaries and expandable input/output, `SubagentHandback` Markdown reports, rich-media Markdown replies (KaTeX, GFM tables, inline images/videos, `file://` links), sibling subagent switcher tabs, and live auto-refresh while running.
- **Claude Code Subagent Parsing & Live Buffering**:
  - Streams `agent-*.jsonl` + companion `agent-*.meta.json` on demand via `GET /api/session-catalog/subagent-workflow` (skips large API request blobs, strips base64 images, caps oversized tool outputs, matches `tool_use_id`, supports `agent-*` and `toolUseId` lookup, strict path containment, and `version` cache short-circuiting).
  - Preserves live `parent_tool_use_id` thinking, tool calls/results, and streaming text deltas in `claude-interactive.py` so active subagents update in real time before disk flush.
- **Codex Subagent Discovery & Authorized Inspection**:
  - Automatically discovers and attaches child subagent rollouts (`source.subagent.thread_spawn`) onto live CLI, App Server, cached historical, and catalog-selected Codex parent sessions without cluttering the root session list.
  - Extends `POST /api/dialogue` with ownership-verified `subagentId` reading and earlier-step pagination across both remote SSH and local hosts.
- **Interactive Preview Fixtures**: Updated `scope preview` with synthetic Claude Code and Codex subagent workflows so the slide-over drawer can be explored offline with zero SSH.

## [0.2.0] — 2026-11-24

Initial public open-source release of **SCOPE — One monitor for all agent sessions.**

### Highlights

- **Unified Multi-Agent Workbench**: Monitor, resume, and steer **Codex** (`app-server` & local), **Claude Code** (`stream-json`), and **Antigravity (`agy` ACP)** sessions across your workstation and remote Linux SSH GPU servers from one local-first Web UI (`127.0.0.1`).
- **Live Background Subagents & Interactive Approvals**: Track real-time background subagent execution for Claude Code and Antigravity, handle file/command approval cards and interactive forms (`requestUserInput`, `AskUserQuestion`, ACP forms), switch models/reasoning effort, and attach files safely.
- **3-Agent Account Hub & Live `/usage` Quotas**: Inspect remaining 5-hour / 7-day subscription quotas for Codex (with multi-profile pool & automatic failover), Claude Code (host-local OAuth usage probe without exporting tokens), and Antigravity (`agy -p /usage --output-format json` grouped model quotas), plus built-in Web SSH Terminal login.
- **Rich-Media Rendering & 3-Client SCOPE Protocol Sync**: Native KaTeX math, GFM pipe tables, inline remote image previews, range-streamed HTML5 video playback (`.mp4`/`.webm`/`.m4v`/`.ogv`/`.mov`), and clickable `file://` line links across Codex, Claude Code, and Antigravity. One-click **Sync SCOPE Protocol** injects operator identity and formatting rules idempotently into `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, and `~/.gemini/config/GEMINI.md`.
- **GPU Ownership & Session Concurrency Pool**: Real-time `nvidia-smi` telemetry and training process-tree matching, per-host resident session pools (`residentSessionsPerHost`), and explicit **Pin / Reserve** session protection.
- **Independent CLI Update Proxy & Safe Codex Upgrade**: Configure separate shell commands for agent runtime traffic (`preLaunchCommand`) vs. CLI version checks and updates (`updatePreCommand`), with backup-guarded Codex hot-upgrade and interactive alias support.
- **npm Package & `scope` CLI**: Install globally (`npm install -g scope-agent-workbench`) or launch via `npx scope-agent-workbench` with prebuilt UI assets, minimal runtime dependencies (`nodemailer`, `ws`), `scope preview`, `scope bootstrap`, and `scope plugin`.
- **Complete Bilingual Documentation & Plugin Protocol v1**: English and Simplified Chinese deployment, plugin development, and quickstart guides, plus zero-PII bilingual interactive demos and leak-check tooling (`npm run export:opensource -- --check`).
