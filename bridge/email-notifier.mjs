import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

const DEFAULT_COOLDOWN_MS = 15 * 60_000;
const DEFAULT_SECRET_FILE = "email-smtp-secret.json";

function clean(value, limit = 4_000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, limit);
}

function htmlEscape(value) {
  return clean(value, 20_000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 320));
}

function fingerprint(event) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        key: event.key,
        severity: event.severity,
        title: event.title,
        summary: event.summary,
        details: event.details,
      }),
    )
    .digest("hex");
}

async function readJson(filename, fallback) {
  try {
    const content = await readFile(filename, "utf8");
    return JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error(`无法读取 ${filename}: ${error.message}`);
    }
    return fallback;
  }
}

async function writeJsonAtomic(filename, value, mode = 0o600) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode,
  });
  await rename(temporary, filename);
}

function runProcess(command, args, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("读取邮件凭据超时"));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-20_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-20_000);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(clean(stderr || stdout, 1_000) || `退出码 ${code}`));
    });
  });
}

function resolveSecretPath(config, configDirectory) {
  const secretFile = clean(config?.smtp?.secretFile || DEFAULT_SECRET_FILE, 300);
  const resolved = path.resolve(configDirectory, secretFile);
  const base = path.resolve(configDirectory);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error("SMTP secret path escapes configuration directory");
  }
  return resolved;
}

async function loadCredential(config, configDirectory, environment) {
  const environmentUser = clean(environment.SCOPE_EMAIL_SMTP_USER, 320);
  const environmentPass = clean(environment.SCOPE_EMAIL_SMTP_PASS, 1_000);
  if (environmentUser && environmentPass) {
    return { user: environmentUser, pass: environmentPass, source: "environment" };
  }

  const secretPath = resolveSecretPath(config, configDirectory);
  const localSecret = await readJson(secretPath, null);
  const secretUser = clean(localSecret?.user, 320);
  const secretPass = clean(localSecret?.pass, 1_000);
  if (secretUser && secretPass) {
    return { user: secretUser, pass: secretPass, source: "local-secret" };
  }

  const credentialFile = clean(config?.smtp?.credentialFile, 1_000);
  if (!credentialFile || process.platform !== "win32") return null;
  const resolved = path.resolve(configDirectory, credentialFile);
  try {
    await access(resolved);
  } catch {
    return null;
  }
  const credentialLiteral = resolved.replaceAll("'", "''");
  const script = [
    "$ErrorActionPreference='Stop'",
    `$credential=Import-Clixml -LiteralPath '${credentialLiteral}'`,
    "$network=$credential.GetNetworkCredential()",
    "[Console]::Out.Write((@{user=$credential.UserName;pass=$network.Password}|ConvertTo-Json -Compress))",
  ].join("; ");
  const output = await runProcess(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
  );
  const parsed = JSON.parse(output);
  const user = clean(parsed.user, 320);
  const pass = clean(parsed.pass, 1_000);
  return user && pass ? { user, pass, source: "windows-dpapi" } : null;
}

function normalizeRecipients(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[\n,;]+/);
  return [...new Set(values.map((item) => clean(item, 320)).filter(validEmail))];
}

function normalizeTriggers(value) {
  return {
    humanRequests: value?.humanRequests !== false,
    agentCompletion: value?.agentCompletion !== false,
    dlcAlerts: value?.dlcAlerts !== false,
  };
}

function renderMessage(event, config) {
  const severity = clean(event.severity || "important", 40).toUpperCase();
  const title = clean(event.title || "SCOPE notification", 240);
  const summary = clean(event.summary, 8_000);
  const details = Array.isArray(event.details)
    ? event.details
        .slice(0, 30)
        .map((detail) => clean(detail, 2_000))
        .filter(Boolean)
    : [];
  const monitorUrl = clean(config?.monitorUrl || "http://localhost:3000/", 2_000);
  const timestamp = new Date(event.timestamp || Date.now()).toISOString();
  const subject = `[SCOPE][${severity}] ${title}`.slice(0, 300);
  const text = [
    title,
    "",
    summary,
    ...(details.length ? ["", ...details.map((detail) => `- ${detail}`)] : []),
    "",
    `Time: ${timestamp}`,
    `Monitor: ${monitorUrl}`,
  ].join("\n");
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#172033;line-height:1.55">',
    `<h2 style="margin:0 0 12px">${htmlEscape(title)}</h2>`,
    `<p style="white-space:pre-wrap">${htmlEscape(summary)}</p>`,
    ...(details.length
      ? [
          "<ul>",
          ...details.map((detail) => `<li>${htmlEscape(detail)}</li>`),
          "</ul>",
        ]
      : []),
    `<p style="color:#667085;font-size:12px">Time: ${htmlEscape(timestamp)}</p>`,
    `<p><a href="${htmlEscape(monitorUrl)}">Open SCOPE monitor</a></p>`,
    "</div>",
  ].join("");
  return { subject, text, html };
}

