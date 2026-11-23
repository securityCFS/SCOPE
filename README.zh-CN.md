<p align="center">
  <img src="./docs/assets/scope-hero-anime.jpg" alt="SCOPE — One monitor for all agent sessions." width="100%" />
</p>

<h1 align="center">SCOPE</h1>

<p align="center">
  <strong>One monitor for all agent sessions.</strong><br/>
  用一个本机优先的网页工作台，统一监控与驾驭本机及多台 Linux SSH GPU 服务器上的 <b>Codex</b>、<b>Claude Code</b> 与 <b>Antigravity (<code>agy</code>)</b> 会话。
</p>

<p align="center">
  <a href="./README.md">English</a> · <b>简体中文</b> ·
  <a href="./docs/deployment.zh-CN.md">完备部署指南</a> ·
  <a href="./docs/plugin-protocol.zh-CN.md">插件接入指南</a>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg" alt="Node.js >= 22.13" /></a>
  <img src="https://img.shields.io/badge/agents-Codex%20%7C%20Claude%20Code%20%7C%20Antigravity-6366f1.svg" alt="支持 Agent" />
  <img src="https://img.shields.io/badge/bind-127.0.0.1%20loopback-0ea5e9.svg" alt="本机回环监听" />
</p>

---

## 实机交互体验演示

<p align="center">
  <img src="./docs/assets/scope-demo.gif" alt="SCOPE 实机交互演示（全程脱敏虚拟数据）" width="100%" />
</p>

<p align="center">
  <sub>基于 <code>npm run preview:fixture</code> 隔离虚拟数据录制（零真实会话与隐私）：多 Agent 会话与 KaTeX 公式 → Claude 后台子代理与审批卡片 → 三 Agent <code>/usage</code> 实时额度中心 → 4× A100 GPU 负载与离线节点折叠 → 深色模式切换。</sub>
</p>

| 浅色模式（公式渲染 · 常驻并发池 · 额度条） | 深色模式（后台子代理实时追踪 · 交互审批） |
| :---: | :---: |
| <img src="./docs/assets/scope-preview-light.png" alt="SCOPE 浅色模式预览" width="100%" /> | <img src="./docs/assets/scope-preview-dark.png" alt="SCOPE 深色模式预览" width="100%" /> |

---

## 核心特性

- **One monitor for all agent sessions**：零侵入扫描你在终端、VS Code 或 `tmux` 里启动过的原生会话（`~/.codex/sessions`、`~/.claude/projects`、`~/.gemini/antigravity-cli`），直接按原生会话 ID 续聊，不破坏原有 CLI 历史。
- **实时流式交互、审批与后台子代理**：支持 Codex、Claude Code 和 Antigravity 的文件修改/命令审批、交互问答卡片、运行中追加消息、模型/推理强度切换、安全中断，以及 **Claude Code / Antigravity 后台子代理实时工作状态** 追踪。
- **多 Agent 账号中心与实时 `/usage` 额度**：统一查看 **Codex**（多 Profile 池 + 故障自动切换 + 5h/周额度）、**Claude Code**（本地 OAuth 实时 5h/7d 额度）和 **Antigravity**（官方 `agy -p /usage --output-format json` 分组 5h/周额度）的登录态与余量，并支持一键打开内置 Web SSH 终端登录/切换账号。
- **GPU 归属与会话并发池**：实时采集各主机 `nvidia-smi` 显存/利用率和训练进程树，自动关联到对应 Agent 会话；提供按主机的常驻会话并发池（`residentSessionsPerHost`）与会话 **保留（Pin）** 机制，避免重要长程任务被误回收。
- **跨项目总调度（Coordinator）**：只读汇总各主机状态、会话进展和 GPU 资源，在一个对话框里对比实验、定位异常或起草下一步任务。
- **本机优先、零硬编码密钥**：所有 SSH 主机、出口代理命令（`preLaunchCommand`）、SMTP 凭据、网关令牌与本地防泄漏词表全部存放在 Git 忽略的 `.scope/` 目录中。

```mermaid
flowchart LR
  UI["浏览器工作台 (127.0.0.1:3000)\n浅/深色主题 · 中/英文切换"] <-->|HTTP / SSE / WS| Bridge["本机 Bridge (127.0.0.1:4815)\nSSH 调度 · 额度探测 · 插件 · 邮件中继"]
  Bridge -->|本机 app-server / 探测| Local["当前工作电脑"]
  Bridge -->|OpenSSH| Remote1["GPU 主机 A (Linux)\nCodex · Claude · AGY · GPUs"]
  Bridge -->|OpenSSH| Remote2["GPU 主机 B (Linux)\nCodex · Claude · AGY · GPUs"]
  Remote1 -.->|"回环 SSH -R 隧道\n(scope-notify MCP)"| Bridge
```

