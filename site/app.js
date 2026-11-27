(() => {
  const PKG = "@godchaser/scope";
  const COPY = {
    en: {
      navSecurity: "Security",
      navRemote: "Remote Setup",
      navFeatures: "Features",
      navPlugins: "Plugins",
      navQuickstart: "Quickstart",
      heroPill1: "Open-Source Self-Hosted",
      heroPill2: "Ultra-Light 13 MB",
      heroPill3: "Zero Sensitive Data Access",
      heroTitle: "Local-hosted, multi-device Agent collaboration platform.",
      heroSubtitle:
        "Host Codex, Claude Code (CC), and Antigravity locally and manage every remote SSH agent reachable from your host. Multi-device collaboration across desktop and mobile, 13 MB install, zero remote daemons, and zero sensitive data access.",
      cmdTabPreview: "5s Preview (No SSH)",
      cmdTabInstall: "Install & Launch",
      cmdTabRemote: "Mobile Remote",
      copyBtn: "Copy",
      copiedBtn: "Copied",
      ctaRemoteSetup: "One-Click Remote Setup",
      ctaStar: "Explore on GitHub",
      ctaDocs: "Remote Access Guide",
      compatLabel: "Built for your native CLIs & subscriptions:",
      stageUi: "Workbench UI",
      stageDemo: "Walkthrough GIF",
      m1Title: "Full npm install",
      m1Desc:
        "4.3 MB tarball with only 2 runtime deps (nodemailer & ws). Zero Electron wrapper or IDE bloat.",
      m2Title: "Steady-state RAM",
      m2Desc:
        "Measured across 30 configured SSH hosts with 0% idle CPU. Runs effortlessly on a 2-vCPU cloud VM.",
      m3Title: "Remote daemons & relays",
      m3Desc:
        "Pure OpenSSH control plane bound strictly to 127.0.0.1. Zero third-party cloud relays or background agents.",
      m4Title: "Sensitive credentials collected",
      m4Desc:
        "Codex, CC, and Antigravity stay strictly on their official native CLIs. Never reads local auth secrets, Keychain, or uploads transcripts.",
      secTag: "Security & Protocol Protection",
      secTitle: "Lightweight by architecture. Verifiably private by default.",
      secDesc:
        "Every security guarantee below is enforced in open-source code, verified by automated unit tests and leak scanners on every release, and published via npm OIDC + Sigstore build provenance.",
      s1Pill: "Official CLI Protocol",
      s1Title: "Zero Sensitive Data Access Across All Agents",
      s1Desc:
        "All three agents run strictly via their unmodified official CLIs: Codex native app-server and local profile pools, CC official claude -p /usage (never reads ~/.claude credentials or macOS Keychain), and Antigravity official agy -p /usage with isolated profiles. Auth tokens stay strictly on their own host.",
      s2Pill: "Single-Use & Revocable",
      s2Title: "One-Time Login Links & Trusted Devices",
      s2Desc:
        "Master tokens never appear in URLs or browser history. Login links carry a single-use ?scope_login= code (10-minute TTL, consumed on first use). Trusted devices store only SHA-256 hashes (0600) with 90-day sliding HttpOnly Secure SameSite=Lax cookies; untrusted sessions stay RAM-only and revocable in 2 seconds via Settings or scope devices revoke.",
      s3Pill: "127.0.0.1 Only",
      s3Title: "Zero Telemetry, Zero Cloud Relay",
      s3Desc:
        "No analytics, no crash uploads, no hosted relay server, and no transcript harvesting. UI (:3000), Bridge (:4815), and Private Gateway (:4820) bind strictly to loopback 127.0.0.1. Every commit passes automated secret-leak checks before publishing with Sigstore transparency logs.",
      s4Pill: "Separate-Origin Proxy",
      s4Title: "Isolated /scope-port/ Dev-Server Proxy",
      s4Desc:
        "Inspect TensorBoard, Gradio, or Jupyter from your phone with always-on Service-Worker & Clear-Site-Data blocking, hard-blocked control ports, and opt-in separate-origin isolation (--port-domain / 60s single-use handoff ticket) so proxied apps can never reach /scope-api.",
      s5Pill: "4.3 MB / 2 Deps",
      s5Title: "Ultra-Lightweight Native Footprint",
      s5Desc:
        "Installs in seconds via npm with only 2 runtime packages (nodemailer 10.6.1 and ws, 0 audit advisories). No 500 MB Electron wrapper, no Docker stack, and nothing to install on remote servers. Uses ~160 MB RAM and 0% idle CPU across 30 hosts.",
      s6Pill: "TTY Lock Guard",
      s6Title: "Non-Invasive Terminal Safety & MIT Audit",
      s6Desc:
        "Detects active external Claude Code and Antigravity terminal sessions via /proc, tmux, and flock, automatically switching to read-only tailing so SCOPE never hijacks your active terminal. 100% MIT open source and auditable line by line.",
      remTag: "One-Click Remote Access",
      remTitle: "Access privately from your phone in 2 minutes (Tailscale or your own domain).",
      remDesc:
        "Zero open inbound firewall ports. Pick private Tailscale Serve HTTPS (no domain needed) or your own Cloudflare-managed domain with Zero Trust Access double authentication. Full English & Chinese tutorials and one-click scripts included.",
      remTabTsTitle: "Option A: Tailscale Serve",
      remTabTsSub: "2 min, zero domain, private tailnet HTTPS (never Funnel)",
      remTabCfTitle: "Option B: Custom Domain + Cloudflare Tunnel",
      remTabCfSub: "3 min, your own HTTPS domain + Zero Trust Access double auth",
      remTsCliHead: "Option 1: Built-in CLI (Linux / macOS / Windows)",
      remTsScriptHead: "Option 2: One-Click Launch Script",
      remTsNoteTitle: "Private by construction:",
      remTsNoteBody:
        "SCOPE always uses private tailscale serve (never public Funnel). Opening the generated single-use ?scope_login= link on your phone registers a 90-day sliding Trusted Device cookie and strips the code from the address bar.",
      remCfCliHead: "Option 1: Built-in CLI (Linux / macOS / Windows)",
      remCfScriptHead: "Option 2: One-Click Launch Script",
      remCfNoteTitle: "Cloudflare Zero Trust Access checklist:",
      remCfNoteBody:
        "Put ONLY your own Emails in the Allow policy Include rule (never add Login Methods inside Include), and raise Session Duration to 1 month so mobile Safari and Home Screen PWA stay signed in seamlessly.",
      remGuideEn: "English Tutorial (Tailscale & Cloudflare)",
      remGuideZh: "中文完整部署教程（Tailscale / 个人域名）",
      remScriptsLink: "Inspect All Launch Scripts",
      featTag: "Capabilities",
      featTitle: "Multi-host agent observability, without IDE bloat.",
      featDesc:
        "No code editor bloat. Just fast observability, approvals, subagent workflows, authenticated port forwarding, and live quotas across every local or SSH GPU machine.",
      f1Badge: "Subagents & Collaboration",
      demoToggleLabel: "Inline cards",
      f1Title: "Subagent Directory, Workflow Drawer & Bidirectional Timeline",
      f1Desc:
        "Track every Claude Code & Codex subagent per task, inspect step-by-step reasoning and tool calls in a scrollable drawer, and see parent ↔ subagent handbacks & SendMessage exchanges chronologically on both desktop and mobile.",
      mockSubHead: "Spawned 3 subagents",
      mockInspect: "Workflow →",
      f2Badge: "SSH & Remote Ports",
      f2Title: "Auto-Discover Ports & Mobile /scope-port/ Proxy",
      f2Desc:
        "Detects TensorBoard, Jupyter, Gradio, Vite, or FastAPI on remote SSH or Linux @local hosts, avoids local port collisions, and proxies allowlisted web apps securely to your phone over HTTPS & WSS.",
      mockOpen: "Open ↗",
      mockForward: "Forward",
      f3Badge: "Quotas & Failover",
      f3Title: "3-Agent Official /usage Quotas & Codex Pool",
      f3Desc:
        "View Codex, Claude Code (unmodified official claude -p /usage CLI, zero credentials read), and Antigravity quotas in one place, with automatic Codex failover and built-in Web SSH login.",
      f4Badge: "GPU Clusters & Reading Craft",
      f4Title: "GPU Process Ownership, Terminal Lock Safety & Rich Media",
      f4Desc:
        "Real-time nvidia-smi matched directly to active sessions, auto-detected external TTY locks so SCOPE never hijacks your terminal, inline KaTeX math, remote PNG plots, range-streamed MP4 rollouts, auto-collapsed long prompts, and unified 1-click copy.",
      mockLockK: "TTY Guard",
      mockLockV: "External pts/11 (Read-only)",
      mockMediaK: "Rich Media",
      plugTag: "Plugin Protocol v1",
      plugTitle: "Extend SCOPE without touching a line of core code.",
      plugDesc:
        "Plug in Slurm, Kubernetes, Aliyun DLC, WandB dashboards, or custom cluster scripts via a declarative scope-plugin.json manifest, SHA-256 integrity receipts, explicit lifecycle hooks, and auto-rendered Settings UI forms.",
      p1: "Manifest-driven settings forms & action buttons rendered automatically in Settings → Plugins",
      p2: "SHA-256 receipt verification & clean reverse-order onDispose() teardown",
      p3: "Full CLI lifecycle: scope plugin inspect / add / list / remove",
      plugCta: "Read Plugin Protocol v1",
      qsTag: "Try It in 5 Seconds",
      qsTitle: "Try the isolated preview locally (zero SSH needed).",
      qsDesc:
        "Test the real 13 MB workbench locally with synthetic data, then install globally to monitor local and remote SSH GPU agents with full privacy.",
      qsPreview: "Instant Preview (Zero SSH)",
      qsInstall: "Global Install (Linux / macOS / Windows)",
      qsFork: "Fork it & make it yours",
      qsRemote: "Tailscale & Cloudflare Guide",
      qsDeploy: "Deployment Guide",
      footerTagline: "Lightweight, security-first web control plane for coding agents (MIT)",
    },
    zh: {
      navSecurity: "安全与轻量",
      navRemote: "一键远程部署",
      navFeatures: "核心能力",
      navPlugins: "插件协议",
      navQuickstart: "快速上手",
      heroPill1: "开源自托管",
      heroPill2: "超轻量包体",
      heroPill3: "不访问敏感数据",
      heroTitle: "纯本地托管、多端部署的\nAgent 协同平台",
      heroSubtitle:
        "统一托管 CC（Claude Code）、Codex 与 Antigravity，完全管理部署机可连接的远程 Agent，支持桌面与手机多端协同。安装仅 13 MB，远端零常驻，不访问本地敏感凭据，不上传任何对话。",
      cmdTabPreview: "5 秒免 SSH 预览",
      cmdTabInstall: "安装与本地启动",
      cmdTabRemote: "手机远程托管",
      copyBtn: "复制",
      copiedBtn: "已复制",
      ctaRemoteSetup: "一键远程部署脚本",
      ctaStar: "逛逛源码仓库",
      ctaDocs: "Tailscale / 域名中文教程",
      compatLabel: "原生兼容你已有的 CLI 与订阅：",
      stageUi: "工作台界面",
      stageDemo: "交互演示 GIF",
      m1Title: "全量安装体积",
      m1Desc:
        "下载包仅 4.3 MB，运行时仅 2 个依赖（nodemailer 与 ws），告别 500 MB 桌面重壳。",
      m2Title: "多机常驻内存",
      m2Desc:
        "30 台 SSH 主机配置实测常驻 ~160 MB、空闲 0% CPU，2 核轻云机也能轻松常驻。",
      m3Title: "远端常驻与云端中转",
      m3Desc:
        "纯标准 OpenSSH 控制面，默认严守 127.0.0.1，零第三方云端中转，无需向服务器装后台程序。",
      m4Title: "敏感凭据采集",
      m4Desc:
        "Codex、CC 与 Antigravity 全部严守原生官方 CLI 协议，绝不读取本地认证密钥或钥匙串，不上传任何对话。",
      secTag: "安全与协议保护架构",
      secTitle: "架构足够轻，隐私默认可审计",
      secDesc:
        "每一条安全承诺均直接落在开源代码与自动化回归测试中，发版时通过防泄漏扫描与 npm OIDC + Sigstore 透明日志签名溯源。",
      s1Pill: "原生官方协议隔离",
      s1Title: "三端均走官方 CLI，不访问敏感数据",
      s1Desc:
        "Codex 走原生 app-server 与本地多号池，CC 仅通过官方 claude -p /usage 查额度（不读 ~/.claude 凭据或钥匙串），Antigravity 走官方 agy -p /usage 与隔离 Profile。各端登录态与敏感凭据始终留在自有主机上。",
      s2Pill: "一次性登录码与设备吊销",
      s2Title: "一次性快捷链接与可吊销受信任设备",
      s2Desc:
        "主访问密钥永不进入 URL 或浏览器历史。快捷链接仅含 10 分钟有效、用完即毁的 ?scope_login= 登录码；受信任设备在主机 .scope/private-access.json（0600）仅存 SHA-256 哈希，下发 90 天滑动 HttpOnly Secure SameSite=Lax Cookie；临时会话仅驻内存，随时可在设置或 scope devices revoke 2 秒内单台踢出。",
      s3Pill: "严守 127.0.0.1",
      s3Title: "零遥测、零云端中转、零对话采集",
      s3Desc:
        "无埋点分析、无崩溃上报、无第三方云端代理，你的每一行对话历史与代码上下文都严格留在自己的主机上。前端 (:3000)、Bridge (:4815) 与私有网关 (:4820) 全部默认仅绑定 127.0.0.1。",
      s4Pill: "独立域名端口隔离",
      s4Title: "独立 Origin 的 /scope-port/ 端口代理",
      s4Desc:
        "手机端查看远端 TensorBoard、Gradio 或 Jupyter 时，默认拦截 Service-Worker 与 Clear-Site-Data 并硬屏蔽控制端口；支持 --port-domain 独立 Origin 隔离与 60 秒一次性票据交接，即使被代理页面存在 XSS 也绝对无法访问 /scope-api。",
      s5Pill: "4.3 MB / 2 依赖",
      s5Title: "极致轻量的原生运行时",
      s5Desc:
        "一条 npm install 秒装，运行时只依赖 nodemailer 10.6.1 和 ws 两个包（0 已知漏洞）。不打包 Electron，不需要 Docker，远端服务器零部署。实测挂载 30 台主机常驻约 160 MB 内存，空闲 CPU 为 0%。",
      s6Pill: "外部终端防抢占锁",
      s6Title: "不抢占原终端，100% MIT 开源可审计",
      s6Desc:
        "通过 /proc、tmux 与 flock 自动识别正在外部终端运行的 Claude Code 与 Antigravity 会话，自动切换只读跟踪防止写入冲突。全部源码 MIT 开源，无黑盒二进制。",
      remTag: "一键远程托管（手机端随时远控）",
      remTitle: "2 分钟配好手机私人远程访问（Tailscale 或自有域名）",
      remDesc:
        "服务器零开放公网端口。支持免域名的 Tailscale Serve 私网 HTTPS，也支持自有 Cloudflare 托管域名 + Zero Trust Access 双重认证，附完整中英文图文教程与一键启动脚本。",
      remTabTsTitle: "方案 A：Tailscale Serve（免域名）",
      remTabTsSub: "2 分钟上手，仅限个人私网 HTTPS（绝不开公网 Funnel）",
      remTabCfTitle: "方案 B：自有域名 + Cloudflare Tunnel",
      remTabCfSub: "3 分钟部署，个人 HTTPS 域名 + Zero Trust 邮箱双重验证",
      remTsCliHead: "方式 1：内置 CLI 命令（Linux / macOS / Windows）",
      remTsScriptHead: "方式 2：一键启动脚本（自动启服务 + 开私网 + 发一次性链接）",
      remTsNoteTitle: "默认私网安全：",
      remTsNoteBody:
        "SCOPE 严格只用私有 tailscale serve（绝不开启公网 Funnel）。手机打开生成的一次性 ?scope_login= 链接后自动注册 90 天滑动受信任设备并清除地址栏参数。",
      remCfCliHead: "方式 1：内置 CLI 命令（Linux / macOS / Windows）",
      remCfScriptHead: "方式 2：一键托管脚本（配 Tunnel + DNS + systemd + 一次性链接）",
      remCfNoteTitle: "Cloudflare Zero Trust Access 安全要点：",
      remCfNoteBody:
        "Allow 策略的 Include 中请只填写你自己的 Emails（切勿把 Login Methods 放进 Include），并建议把 Session Duration 调为 1 month，手机 Safari 与主屏幕 PWA 即可长期免重复验证。",
      remGuideEn: "English Tutorial (Tailscale & Cloudflare)",
      remGuideZh: "中文完整部署教程（Tailscale / 个人域名）",
      remScriptsLink: "查看全部一键启动脚本源码",
      featTag: "核心能力",
      featTitle: "专为多机 Agent 协作设计的轻量控制面",
      featDesc:
        "不塞多余的代码编辑器，专注把子代理协同、鉴权端口转发、官方配额监控与算力观测做到极致顺手。",
      f1Badge: "子代理与双向协同",
      demoToggleLabel: "对话流卡片",
      f1Title: "子代理目录总览、完整工作流抽屉与主/子双向时间线",
      f1Desc:
        "清晰列出 Claude Code 与 Codex 每轮新建的子代理，侧滑抽屉按步骤追踪思考与工具调用，主/子回传报告与 SendMessage 互动在桌面与手机端均排版清晰、一目了然。",
      mockSubHead: "当前任务新建了 3 个子代理",
      mockInspect: "查看工作流 →",
      f2Badge: "SSH 与远程端口",
      f2Title: "远端端口自动发现与手机 /scope-port/ 代理",
      f2Desc:
        "自动发现远端 SSH 或 Linux @local 主机上的 TensorBoard、Jupyter、Gradio、Vite、FastAPI，避让本地冲突并通过鉴权网关直接用手机 HTTPS / WSS 打开。",
      mockOpen: "打开 ↗",
      mockForward: "转发打开",
      f3Badge: "官方配额与容灾",
      f3Title: "三端官方 /usage 实时额度 & Codex 多号池",
      f3Desc:
        "一屏查看 Codex、Claude Code（纯官方 claude -p /usage 零凭据读取）与 Antigravity 分组余量，支持 Codex 撞限自动切号和内置 Web SSH 登录。",
      f4Badge: "GPU 算力与阅读体验",
      f4Title: "GPU 进程归属、外部终端防冲突锁与科研富媒体",
      f4Desc:
        "nvidia-smi 显存占用直连对应会话，外部终端运行中自动只读保护防抢占；支持 KaTeX 公式、远端实验图、Range 流式 MP4 视频、长提示自动折叠与全端一键复制。",
      mockLockK: "终端保护",
      mockLockV: "外部 pts/11（只读同步）",
      mockMediaK: "富媒体渲染",
      plugTag: "开放插件协议 v1",
      plugTitle: "不改一行核心源码，按协议自由扩展你的工作台。",
      plugDesc:
        "通过声明式 scope-plugin.json 清单、SHA-256 目录完整性校验与生命周期钩子，轻松接入 Slurm、K8s、阿里云 DLC、WandB 看板或团队自研集群脚本，设置页自动生成表单与操作卡片。",
      p1: "清单声明配置项与动作按钮，Web 设置页 → 插件扩展自动渲染交互界面",
      p2: "启动时自动校验目录 SHA-256 摘要，停用或重载时逆序执行 onDispose() 清理",
      p3: "原生 CLI 全生命周期管理：scope plugin inspect / add / list / remove",
      plugCta: "阅读插件开发协议 v1",
      qsTag: "5 秒立即体验",
      qsTitle: "一行命令先试玩，无需配置 SSH",
      qsDesc:
        "内置零隐私虚拟数据隔离预览；满意后全局安装，即刻纳管你所有的本地与远程 SSH GPU 主机。",
      qsPreview: "5 秒零配预览（虚拟数据）",
      qsInstall: "全局正式安装（Linux / macOS / Windows）",
      qsFork: "MIT 开源，随便魔改",
      qsRemote: "Tailscale / Cloudflare 教程",
      qsDeploy: "查看完备部署指南",
      footerTagline: "极致轻量、安全优先的多 Coding Agent 统一控制台（MIT 开源协议）",
    },
  };

  let lang = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  let theme = "dark";
  let cmdMode = "preview";
  let remoteMode = "tailscale";
  let stageMode = "ui";
  let subagentDemoOn = true;

  const root = document.documentElement;
  const langBtn = document.getElementById("lang-toggle");
  const themeBtn = document.getElementById("theme-toggle");
  const iconSun = document.getElementById("icon-sun");
  const iconMoon = document.getElementById("icon-moon");
  const heroCmd = document.getElementById("hero-command");
  const heroCopy = document.getElementById("hero-copy-btn");
  const stageImg = document.getElementById("stage-image");
  const qsCmd1 = document.getElementById("qs-cmd-1");
  const docsLink = document.getElementById("cta-docs-link");
  const pluginDocsLink = document.getElementById("plugin-docs-link");
  const remoteDocsLink = document.getElementById("remote-docs-link");
  const deployDocsLink = document.getElementById("deploy-docs-link");
  const demoToggle = document.getElementById("demo-subagent-toggle");
  const demoPreview = document.getElementById("demo-subagent-preview");
  const remotePanelTs = document.getElementById("remote-panel-tailscale");
  const remotePanelCf = document.getElementById("remote-panel-cloudflare");

  function previewCommand() {
    return lang === "zh" ? `npx ${PKG} preview` : `npx ${PKG} preview --en`;
  }

  function installCommand() {
    return `npm i -g ${PKG} && scope`;
  }

  function remoteCommand() {
    return `npm i -g ${PKG} && scope start --gateway && scope expose tailscale`;
  }

  function updateStageImage() {
    if (!stageImg) return;
    if (stageMode === "demo") {
      stageImg.src = `./assets/scope-demo-${lang}.gif`;
      return;
    }
    stageImg.src = `./assets/scope-preview-${theme}-${lang}.png`;
  }

  function render() {
    const dict = COPY[lang];
    root.lang = lang === "zh" ? "zh-CN" : "en";
    root.dataset.theme = theme;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key && dict[key]) el.textContent = dict[key];
    });
    if (langBtn) langBtn.textContent = lang === "zh" ? "EN" : "中文";
    if (iconSun && iconMoon) {
      iconSun.hidden = theme !== "dark";
      iconMoon.hidden = theme === "dark";
    }
    if (heroCmd) {
      heroCmd.textContent =
        cmdMode === "preview"
          ? previewCommand()
          : cmdMode === "install"
            ? installCommand()
            : remoteCommand();
    }
    if (qsCmd1) qsCmd1.textContent = previewCommand();
    if (docsLink) {
      docsLink.href =
        lang === "zh"
          ? "https://github.com/securityCFS/SCOPE/blob/main/docs/remote-access.zh-CN.md"
          : "https://github.com/securityCFS/SCOPE/blob/main/docs/remote-access.md";
    }
    if (pluginDocsLink) {
      pluginDocsLink.href =
        lang === "zh"
          ? "https://github.com/securityCFS/SCOPE/blob/main/docs/plugin-protocol.zh-CN.md"
          : "https://github.com/securityCFS/SCOPE/blob/main/docs/plugin-protocol.md";
    }
    if (remoteDocsLink) {
      remoteDocsLink.href =
        lang === "zh"
          ? "https://github.com/securityCFS/SCOPE/blob/main/docs/remote-access.zh-CN.md"
          : "https://github.com/securityCFS/SCOPE/blob/main/docs/remote-access.md";
    }
    if (deployDocsLink) {
      deployDocsLink.href =
        lang === "zh"
          ? "https://github.com/securityCFS/SCOPE/blob/main/docs/deployment.zh-CN.md"
          : "https://github.com/securityCFS/SCOPE/blob/main/docs/deployment.md";
    }
    if (remotePanelTs && remotePanelCf) {
      remotePanelTs.hidden = remoteMode !== "tailscale";
      remotePanelCf.hidden = remoteMode !== "cloudflare";
    }
    updateStageImage();
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    if (!btn) return;
    const prev = COPY[lang].copyBtn;
    btn.textContent = COPY[lang].copiedBtn;
    btn.classList.add("is-copied");
    setTimeout(() => {
      btn.textContent = prev;
      btn.classList.remove("is-copied");
    }, 1600);
  }

  langBtn?.addEventListener("click", () => {
    lang = lang === "zh" ? "en" : "zh";
    render();
  });

  themeBtn?.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    render();
  });

  demoToggle?.addEventListener("click", () => {
    subagentDemoOn = !subagentDemoOn;
    demoToggle.setAttribute("aria-checked", subagentDemoOn ? "true" : "false");
    demoToggle.querySelector(".demo-pill-track")?.classList.toggle("is-on", subagentDemoOn);
    demoPreview?.classList.toggle("is-dim", !subagentDemoOn);
  });

  document.querySelectorAll(".cmd-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      cmdMode = btn.getAttribute("data-cmd-mode") || "preview";
      document.querySelectorAll(".cmd-tab").forEach((other) => {
        const active = other === btn;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-selected", active ? "true" : "false");
      });
      render();
    });
  });

  document.querySelectorAll(".remote-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      remoteMode = btn.getAttribute("data-remote-mode") || "tailscale";
      document.querySelectorAll(".remote-tab").forEach((other) => {
        const active = other === btn;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-selected", active ? "true" : "false");
      });
      render();
    });
  });

  document.querySelectorAll(".stage-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      stageMode = btn.getAttribute("data-stage") || "ui";
      document.querySelectorAll(".stage-tab").forEach((other) => {
        const active = other === btn;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-selected", active ? "true" : "false");
      });
      updateStageImage();
    });
  });

  heroCopy?.addEventListener("click", () => {
    if (heroCmd) void copyText(heroCmd.textContent || "", heroCopy);
  });

  document.querySelectorAll("[data-copy-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-copy-target");
      const target = id ? document.getElementById(id) : null;
      if (target) void copyText(target.textContent || "", btn);
    });
  });

  render();
})();