export class EmailNotifier {
  constructor({
    configPath,
    statePath,
    environment = process.env,
    now = () => Date.now(),
    transportFactory = (options) => nodemailer.createTransport(options),
  }) {
    this.configPath = configPath;
    this.statePath = statePath;
    this.environment = environment;
    this.now = now;
    this.transportFactory = transportFactory;
    this.config = null;
    this.state = { version: 1, events: {}, lastSentAt: null };
    this.transport = null;
    this.credentialSource = null;
    this.credentialUser = "";
    this.hasPassword = false;
    this.lastError = null;
    this.queue = Promise.resolve();
  }

  async initialize() {
    this.transport?.close?.();
    this.transport = null;
    this.credentialSource = null;
    this.credentialUser = "";
    this.hasPassword = false;
    this.lastError = null;
    this.config = await readJson(this.configPath, null);
    this.state = await readJson(this.statePath, this.state);

    let credential = null;
    let credentialError = null;
    try {
      credential = await loadCredential(
        this.config,
        path.dirname(this.configPath),
        this.environment,
      );
    } catch (error) {
      credentialError = error;
    }

    if (credential) {
      this.credentialSource = credential.source;
      this.credentialUser = credential.user;
      this.hasPassword = Boolean(credential.pass);
    }

    if (!this.config?.enabled) {
      return this;
    }

    const recipients = normalizeRecipients(this.config.to);
    if (!recipients.length) {
      this.lastError = "邮件收件地址无效";
      return this;
    }
    const smtpHost = clean(this.config.smtp?.host, 320);
    if (!smtpHost) {
      this.lastError = "尚未配置 SMTP 服务器地址";
      return this;
    }
    if (credentialError) {
      this.lastError = `SMTP 凭据不可用：${clean(credentialError.message, 600)}`;
      return this;
    }
    if (!credential) {
      this.lastError = "尚未配置 SMTP 凭据";
      return this;
    }
    try {
      const port = Number(this.config.smtp?.port) || 465;
      this.transport = this.transportFactory({
        host: smtpHost,
        port,
        secure:
          typeof this.config.smtp?.secure === "boolean"
            ? this.config.smtp.secure
            : port === 465,
        requireTLS: port !== 465,
        auth: { user: credential.user, pass: credential.pass },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    } catch (error) {
      this.lastError = `SMTP 初始化失败：${clean(error.message, 600)}`;
    }
    return this;
  }

  publicState() {
    return {
      enabled: Boolean(this.config?.enabled),
      configured: Boolean(this.transport),
      to: normalizeRecipients(this.config?.to),
      provider: clean(this.config?.smtp?.host || "", 320),
      credentialSource: this.credentialSource,
      lastSentAt: this.state.lastSentAt || null,
      lastError: this.lastError,
    };
  }

  configView() {
    const port = Number(this.config?.smtp?.port) || 465;
    return {
      enabled: Boolean(this.config?.enabled),
      configured: Boolean(this.transport),
      to: normalizeRecipients(this.config?.to),
      from: clean(this.config?.from, 500),
      monitorUrl: clean(this.config?.monitorUrl || "http://localhost:3000/", 2_000),
      cooldownMinutes: Number.isFinite(Number(this.config?.cooldownMinutes))
        ? Number(this.config.cooldownMinutes)
        : 15,
      triggers: normalizeTriggers(this.config?.triggers),
      smtp: {
        host: clean(this.config?.smtp?.host, 320),
        port,
        secure:
          typeof this.config?.smtp?.secure === "boolean"
            ? this.config.smtp.secure
            : port === 465,
      },
      smtpUser: this.credentialUser || "",
      hasPassword: Boolean(this.hasPassword),
      credentialSource: this.credentialSource,
      lastSentAt: this.state.lastSentAt || null,
      lastError: this.lastError,
    };
  }

  async saveConfig(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("配置必须是对象");
    }
    const enabled = Boolean(input.enabled);
    const recipients = normalizeRecipients(input.to);
    if (enabled && !recipients.length) {
      throw new Error("请填写至少一个有效的收件邮箱");
    }
    const smtpHost = clean(input.smtp?.host, 320);
    if (enabled && !smtpHost) {
      throw new Error("请填写 SMTP 服务器地址");
    }
    if (smtpHost && !/^[a-zA-Z0-9._-]+$/.test(smtpHost)) {
      throw new Error("SMTP 服务器地址格式无效");
    }
    const port = input.smtp?.port === undefined || input.smtp?.port === ""
      ? 465
      : Number(input.smtp.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("SMTP 端口必须是 1 到 65535 的整数");
    }
    const secure = typeof input.smtp?.secure === "boolean"
      ? input.smtp.secure
      : port === 465;
    const cooldownRaw = input.cooldownMinutes === undefined || input.cooldownMinutes === ""
      ? 15
      : Number(input.cooldownMinutes);
    if (!Number.isFinite(cooldownRaw) || cooldownRaw < 0 || cooldownRaw > 1440) {
      throw new Error("冷却时间必须在 0 到 1440 分钟之间");
    }
    const monitorUrl = clean(input.monitorUrl || "http://localhost:3000/", 2_000);
    if (monitorUrl && !/^https?:\/\//i.test(monitorUrl)) {
      throw new Error("监控访问地址必须以 http:// 或 https:// 开头");
    }
    const from = clean(input.from, 500);
    if (/[\r\n]/.test(from)) {
      throw new Error("发件人格式无效");
    }

    const configDirectory = path.dirname(this.configPath);
    const secretPath = resolveSecretPath(this.config, configDirectory);
    if (input.clearCredentials === true) {
      await rm(secretPath, { force: true }).catch(() => {});
    } else {
      const incomingUser = input.smtpUser !== undefined ? clean(input.smtpUser, 320) : undefined;
      const incomingPass = input.smtpPass !== undefined ? clean(input.smtpPass, 1_000) : undefined;
      if (incomingUser !== undefined || (incomingPass !== undefined && incomingPass !== "")) {
        const existingSecret = await readJson(secretPath, null);
        const nextUser = incomingUser !== undefined ? incomingUser : clean(existingSecret?.user || this.credentialUser, 320);
        const nextPass = incomingPass !== undefined && incomingPass !== ""
          ? incomingPass
          : clean(existingSecret?.pass, 1_000);
        if (nextUser && nextPass) {
          await writeJsonAtomic(
            secretPath,
            {
              user: nextUser,
              pass: nextPass,
              updatedAt: new Date(this.now()).toISOString(),
            },
            0o600,
          );
        } else if (incomingPass) {
          throw new Error("请同时填写 SMTP 登录账号与授权码");
        }
      }
    }

    const previousCredentialFile = input.clearCredentials === true
      ? undefined
      : clean(this.config?.smtp?.credentialFile, 1_000) || undefined;
    const nextConfig = {
      enabled,
      to: recipients,
      from,
      monitorUrl,
      cooldownMinutes: Math.round(cooldownRaw),
      triggers: normalizeTriggers(input.triggers),
      smtp: {
        host: smtpHost,
        port,
        secure,
        secretFile: DEFAULT_SECRET_FILE,
        ...(previousCredentialFile ? { credentialFile: previousCredentialFile } : {}),
      },
    };
    await writeJsonAtomic(this.configPath, nextConfig, 0o600);
    await this.initialize();
    if (enabled && !this.transport) {
      throw new Error(this.lastError || "邮件配置已保存，但 SMTP 凭据尚未完整配置");
    }
    return this.configView();
  }

  async verify() {
    if (!this.transport) throw new Error(this.lastError || "邮件通知尚未配置");
    await this.transport.verify();
    this.lastError = null;
    return this.publicState();
  }

  async sendTest() {
    if (!this.transport) {
      await this.initialize();
    }
    if (!this.transport) {
      throw new Error(this.lastError || "请先配置并启用 SMTP 与收件邮箱");
    }
    const recipients = normalizeRecipients(this.config?.to);
    if (!recipients.length) {
      throw new Error("邮件收件地址无效");
    }
    const message = renderMessage(
      {
        severity: "test",
        title: "SCOPE notification channel verified",
        summary: "This is a test notification sent from SCOPE settings. Your SMTP configuration is active.",
        details: [
          `SMTP Host: ${clean(this.config?.smtp?.host, 320)}:${Number(this.config?.smtp?.port) || 465}`,
          `Recipients: ${recipients.join(", ")}`,
        ],
        timestamp: new Date(this.now()).toISOString(),
      },
      this.config,
    );
    const from =
      clean(this.config?.from, 500) ||
      clean(this.credentialUser, 320) ||
      clean(this.environment.SCOPE_EMAIL_SMTP_USER, 320) ||
      recipients[0];
    const result = await this.transport.sendMail({
      from,
      to: recipients,
      ...message,
    });
    const sentAt = new Date(this.now()).toISOString();
    this.state.lastSentAt = sentAt;
    this.lastError = null;
    await writeJsonAtomic(this.statePath, this.state);
    return { sent: true, messageId: result?.messageId || null };
  }

  #eventTriggerEnabled(event) {
    const triggers = normalizeTriggers(this.config?.triggers);
    if (event.key.startsWith("human-request:")) return triggers.humanRequests;
    if (event.key.startsWith("agent-completion:")) return triggers.agentCompletion;
    if (event.key.startsWith("dlc-alert:")) return triggers.dlcAlerts;
    return true;
  }

