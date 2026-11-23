# 快速上手与部署指南

[English](./getting-started.md) | [简体中文](./getting-started.zh-CN.md)

> 需要包含网络架构、三种部署模式、常驻并发池、多 Agent 实时额度、环境变量、运维排障与安全清单的完整文档，请参阅 **[完备部署指南](./deployment.zh-CN.md)**。

## 1. 准备 SSH 主机列表

SCOPE 会自动读取本机 `~/.ssh/config`（或环境变量 `SCOPE_SSH_CONFIG` 指定的路径），并过滤掉 `Host *` 这类通配符段。启动前先确认目标机器能免密直连：

```sh
ssh -T -o BatchMode=yes -o ConnectTimeout=5 <你的主机别名> "python3 --version"
```

---

## 2. 配置出口代理与初始化命令（完全自定义）

开源版没有任何写死的代理命令，默认全部直连。如果你的训练机需要加载代理、Conda 或特定 PATH 才能调用模型：

1. 打开 **设置 → 远程主机与部署**。
2. 选择对应服务器，在 **启动前命令（Pre-launch command）** 中填写你自己的脚本，例如：
   ```sh
   export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890
   ```
   或者：
   ```sh
   source ~/.proxy_env
   ```
3. 点击 **保存主机环境**。

如果某个 Agent 需要单独覆盖，可在 **设置 → Agent 与账号** 中填写该 Agent 的专属启动前命令（留空则自动沿用主机配置）。只要启动前命令返回非零退出码，SCOPE 会立即中止启动，不会悄悄回退为直连。

---

## 3. 本机运行 vs. 部署到 Linux 服务器常驻

### 方式 A：本机控制端（推荐日常使用）

直接在你常用的 Windows / macOS / Linux 电脑上运行：

```sh
npm run scope
```

页面（`3000`）和 Bridge（`4815`）只监听 `127.0.0.1`，所有远端操作通过你本机的 SSH 凭据执行。开发调试热更新可使用 `npm run scope:dev`。

### 方式 B：一键安装到远端 Linux 服务器常驻

如果你想把整套 SCOPE 常驻部署在跳板机或某台 Linux 主机上：

```sh
bash scripts/install-remote-server.sh
```

脚本会自动完成依赖安装、生产构建，并注册 `systemd --user` 用户级服务（`scope-workbench.service`），依然绑定在 `127.0.0.1`。之后在你自己的电脑上用 SSH 端口转发安全访问：

```sh
ssh -N -L 3000:127.0.0.1:3000 -L 4815:127.0.0.1:4815 <跳板机别名>
```

---

## 4. 私有远程访问网关（Tailscale / 局域网 HTTPS）

切勿直接把 `3000` 或 `4815` 端口暴露到公网或 `0.0.0.0`。如需在手机、平板或局域网其他机器访问：

### Tailscale 私有入口

```sh
npm run scope
npm run private-gateway
tailscale serve --bg http://127.0.0.1:4880
```

访问口令会自动生成在 `.scope/private-access.json` 中。请使用仅限 Tailnet 内部可见的 `tailscale serve`，不要开启公网 `funnel`。

### 局域网 HTTPS + 来源 IP 白名单入口

在 `.scope/shared-access/` 中准备自签或内网证书 `server.crt`、`server.key`，并创建 `config.json`：

```json
{
  "host": "192.168.1.50",
  "port": 8844,
  "allowedClients": ["192.168.1.60"]
}
```

启动网关：

```sh
npm run shared-gateway
```

随机访问口令保存在 `.scope/shared-access/access.json`。非白名单 IP 访问直接返回 `403`，未登录返回 `401`。
