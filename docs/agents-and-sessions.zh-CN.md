# 多 Agent 会话、交互审批与账号管理

[English](./agents-and-sessions.md) | [简体中文](./agents-and-sessions.zh-CN.md)

## 各 Agent 的接入方式

### Codex（本机与远端）

- **托管会话**：通过 Codex `app-server` 运行在远端独立的命名 `tmux` 后台守护中（`scope-app-server-*`）。关闭浏览器或重启 SCOPE 均不会中断远端会话，重启后会自动重连原 socket。
- **外部终端 / VS Code 观察**：SCOPE 通过 `/proc/<pid>/fd` 精准匹配普通终端或 VS Code 终端里打开的 rollout `.jsonl` 文件，在网页中实时同步进度，但绝不抢占原终端输入或误杀外部进程。
- **多账号池与自动故障切换**：在顶栏或 **设置 → Agent 与账号** 中打开「Codex 账号」，可为每台主机保存多套登录 Profile；当前账号额度或认证失效时可自动探测可用备用账号，并在当前回合空闲后安全热切换。
- **安全版本升级**：在 **设置 → 远程主机与部署** 中可一键检查并升级远端 npm 安装的 Codex，升级后仅对空闲托管会话执行热切换，保留原有会话 ID、工作目录和账号绑定。

### Claude Code

- **实时交互通道**：通过 Claude CLI 的 `stream-json` 双向控制协议运行，实时呈现中间思考、可折叠的工具调用记录、文件/命令审批卡片、`AskUserQuestion` 单选与多选表单、运行中追加排队消息，以及安全中断。
- **模型与权限**：从目标主机实时探测当前账号可用模型、推理强度和 `auto` 模式支持情况。支持 `auto`、`default`、`workspace`（工作区可写）和 `plan` 模式。

### Antigravity (`agy`)

- **实时交互通道**：基于 Agent Client Protocol（`ACP`）运行，支持正文流式输出、工具状态卡片、结构化表单提问、权限决策（单次允许 / 记住选择 / 拒绝）、运行中追加排队消息与取消生成。
- **模型与权限**：从目标主机的 `agy models` 动态获取模型和推理档位。支持 `default`、`workspace`（工作区沙箱）、`auto`（账号支持时可用）、`plan` 以及显式开启的 `full`（完全访问）。

---

## 斜杠命令（`/`）

在对话框输入 `/` 即可唤起命令菜单：

- **快捷设置指令**：`/model`、`/effort`、`/permissions`、`/stop`、`/help`。
- **Codex**：`/compact` 触发上下文压缩；自动读取当前工作目录的 `skills/list` 并以 `$技能名` 填入输入框。
- **Claude Code 与 Antigravity**：实时发现当前主机与目录的原生命令、技能和 MCP prompts，并按原名提交给底层 CLI 执行。

---

## 聊天框文件与图片附件

全部聊天与派发输入框（Codex 会话、Claude Code、Antigravity、总调度、新建会话弹窗、任务队列）均支持通过 **附件按钮**、**拖拽文件** 或 **剪贴板粘贴（`Ctrl+V` / `Cmd+V`）** 上传图片与文件：

- **规格限制**：单条消息最多 8 个附件，单文件不超过 50 MiB，单条总大小不超过 100 MiB。
- **传输与清理**：流式写入目标主机（含本机 `local`）的 `~/.codex/scope-attachments/` 目录，自动清理超过 7 天的临时上传。
- **传递方式**：常见光栅图片（`png`、`jpeg`、`webp`、`gif`）会同时作为 `localImage` 传给 Codex `app-server`；所有文件与图片均会在消息中附带目标主机绝对路径，供 Codex、Claude Code、Antigravity 与队列任务直接读取处理。

---

## 可逆归档（不删原生记录）

在左侧栏归档任何会话都不会删除底层对话历史：

- **Codex**：调用原生 `thread/archive` 与 `thread/unarchive` 协议。
- **Claude Code / Antigravity**：完全不修改原生历史文件，仅在 `~/.local/state/scope/` 记录归档或回收站标记。
- 所有已归档的 Codex 会话、队列任务以及 Claude/AGY 会话均统一收拢在左侧栏底部的 **已归档** 抽屉中，随时可一键恢复。

---

## 可选：持久化 Codex 目录校验

如果你在云主机上把 `~/.codex` 软链到了单独的数据盘（例如 `/mnt/storage/codex-home`），可以在 `.scope/persistent-codex-homes.json` 中配置：

```json
{
  "cloud-gpu": "/mnt/storage/codex-home"
}
```

一旦主机重启或挂载失效导致 `~/.codex` 未指向该目录，SCOPE 会拒绝启动会话以保护历史上下文。
