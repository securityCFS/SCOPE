# Changelog

All notable changes to **SCOPE** (`scope-agent-workbench`) are documented in this file.

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