  async prime(events) {
    const primedAt = new Date(this.now()).toISOString();
    for (const event of events) {
      if (!event?.key) continue;
      this.state.events[event.key] = {
        fingerprint: fingerprint(event),
        primedAt,
        sentAt: this.state.events[event.key]?.sentAt || null,
      };
    }
    await writeJsonAtomic(this.statePath, this.state);
  }

  notify(event) {
    this.queue = this.queue
      .catch(() => {})
      .then(() => this.#notify(event));
    return this.queue;
  }

  async #notify(event) {
    if (!event?.key || !event?.title) {
      return { sent: false, reason: "invalid-event" };
    }
    if (!this.#eventTriggerEnabled(event)) {
      return { sent: false, reason: "trigger-disabled" };
    }
    const eventFingerprint = fingerprint(event);
    const previous = this.state.events[event.key];
    if (previous?.fingerprint === eventFingerprint) {
      return { sent: false, reason: "duplicate" };
    }
    if (!this.transport) {
      return { sent: false, reason: this.lastError || "not-configured" };
    }
    const cooldownMs = Math.max(
      0,
      Number(this.config.cooldownMinutes) * 60_000 || DEFAULT_COOLDOWN_MS,
    );
    if (
      previous?.attemptedAt &&
      this.now() - Date.parse(previous.attemptedAt) < cooldownMs
    ) {
      return { sent: false, reason: "cooldown" };
    }
    const attemptedAt = new Date(this.now()).toISOString();
    this.state.events[event.key] = {
      ...previous,
      attemptedAt,
      pendingFingerprint: eventFingerprint,
    };
    await writeJsonAtomic(this.statePath, this.state);
    try {
      const message = renderMessage(event, this.config);
      const recipients = normalizeRecipients(this.config.to);
      const from =
        clean(this.config.from, 500) ||
        clean(this.credentialUser, 320) ||
        clean(this.environment.SCOPE_EMAIL_SMTP_USER, 320) ||
        recipients[0];
      const result = await this.transport.sendMail({
        from,
        to: recipients,
        ...message,
      });
      const sentAt = new Date(this.now()).toISOString();
      this.state.events[event.key] = {
        fingerprint: eventFingerprint,
        attemptedAt,
        sentAt,
        messageId: clean(result?.messageId, 500) || null,
      };
      this.state.lastSentAt = sentAt;
      this.lastError = null;
      await writeJsonAtomic(this.statePath, this.state);
      return { sent: true, messageId: result?.messageId || null };
    } catch (error) {
      this.lastError = `邮件发送失败：${clean(error.message, 600)}`;
      await writeJsonAtomic(this.statePath, this.state);
      console.error(this.lastError);
      return { sent: false, reason: this.lastError };
    }
  }
}

