# Changelog

All notable changes to **SCOPE** (`@godchaser/scope`, formerly `scope-agent-workbench`) are documented in this file.

## [0.2.6] — 2026-11-27

### Security

- **Isolated port-proxy origin**: Set `SCOPE_PORT_ORIGIN` (or `--port-origin`) to serve `/scope-port/*` from a separate hostname. The control-plane origin then never executes forwarded apps; it issues a single-use 60-second ticket and redirects to the port origin, which only serves `/scope-port/*` with its own `scope_port` cookie and has no access to `/scope-api`. Sign-out and device revocation drop all port sessions. `scope expose cloudflare --port-domain` and `scope service install --port-origin` configure it.
- **Port proxy hardening (always on)**: Forwarded responses can no longer set `Service-Worker-Allowed` or `Clear-Site-Data`, service-worker script fetches through `/scope-port` are refused, and the `scope_port` cookie is neither forwarded to nor settable by proxied apps.
- **nodemailer 10.6.1**: Upgrade from `^9` to `^10.6.1`, clearing 12 published advisories affecting `<=10.1.3` (SMTP credential disclosure via shared TLS servername cache, parser DoS, header injection). The only breaking change upstream is Node.js >= 20, already below SCOPE's `>=22.13` floor (`npm audit --omit=dev` now reports 0 vulnerabilities).

### Added

- **One-Click Remote Launch Scripts**: Added `scripts/setup-remote-tailscale.sh` (Linux/macOS Tailscale Serve), `scripts/setup-remote-cloudflare.sh` (Linux/macOS Cloudflare Tunnel with optional `--port-domain` separate-origin isolation), and `scripts/setup-remote-cloudflare.ps1` (Windows PowerShell with optional `-PortDomain`), all supporting `--dry-run` / `-DryRun` and printing single-use `?scope_login=` URLs.
- **Security & Lightweight Homepage Overhaul (`site/`)**: Highlighted Claude Code official `claude -p /usage` zero-credential-read protocol, single-use login codes and revocable trusted devices, separate-origin `/scope-port/` isolation, 2-dependency `4.3 MB` runtime footprint with 0 production advisories, and interactive Tailscale vs. Cloudflare Tunnel setup tabs with bilingual docs links.

### Fixed

- `scope expose` hints now print `scope token --url` (single-use links) instead of the removed `--show --url` flow.
- **Homepage iPhone Mobile Layout (`375px` / `390px`)**: Fixed quickstart code card horizontal overflow inside `.cta-banner`, responsive wrapping in the Subagent Workflow mockup row, compact `375px` navbar spacing, and single-line Hero kicker/command bar scaling.

## [0.2.5] — 2026-11-27

### Fixed

- **WebKit / iOS Safari Private Gateway Login (`Origin: null`)**: Switched gateway `Referrer-Policy` from `no-referrer` to `same-origin` and accepted same-origin opaque `Origin: null` login form submissions (while continuing to block cross-site requests with `403`).
- **Normalized npm `bin` Metadata**: Normalized `package.json` `bin` paths to `bin/scope.mjs` for npm 11/12 OIDC Trusted Publishing compatibility.

## [0.2.4] — 2026-11-27

### Added

- **Scoped npm Package (`@godchaser/scope`) & Remote Access CLI**: Added `scope start --gateway`, `scope gateway`, `scope token [--show|--rotate|--url]`, `scope devices [list|revoke]`, `scope expose tailscale`, `scope expose cloudflare --domain <fqdn>`, and `scope service <install|status|restart|uninstall>` with bilingual Tailscale Serve and Cloudflare Custom Domain + Zero Trust Access setup guides (`docs/remote-access.md`, `docs/remote-access.zh-CN.md`).
- **Persistent Trusted Devices (`SameSite=Lax` + 90-Day Sliding Renewal)**:
  - Issues per-device cryptographic credentials stored hashed in `.scope/private-access.json` (`0600`) with 90-day sliding `HttpOnly; Secure; SameSite=Lax` cookies and `autocomplete="username"` for iOS iCloud Keychain autofill.
  - Adds **Settings -> General -> Trusted Devices** UI (view, rename, trust temporary session, revoke single/other devices, sign out) and live hot-reloading CLI management (`scope devices list`, `scope devices revoke <id|--all>`).
- **Authenticated Remote Port Proxy (`/scope-port/<port>/`) & `@local` Port Exposure**:
  - Proxies active SCOPE-forwarded SSH ports and verified Linux `@local` listeners over the Private Gateway with HTTP/HTML `<base>` rewriting, redirect rewriting, scoped cookies, WebSocket upgrades (`wss://`), strict allowlist enforcement, and control-port blocking.
- **POSIX `@local` Native CLI & Isolated AGY Profiles**: Enables direct `@local` Claude Code / Antigravity sessions on Linux/macOS and discovers isolated `~/.agy-profiles/*` profiles with live quotas.
- **Official SCOPE Homepage (`site/`)**: Adds static landing page and automated GitHub Pages publishing workflow (`.github/workflows/pages.yml`).

### Changed

- **Claude Code quota via official `/usage`**: Claude 5h / weekly / per-model quotas are now read from the unmodified Claude Code binary (`claude -p /usage --output-format json --no-session-persistence --strict-mcp-config`, zero tokens). SCOPE no longer reads `~/.claude/.credentials.json` or the macOS keychain and no longer calls Anthropic's OAuth usage endpoint with the user's token, in line with Anthropic's policy that third-party tools must not collect or intermediate Claude.ai credentials. Extra-usage credit balances are no longer shown for Claude.

### Security

- **Single-use login URLs**: `scope token --url <https://host>` now prints a `?scope_login=` link with a one-time code that expires after 10 minutes and is consumed on first use; the master access token never appears in a URL (use `--show` to print it for manual entry). Legacy `?token=<master token>` links are stripped from the address bar but no longer sign in. The Windows `enable-private-access.ps1` bootstrap uses the same single-use links.
- **Revocable temporary gateway sessions**: Untrusted-device logins no longer receive a cookie deterministically derived from the master access token (which could never be revoked short of rotating the token). Each login now mints a random secret held only in gateway memory with a 24h server-side expiry; **Sign out**, **Revoke others**, upgrading to a trusted device, or restarting the gateway invalidates it. Cookies issued by older versions stop working, so every browser must sign in once after upgrading.

### Fixed

- **Mobile & iPhone Layout Overhaul**:
  - Overhauled responsive layout, touch targets, drawer UX, safe-area padding, and iOS PWA viewport handling (`100dvh`, `16px` focus inputs).
  - Fixed Claude Code & Codex subagent text overlapping buttons on mobile (`agent-interaction-card` two-row full-width layout, full untruncated subagent names in `.native-task-subagents`, stacked `.subagent-drawer-header`, full-width single-line `.subagent-switcher-select`, single-line group counts).
  - Portaled the Port Forwards popover to `.monitor-shell` with a mobile bottom sheet (eliminating iOS Safari horizontal-scroll bleed-through), stacked Accounts provider tabs cleanly, scoped mobile send button sizing, centered floating composer popovers, and hid desktop-only keyboard shortcut hints on phones.

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
