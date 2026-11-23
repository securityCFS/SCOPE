"use client";
import { useEffect, useState } from "react";
import { Check, Mail, Save, Send, ShieldCheck, Trash2 } from "lucide-react";
import { bridgeUrl } from "@/features/workspace/shared";
import { useLocale } from "@/lib/i18n";

type EmailConfigState = {
  enabled: boolean;
  configured: boolean;
  to: string[];
  from: string;
  monitorUrl: string;
  cooldownMinutes: number;
  triggers: {
    humanRequests: boolean;
    agentCompletion: boolean;
    dlcAlerts: boolean;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
  };
  smtpUser: string;
  hasPassword: boolean;
  credentialSource: string | null;
  lastSentAt: string | null;
  lastError: string | null;
};

const PRESETS = [
  { id: "gmail", label: "Gmail", host: "smtp.gmail.com", port: 465, secure: true },
  { id: "outlook", label: "Outlook / 365", host: "smtp.office365.com", port: 587, secure: false },
  { id: "qq", label: "QQ Mail", host: "smtp.qq.com", port: 465, secure: true },
  { id: "163", label: "163 Mail", host: "smtp.163.com", port: 465, secure: true },
  { id: "feishu", label: "Feishu / Lark", host: "smtp.feishu.cn", port: 465, secure: true },
];