export async function createEmailNotifier(options) {
  return new EmailNotifier(options).initialize();
}

export function humanRequestEmailEvent(request) {
  const question = request.questions?.[0];
  const details = [
    `Host: ${clean(request.host, 300)}`,
    `Session: ${clean(request.threadId, 300)}`,
    request.cwd ? `Directory: ${clean(request.cwd, 1_000)}` : "",
    request.reason ? `Reason: ${clean(request.reason, 2_000)}` : "",
    question ? `Question: ${clean(question.question, 2_000)}` : "",
  ].filter(Boolean);
  return {
    key: `human-request:${request.key}`,
    severity: request.kind === "user-input" ? "action" : "approval",
    title: request.title || "Codex 等待你的处理",
    summary:
      request.kind === "user-input"
        ? "Codex 在 WebUI 中等待你的回答。"
        : "Codex 在 WebUI 中等待你的审批。",
    details,
    timestamp: request.receivedAt,
  };
}

export function dlcAlertEmailEvent(alert, scannedAt) {
  return {
    key: `dlc-alert:${alert.host}:${alert.sessionId}`,
    severity: "critical",
    title: `DLC 高失败告警：${clean(alert.sessionTheme, 180)}`,
    summary:
      `${alert.total} 个关联 Job 中 ${alert.failed} 个失败或终止，` +
      `${alert.queued} 个仍在排队，${alert.running} 个仍在运行。`,
    details: [
      `Host: ${clean(alert.host, 300)}`,
      `Session: ${clean(alert.sessionId, 300)}`,
      `Directory: ${clean(alert.cwd, 1_000)}`,
    ],
    timestamp: scannedAt,
  };
}
