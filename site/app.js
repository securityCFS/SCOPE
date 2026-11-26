(() => {
  const PKG = "@godchaser/scope";
  const COPY = {
    en: {
      navFeatures: "Features",
      navArch: "Remote & Privacy",
      navPlugins: "Plugins",
      navQuickstart: "Quickstart",
      heroKicker: "MIT Open Source, Local-First, 13 MB Install",
      heroTitle: "One lightweight web control plane for all your coding agents.",
      heroSubtitle:
        "Monitor, resume, and steer Claude Code, Codex, and Antigravity across local and remote SSH GPU servers — no heavy Electron wrapper, no remote daemons, no IDE bloat.",
      cmdTabPreview: "5s Preview (No SSH)",
      cmdTabInstall: "Install & Launch",
      copyBtn: "Copy",
      copiedBtn: "Copied",
      ctaStar: "Explore on GitHub",
      ctaDocs: "Read Docs",
      ctaReleases: "Releases",
      compatLabel: "Works with your existing CLI & subscriptions:",
      stageUi: "Workbench UI",
      stageDemo: "Walkthrough GIF",
      m1Title: "Full npm install",
      m1Desc:
        "4.2 MB tarball with only 2 runtime deps (nodemailer & ws). Zero Electron bloat.",
      m2Title: "Steady-state RAM",
      m2Desc:
        "Measured across 30 configured SSH hosts with 0% idle CPU. Runs easily on a 2-vCPU VM.",
      m3Title: "Remote daemons",
      m3Desc:
        "Pure OpenSSH control plane. Reads your existing ~/.ssh/config and native CLI logs directly.",
      m4Val: "5 sec",
      m4Title: "Zero-SSH preview",
      m4Desc:
        "Explore the full workbench locally with built-in synthetic data before connecting any host.",
      featTag: "Capabilities",
      featTitle: "Built for multi-host AI workflows — not another heavy IDE.",
      featDesc:
        "No code editor bloat. Just fast observability, approvals, subagent workflows, port forwarding, and quotas across every remote GPU box.",
      f1Badge: "Subagents & Collaboration",
      demoToggleLabel: "Inline cards",
      f1Title: "Subagent Directory, Workflow Drawer & Bidirectional Timeline",
      f1Desc:
        "Track every Claude Code & Codex subagent per task, inspect step-by-step reasoning and tool calls in a scrollable drawer, and see parent ↔ subagent handbacks & SendMessage exchanges chronologically.",
      mockSubHead: "Spawned 3 subagents",
      mockInspect: "Workflow →",
      f2Badge: "SSH Port Forwarding",
      f2Title: "Auto-Discover & One-Click Forward Agent Ports",
      f2Desc:
        "Detects TensorBoard, Jupyter, Gradio, Vite, or FastAPI launched on remote GPUs, avoids local port collisions, and turns inline localhost links into 1-click SSH -L tunnels.",
      mockOpen: "Open ↗",
      mockForward: "Forward",
      f3Badge: "Quotas & Failover",
      f3Title: "3-Agent Live /usage Quotas & Codex Multi-Account Pool",
      f3Desc:
        "View Codex, Claude Code (host-local OAuth — tokens never leave the host), and Antigravity quotas in one place, with automatic Codex failover and built-in Web SSH login.",
      f4Badge: "GPU Clusters & Reading Craft",
      f4Title: "GPU Process Ownership, Terminal Lock Safety & Rich Media",
      f4Desc:
        "Real-time nvidia-smi matched directly to active sessions, auto-detected external TTY locks so SCOPE never hijacks your terminal, inline KaTeX math, remote PNG plots, range-streamed MP4 rollouts, auto-collapsed long prompts, and unified 1-click copy.",
      mockLockK: "TTY Guard",
      mockLockV: "External pts/11 (Read-only)",
      mockMediaK: "Rich Media",
      archTag: "Local-First & Self-Hosted Remote",
      archTitle: "127.0.0.1 by default. Private mobile access on your terms.",
      archDesc:
        "No third-party cloud relay, no telemetry, no account lock-in. Expose your personal workbench to your phone or laptop via Tailscale Serve or your own Caddy + SSH reverse tunnel.",
      a1Title: "Workstation or Private Linux Hub",
      a1Desc:
        "UI (:3000) and SSH Bridge (:4815) bind strictly to 127.0.0.1. Credentials and config stay in .scope/ with 0600 permissions.",
      a2Title: "Built-in Private Gateway (:4820)",
      a2Desc:
        "Merges UI, API, SSE, and WebSocket terminal onto one loopback port protected by a 32-byte secret and HttpOnly Secure SameSite=Strict cookie.",
      a3Title: "Tailscale Serve or Your Own Caddy",
      a3Desc:
        "Zero exposed ports with Tailscale Serve, or reverse-proxy over an outbound autossh -R tunnel to your personal VM with automatic HTTPS + BasicAuth.",
      plugTag: "Plugin Protocol v1",
      plugTitle: "Extend SCOPE without touching a line of core code.",
      plugDesc:
        "Plug in Slurm, Kubernetes, Aliyun DLC, WandB dashboards, or custom cluster scripts via a declarative scope-plugin.json manifest, SHA-256 integrity receipts, explicit lifecycle hooks, and auto-rendered Settings UI forms.",
      p1: "Manifest-driven settings forms & action buttons rendered automatically in Settings → Plugins",
      p2: "SHA-256 receipt verification & clean reverse-order onDispose() teardown",
      p3: "Full CLI lifecycle: scope plugin inspect / add / list / remove",
      plugCta: "Read Plugin Protocol v1",
      qsTag: "Try It in 5 Seconds",
      qsTitle: "Launch the isolated preview right now — zero SSH needed.",
      qsDesc:
        "Test the real workbench UI locally with synthetic data, then install globally to connect your SSH GPU servers and coding agents.",
      qsPreview: "Instant Preview (Zero SSH)",
      qsInstall: "Global Install (Linux / macOS / Windows)",
      qsFork: "Fork it & make it yours",
      qsDeploy: "Deployment Guide",
      footerTagline: "Lightweight web control plane for coding agents (MIT)",
    },
    zh: {
      navFeatures: "核心能力",
      navArch: "本地隐私与远程",
      navPlugins: "插件协议",
      navQuickstart: "快速上手",
      heroKicker: "MIT 开源，纯本机优先，全量安装仅 13 MB",
      heroTitle: "极致轻量的 Web 控制台\n一屏驾驭所有 Coding Agent",
      heroSubtitle:
        "统一监控与操控本机及多台远程 SSH GPU 服务器上的 Claude Code、Codex 与 Antigravity——无 Electron 重壳，远端零常驻，不做重型 IDE 绑定。",
      cmdTabPreview: "5 秒免 SSH 预览",
      cmdTabInstall: "安装与正式启动",
      copyBtn: "复制",
      copiedBtn: "已复制",
      ctaStar: "逛逛源码仓库",
      ctaDocs: "阅读中文文档",
      ctaReleases: "发布历史",
      compatLabel: "直接使用你已有的 CLI 与订阅：",
      stageUi: "工作台界面",
      stageDemo: "交互演示 GIF",
      m1Title: "全量安装体积",
      m1Desc:
        "下载仅 4.2 MB，运行时仅 2 个依赖（nodemailer 与 ws），告别 500 MB 桌面重壳。",
      m2Title: "多机常驻内存",
      m2Desc:
        "30 台 SSH 主机配置实测常驻 ~160 MB、空闲 0% CPU，2 核轻云机轻松常驻。",
      m3Title: "远端常驻进程",
      m3Desc:
        "纯标准 OpenSSH 无入侵架构，直接读原生 ~/.ssh/config 与 CLI 历史，随时切回原终端。",
      m4Val: "5 秒",
      m4Title: "零配置体验",
      m4Desc:
        "一条 npx 命令自带虚拟数据启动完整工作台，不用先配任何 SSH 就能上手试玩。",
      featTag: "核心能力",
      featTitle: "专为多机 AI 协作打造——轻量控制面，而非重型 IDE。",
      featDesc:
        "不塞多余的代码编辑器，专注把子代理协同、端口转发、额度切换与算力监控做到极致顺手。",
      f1Badge: "子代理与双向协同",
      demoToggleLabel: "对话流卡片",
      f1Title: "子代理目录总览、完整工作流抽屉与主/子双向时间线",
      f1Desc:
        "清晰列出 Claude Code 与 Codex 每轮新建的子代理，侧滑抽屉按步骤追踪思考与工具调用，主/子回传报告与 SendMessage 互动一目了然。",
      mockSubHead: "当前任务新建了 3 个子代理",
      mockInspect: "查看工作流 →",
      f2Badge: "SSH 端口自动转发",
      f2Title: "远端 Agent 服务端口自动发现与一键转发",
      f2Desc:
        "自动检测远端 GPU 上起的 TensorBoard、Jupyter、Gradio、Vite、FastAPI，智能避让本地端口冲突，对话里的 localhost 链接点击即转发打开。",
      mockOpen: "打开 ↗",
      mockForward: "转发打开",
      f3Badge: "多端额度与容灾",
      f3Title: "三端实时 /usage 额度中心 & Codex 多号池自动切号",
      f3Desc:
        "一屏查看 Codex、Claude Code（主机本地 OAuth 探测，Token 不出机）与 Antigravity 分组余量，支持 Codex 撞限自动切号和内置 Web SSH 登录。",
      f4Badge: "GPU 算力与阅读体验",
      f4Title: "GPU 进程归属、外部终端防冲突锁与科研富媒体",
      f4Desc:
        "nvidia-smi 显存占用直连对应会话，外部终端运行中自动只读保护防抢占；支持 KaTeX 公式、远端实验图、Range 流式 MP4 视频、长提示自动折叠与全端一键复制。",
      mockLockK: "终端保护",
      mockLockV: "外部 pts/11（只读同步）",
      mockMediaK: "富媒体渲染",
      archTag: "本机优先 & 私人自建转发",
      archTitle: "默认严守 127.0.0.1，手机远程访问完全掌握在你自己手里。",
      archDesc:
        "不经任何第三方托管中继、零遥测。通过 Tailscale Serve 或自有云服务器 Caddy + 反向隧道，手机和平板也能安全 HTTPS 审批与遥控。",
      a1Title: "本机工作站或私人 Linux 中枢",
      a1Desc:
        "前端 (:3000) 与 SSH Bridge (:4815) 严格仅监听 127.0.0.1，所有凭据与配置以 0600 权限留存本地 .scope/。",
      a2Title: "内置单端口私有网关 (:4820)",
      a2Desc:
        "将页面、API、SSE 流与 WebSocket 终端合入单一回环端口，由 32 位随机密钥与 HttpOnly Secure SameSite=Strict Cookie 双重守护。",
      a3Title: "Tailscale Serve 或自建 Caddy 反代",
      a3Desc:
        "Tailscale Serve 实现公网 0 端口暴露；或通过出站 autossh -R 反代至自有云机 Caddy，自动 HTTPS + BasicAuth 手机直开。",
      plugTag: "开放插件协议 v1",
      plugTitle: "不改一行核心源码，按协议自由扩展你的工作台。",
      plugDesc:
        "通过声明式 scope-plugin.json 清单、SHA-256 目录完整性校验与生命周期钩子，轻松接入 Slurm、K8s、阿里云 DLC、WandB 看板或团队自研集群脚本，设置页自动生成表单与操作卡片。",
      p1: "清单声明配置项与动作按钮，Web 设置页 → 插件扩展自动渲染交互界面",
      p2: "启动时自动校验目录 SHA-256 摘要，停用或重载时逆序执行 onDispose() 清理",
      p3: "原生 CLI 全生命周期管理：scope plugin inspect / add / list / remove",
      plugCta: "阅读插件开发协议 v1",
      qsTag: "5 秒立即体验",
      qsTitle: "一行命令即可试玩完整界面——无需配置任何 SSH。",
      qsDesc:
        "内置零隐私虚拟数据隔离预览；满意后全局安装，即刻纳管你所有的本地与远程 SSH GPU 主机。",
      qsPreview: "5 秒零配预览（虚拟数据）",
      qsInstall: "全局正式安装（Linux / macOS / Windows）",
      qsFork: "MIT 开源，随便魔改",
      qsDeploy: "查看完备部署指南",
      footerTagline: "轻量化多 Coding Agent 统一控制台（MIT 开源协议）",
    },
  };

  let lang = (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  let theme = "dark";
  let cmdMode = "preview";
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
  const deployDocsLink = document.getElementById("deploy-docs-link");
  const demoToggle = document.getElementById("demo-subagent-toggle");
  const demoPreview = document.getElementById("demo-subagent-preview");

  function previewCommand() {
    return lang === "zh" ? `npx ${PKG} preview` : `npx ${PKG} preview --en`;
  }

  function installCommand() {
    return `npm i -g ${PKG} && scope`;
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
        cmdMode === "preview" ? previewCommand() : installCommand();
    }
    if (qsCmd1) qsCmd1.textContent = previewCommand();
    if (docsLink) {
      docsLink.href =
        lang === "zh"
          ? "https://github.com/securityCFS/SCOPE/blob/main/docs/getting-started.zh-CN.md"
          : "https://github.com/securityCFS/SCOPE/blob/main/docs/getting-started.md";
    }
    if (pluginDocsLink) {
      pluginDocsLink.href =
        lang === "zh"
          ? "https://github.com/securityCFS/SCOPE/blob/main/docs/plugin-protocol.zh-CN.md"
          : "https://github.com/securityCFS/SCOPE/blob/main/docs/plugin-protocol.md";
    }
    if (deployDocsLink) {
      deployDocsLink.href =
        lang === "zh"
          ? "https://github.com/securityCFS/SCOPE/blob/main/docs/deployment.zh-CN.md"
          : "https://github.com/securityCFS/SCOPE/blob/main/docs/deployment.md";
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
