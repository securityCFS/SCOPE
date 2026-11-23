# Architecture Overview

[English](./architecture.md) | [简体中文](./architecture.zh-CN.md)

SCOPE separates its browser UI from SSH execution and local secret storage:

## Directory Map

| Path | Responsibility |
| --- | --- |
| `app/` | Next.js / `vinext` root shell, theme tokens (`workspace-theme.css`), and terminal wrapper |
| `features/workspace/` | Host & project navigation sidebar, topbar, Codex account dialog, session filters, and controller hooks/actions |
| `features/conversation/` | Unified message feed, composer controls, slash command palette, permission approvals, and interactive question forms |
| `features/command-center/` | Cross-project Coordinator chat, resource overview, task queue, and Settings shell |
| `features/settings/` | Modular Settings & Management Hub (`General & Coordinator`, `Hosts & Remote Deploy`, `Agents & Accounts`, `Email & Notifications`) |
| `features/archive/` | Reversible archive & trash drawer for Codex, Claude, Antigravity, and queued tasks |
| `features/plugins/` | Dynamic plugin UI cards & local import guidance |
| `lib/` | Shared client/server helpers: config validation (`workbench-config.js`), execution host utils, Markdown/KaTeX rendering, SSH config parsing, and bilingual UI (`i18n.tsx`) |
| `bridge/server.mjs` | Local HTTP/SSE/WebSocket Bridge (`127.0.0.1:4815`), host discovery, and Codex app-server supervision |
| `bridge/providers/` | Adapters for Codex `app-server`, Claude `stream-json`, Antigravity `ACP`, and DSH headless runs |
| `bridge/remote-bootstrap/` | Cross-platform one-click remote `scope-notify` installer & multi-host SSH reverse tunnel manager |
| `bridge/routes/` | Domain HTTP route handlers (models, dialogue, runtime config, accounts, email settings, session commands) |
| `bridge/plugins/` | Plugin registry, integrity-checked external package loader, HTTP routes, and built-in Aliyun DLC monitor |
| `bridge/workbench/` | Persistent `.scope/workbench.json` store, task scheduler, coordinator context builder, and directory browser |
| `scripts/` | Launchers, standalone fixture preview (`npm run preview:fixture`), Linux server installer, and open-source leak check |
