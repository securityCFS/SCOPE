# Changelog

All notable changes to **SCOPE** (`scope-agent-workbench`) are documented in this file.

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