export function EmailSettingsTab() {
  const { tr } = useLocale();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(465);
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [credentialSource, setCredentialSource] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [toText, setToText] = useState("");
  const [cooldownMinutes, setCooldownMinutes] = useState(15);
  const [monitorUrl, setMonitorUrl] = useState("http://localhost:3000/");
  const [triggers, setTriggers] = useState({
    humanRequests: true,
    agentCompletion: true,
    dlcAlerts: true,
  });
  const [lastError, setLastError] = useState<string | null>(null);

  function applyServerState(s: EmailConfigState) {
    setEnabled(Boolean(s.enabled));
    setSmtpHost(s.smtp?.host || "");
    setSmtpPort(s.smtp?.port || 465);
    setSmtpSecure(Boolean(s.smtp?.secure));
    setSmtpUser(s.smtpUser || "");
    setHasPassword(Boolean(s.hasPassword));
    setCredentialSource(s.credentialSource || null);
    setFrom(s.from || "");
    setToText((s.to || []).join(", "));
    setCooldownMinutes(s.cooldownMinutes ?? 15);
    setMonitorUrl(s.monitorUrl || "http://localhost:3000/");
    setTriggers({
      humanRequests: s.triggers?.humanRequests !== false,
      agentCompletion: s.triggers?.agentCompletion !== false,
      dlcAlerts: s.triggers?.dlcAlerts !== false,
    });
    setLastError(s.lastError || null);
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch(bridgeUrl("/api/email/settings"), {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data: EmailConfigState) => {
        if (!cancelled) {
          applyServerState(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  async function save(clearCredentials = false) {
    setBusy("save");
    setNotice(null);
    try {
      const response = await fetch(bridgeUrl("/api/email/settings"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled,
          smtp: { host: smtpHost, port: smtpPort, secure: smtpSecure },
          smtpUser,
          ...(smtpPass ? { smtpPass } : {}),
          ...(clearCredentials ? { clearCredentials: true } : {}),
          from,
          to: toText,
          cooldownMinutes,
          monitorUrl,
          triggers,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || tr("保存邮件配置失败", "Failed to save email settings"));
      applyServerState(result.settings);
      setSmtpPass("");
      setNotice({
        kind: "success",
        text: clearCredentials
          ? tr("已清除本机保存的 SMTP 凭据。", "Saved SMTP credentials cleared.")
          : tr("邮件配置已保存并立即热生效。", "Email settings saved and active immediately."),
      });
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function verifyOrTest(kind: "verify" | "test") {
    setBusy(kind);
    setNotice(null);
    try {
      const response = await fetch(bridgeUrl(`/api/email/${kind}`), { method: "POST" });
      const result = await response.json();
      if (result.settings) applyServerState(result.settings);
      if (!response.ok) throw new Error(result.error || tr("操作失败", "Operation failed"));
      setNotice({
        kind: "success",
        text:
          kind === "verify"
            ? tr("SMTP 连接与认证校验成功！", "SMTP connection and authentication verified!")
            : tr("测试邮件已发送，请检查收件箱。", "Test email sent. Check your inbox."),
      });
    } catch (error) {
      setNotice({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <div className="settings-hub-body">
        <p className="settings-status-banner">{tr("正在读取邮件配置…", "Loading email settings…")}</p>
      </div>
    );
  }

  return (
    <div className="settings-hub-body">
      <div className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>
              <Mail size={16} />
              {tr("SMTP 邮件服务配置", "SMTP Mail Configuration")}
            </h2>
            <p>
              {tr(
                "所有邮箱账号与授权码仅保存在你本机 .scope/ 目录（0600 权限），不会上传到仓库，也不会发送到远端 GPU 主机。",
                "SMTP usernames and app passwords are stored only on your local workstation under .scope/ (mode 0600), never pushed to Git or copied to remote hosts.",
              )}
            </p>
          </div>
          <label className="provider-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {tr("启用邮件通知", "Enable email notifications")}
          </label>
        </div>

        <div>
          <span style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 8 }}>
            {tr("快速填充常见邮箱服务器", "Provider presets")}
          </span>
          <div className="smtp-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`smtp-preset-btn ${smtpHost === preset.host && smtpPort === preset.port ? "active" : ""}`}
                onClick={() => {
                  setSmtpHost(preset.host);
                  setSmtpPort(preset.port);
                  setSmtpSecure(preset.secure);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="center-form-grid">
          <label>
            {tr("SMTP 服务器", "SMTP host")}
            <input
              value={smtpHost}
              placeholder="smtp.example.com"
              onChange={(e) => setSmtpHost(e.target.value)}
            />
          </label>
          <label>
            {tr("端口", "Port")}
            <input
              type="number"
              min={1}
              max={65535}
              value={smtpPort}
              onChange={(e) => setSmtpPort(Number(e.target.value) || 465)}
            />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">
              {tr("SMTP 登录账号", "SMTP username")}
            </span>
            <input
              value={smtpUser}
              placeholder="you@example.com"
              onChange={(e) => setSmtpUser(e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span
              className="settings-field-label"
              style={{ justifyContent: "space-between", gap: 8 }}
            >
              <span>{tr("应用授权码 / 密码", "App password / SMTP secret")}</span>
              {hasPassword && (
                <span className="settings-badge ok" style={{ padding: "1px 8px", fontSize: 10.5 }}>
                  <Check size={10} />
                  {tr("已保存", "Saved")} ({credentialSource || "local"})
                </span>
              )}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={smtpPass}
              placeholder={
                hasPassword
                  ? tr("留空保留当前已保存密码", "Leave blank to keep saved secret")
                  : tr("输入邮箱授权码（非登录密码）", "Paste SMTP app password")
              }
              onChange={(e) => setSmtpPass(e.target.value)}
            />
          </label>
          <label>
            {tr("收件邮箱（多个用逗号分隔）", "Recipients (comma-separated)")}
            <input
              value={toText}
              placeholder="alerts@example.com"
              onChange={(e) => setToText(e.target.value)}
            />
          </label>
          <label>
            {tr("发件人显示名（可选）", "From header (optional)")}
            <input
              value={from}
              placeholder="SCOPE Monitor <you@example.com>"
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            {tr("同类告警冷却（分钟）", "Cooldown (minutes)")}
            <input
              type="number"
              min={0}
              max={1440}
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            {tr("邮件内附带的工作台链接", "Monitor link inside emails")}
            <input
              value={monitorUrl}
              placeholder="http://localhost:3000/"
              onChange={(e) => setMonitorUrl(e.target.value)}
            />
          </label>
        </div>

        <div className="settings-check-grid">
          <label className="settings-checkbox" style={{ marginTop: 0 }}>
            <input
              type="checkbox"
              checked={smtpSecure}
              onChange={(e) => setSmtpSecure(e.target.checked)}
            />
            {tr("使用 SSL/TLS 直连（465 端口勾选，587 STARTTLS 取消）", "Direct SSL/TLS (checked for 465, unchecked for 587 STARTTLS)")}
          </label>
        </div>

        <div>
          <span style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 8 }}>
            {tr("通知触发场景", "Notification triggers")}
          </span>
          <div className="settings-check-grid">
            <label className="settings-checkbox" style={{ marginTop: 0 }}>
              <input
                type="checkbox"
                checked={triggers.humanRequests}
                onChange={(e) => setTriggers((prev) => ({ ...prev, humanRequests: e.target.checked }))}
              />
              {tr("待人工审批 / 提问等待", "Pending approvals & questions")}
            </label>
            <label className="settings-checkbox" style={{ marginTop: 0 }}>
              <input
                type="checkbox"
                checked={triggers.agentCompletion}
                onChange={(e) => setTriggers((prev) => ({ ...prev, agentCompletion: e.target.checked }))}
              />
              {tr("远端任务完成 / 失败回执（scope-notify）", "Remote completion / failure alerts (scope-notify)")}
            </label>
            <label className="settings-checkbox" style={{ marginTop: 0 }}>
              <input
                type="checkbox"
                checked={triggers.dlcAlerts}
                onChange={(e) => setTriggers((prev) => ({ ...prev, dlcAlerts: e.target.checked }))}
              />
              {tr("插件高失败告警", "Plugin alert notifications")}
            </label>
          </div>
        </div>

        {notice && (
          <p className={`settings-status-banner ${notice.kind}`}>{notice.text}</p>
        )}
        {!notice && lastError && (
          <p className="settings-status-banner error">{lastError}</p>
        )}

        <div className="settings-actions">
          <button
            type="button"
            className="center-primary"
            disabled={Boolean(busy)}
            onClick={() => void save(false)}
          >
            <Save size={14} />
            {busy === "save" ? tr("保存中…", "Saving…") : tr("保存配置", "Save settings")}
          </button>
          <button
            type="button"
            className="center-secondary"
            disabled={Boolean(busy)}
            onClick={() => void verifyOrTest("verify")}
          >
            <ShieldCheck size={14} />
            {busy === "verify" ? tr("验证中…", "Verifying…") : tr("验证 SMTP 连接", "Verify connection")}
          </button>
          <button
            type="button"
            className="center-secondary"
            disabled={Boolean(busy)}
            onClick={() => void verifyOrTest("test")}
          >
            <Send size={14} />
            {busy === "test" ? tr("发送中…", "Sending…") : tr("发送测试邮件", "Send test email")}
          </button>
          {hasPassword && (
            <button
              type="button"
              className="center-secondary"
              disabled={Boolean(busy)}
              onClick={() => void save(true)}
            >
              <Trash2 size={14} />
              {tr("清除本机凭据", "Clear credentials")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
