# 邮件通知与远端一键部署

[English](./notifications-and-remote.md) | [简体中文](./notifications-and-remote.zh-CN.md)

## 1. 网页配置本机 SMTP（远端服务器免密安全）

所有的发信动作都由你本机发起，邮箱账号与授权码绝对不会离开本地电脑，更不会复制到远端训练机上。

1. 打开 **设置 → 邮件与通知**。
2. 点击常用邮箱预设（**Gmail**、**Outlook / 365**、**QQ Mail**、**163 Mail**、**Feishu / Lark**）或手填自定义 SMTP 服务器及端口（`465` 勾选 SSL/TLS，`587` 取消勾选走 STARTTLS）。
3. 填写发件登录账号、邮箱授权码（非登录密码）、收件人邮箱和防抖冷却时间，按需勾选触发场景：
   - **待人工审批 / 提问等待**：Agent 卡在网页审批或提问时提醒
   - **远端任务完成 / 失败回执**：长耗时任务跑完或报错时由远端 `scope-notify` 触发
   - **插件高失败告警**：可选插件触发告警时发送
4. 点击 **保存配置**（保存即热生效，无需重启 SCOPE），随后点 **验证 SMTP 连接** 和 **发送测试邮件** 确认收信正常。

### 凭据保存方式

- 网页保存的账号密码会以 `0600` 权限单独写入被 Git 忽略的 `.scope/email-smtp-secret.json`，与非敏感配置 `.scope/email-notifications.json` 分离。
- 同样兼容环境变量 `SCOPE_EMAIL_SMTP_USER` / `SCOPE_EMAIL_SMTP_PASS` 以及既有 Windows DPAPI `.clixml` 凭据文件。

---

## 2. 一键部署远端 `scope-notify` 服务（兼容非 root 账号）

对于跑一整夜的训练或评测任务，你可以直接把完成邮件通知工具一键部署到每台 GPU 服务器：

1. 先按上文配好本机 SMTP 并确认测试邮件能正常收到。
2. 打开 **设置 → 远程主机与部署**，选中目标主机。
3. 点击 **一键部署远端服务**。

SCOPE 会自动跨平台完成以下操作（全程不依赖 `root` 或 `sudo`）：

1. 在本机拉起带 Bearer Token 校验的邮箱中继服务（`127.0.0.1:4822`），并为该主机建立持久化 SSH 回环反向隧道（`-R 127.0.0.1:4922:127.0.0.1:4822`）。
2. 将 `scope_notify.py` 部署到远端用户的 `~/.local/share/scope-email/`，并在 `~/.local/bin/scope-notify` 创建可执行软链。
3. 写入 `~/.config/scope-email/config.json`（仅包含回环地址和随机 Token，不含任何邮箱密码）。
4. 自动检测远端是否支持 `systemd --user` 并注册 `scope-notify.service` 守护进程（若不支持则以离线队列后台进程运行，断网重连后自动补发）。
5. 自动为远端已安装的 Codex / Claude Code 注册 `scope-email` MCP 工具（`send_completion_email`），并在 `~/.codex/AGENTS.md` 与 `~/.claude/CLAUDE.md` 追加简短调用说明。

### 命令行一键管理

```sh
npm run remote:bootstrap -- inspect <主机别名>
npm run remote:bootstrap -- deploy <主机别名>
npm run remote:bootstrap -- remove <主机别名>
```
