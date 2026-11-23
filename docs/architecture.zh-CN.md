# 架构与模块职责

[English](./architecture.md) | [简体中文](./architecture.zh-CN.md)

SCOPE 采用“本机控制平面 + 远端原生 CLI”的分层设计，浏览器从不直接持有 SSH 私钥或邮箱密码。

## 目录结构

| 目录 / 文件 | 职责 |
| --- | --- |
| `app/` | 页面入口、浅/深色中性主题令牌（`workspace-theme.css`）及内嵌 SSH 终端组件 |
| `features/workspace/` | 主机与项目侧栏、顶栏、Codex 多账号弹窗、会话筛选及控制器状态 hooks |
| `features/conversation/` | 消息流渲染、底部输入控件、`/` 斜杠命令菜单、工具审批与提问表单 |
| `features/command-center/` | 跨项目总调度对话、主机 GPU 资源看板、任务队列与设置入口 |
| `features/settings/` | 分组设置中心（常规与总调度、远程主机与一键部署、Agent 与账号、邮件通知） |
| `features/archive/` | 统一管理 Codex、Claude、Antigravity 与队列任务的可逆归档抽屉 |
| `features/plugins/` | 动态插件表单与扩展管理界面 |
| `lib/` | 前后端共享库：配置校验（`workbench-config.js`）、路径规范化、Markdown/公式渲染、SSH 解析与中英切换（`i18n.tsx`） |
| `bridge/server.mjs` | 本机 HTTP/SSE/WS 服务（`127.0.0.1:4815`），负责主机探测与 app-server 生命周期托管 |
| `bridge/providers/` | Codex `app-server`、Claude `stream-json`、Antigravity `ACP` 与 DSH 适配器 |
| `bridge/remote-bootstrap/` | 跨平台远端一键初始化服务与多主机 SSH 反向隧道管理器 |
| `bridge/routes/` | 按领域拆分的 HTTP 路由（模型、对话、主机启动配置、账号、邮件设置、会话命令） |
| `bridge/plugins/` | 插件注册表、完整性校验加载器、HTTP 接口及内置阿里云 DLC 插件 |
| `bridge/workbench/` | `.scope/workbench.json` 持久化存储、任务队列调度器与总调度上下文构建 |
| `scripts/` | 辅助脚本、隔离 UI 预览（`npm run preview:fixture`）、Linux 服务端安装与开源脱敏扫描器 |