---

## Agent 能力矩阵

<p align="center">
  <img src="./docs/assets/scope-agents-anime.jpg" alt="SCOPE 协同编排 Codex、Claude Code 与 Antigravity" width="92%" />
</p>

| 能力 | Codex | Claude Code | Antigravity (`agy`) | DSH |
| --- | --- | --- | --- | --- |
| 实时流式对话与原生续聊 | 支持（`app-server` 与本机） | 支持（`stream-json`） | 支持（`ACP`） | Headless 单次任务 |
| 网页审批与提问表单 | 支持 | 支持 | 支持 | — |
| 模型与推理强度切换 | 支持 | 支持 | 支持 | 由远端 profile 控制 |
| 订阅剩余额度实时查询（`/usage`） | 支持（5h/周 + 多账号） | 支持（5h/7d OAuth 实时用量） | 支持（分组 5h/周实时额度） | — |
| 后台子代理实时状态显示 | Rollout 子代理树 | 支持（实时 + `subagents/`） | 支持（ACP + 子会话日志） | — |
| `/` 命令与项目技能 | 支持（`skills/list` + `/compact`） | 支持（实时读取 CLI 命令） | 支持（ACP 会话命令） | — |
| 外部终端 / VS Code 会话观察 | 支持（只读观察） | 历史扫描 | 历史扫描 | — |
| 网页检查 / 安装 / 更新 CLI | 支持（含安全热切换） | 支持 | 支持版本检查 | 支持 |

---

## 快速开始

### 环境要求

- **控制端电脑**：Windows / macOS / Linux，已安装 **Node.js `>= 22.13`**、**Python 3** 和 **OpenSSH 客户端（`ssh`）**
- **远端主机**：Linux，已安装 **Python 3**、配置免密 SSH 登录（`BatchMode=yes` 可直连），Codex 托管会话建议安装 `tmux`
- **Agent CLI**：在目标机器上预先安装并登录对应工具（`codex`、`claude`、`agy` 或可选 `dsh`）

### 本机启动

```sh
git clone <本仓库地址> scope
cd scope
npm ci
npm run scope
```

打开 **http://localhost:3000/**。前端（`3000`）与 Bridge（`4815`）默认只监听 `127.0.0.1`。

> 想先免配 SSH 体验完整界面？直接运行 `npm run preview:fixture`，然后访问 `http://127.0.0.2:3001/`。

---

## 可选本地配置

所有运行态数据——主机启动前命令、SMTP 凭据（`0600`）、远程隧道、网关密钥与已导入插件——全部存放在 Git 忽略的 `.scope/` 目录中：

- 如需开启实验任务队列（`taskQueue`）或预配置内置集群主机，可复制 `examples/deployment.example.json` 为 `.scope/deployment.json`。
- 如需在执行 `npm run export:opensource -- --check` 时拦截团队内网 IP、主机名或代号，可复制 `examples/leak-denylist.example.json` 为 `.scope/leak-denylist.json`。

---

## 完整文档导航

- **[完备部署指南](./docs/deployment.zh-CN.md)** — 本机模式、Linux `systemd --user` 常驻部署、Tailscale / 局域网 HTTPS 私有网关、代理与环境配置、并发池、多 Agent 额度、运维排障与安全清单
- **[插件接入与开发指南 (v1)](./docs/plugin-protocol.zh-CN.md)** — 从零编写、校验、安装、调用与卸载 SCOPE 插件的完整手册（含协议字段、生命周期、HTTP API、扩展新 Agent 说明）
- [快速上手速查](./docs/getting-started.zh-CN.md) — 精简版启动与 SSH 配置说明
- [多 Agent 会话、审批与账号管理](./docs/agents-and-sessions.zh-CN.md) — Codex 多账号故障切换、Claude/AGY 实时交互、附件上传与可逆归档
- [邮件通知与远端一键初始化](./docs/notifications-and-remote.zh-CN.md) — Web SMTP 预设、本地 `0600` 凭据与非 root 的 `scope-notify` 部署
- [架构说明](./docs/architecture.zh-CN.md) — 前后端目录与模块职责
- [贡献指南](./CONTRIBUTING.md) · [安全说明](./SECURITY.md)

---

## 本地校验

```sh
npm run typecheck
npm run build
npm run test:unit
npm run lint
npm run export:opensource -- --check
```

## 开源协议

[MIT](./LICENSE)
