"use client";
import { KeyRound } from "lucide-react";
import { AgentLogo } from "@/components/agent-logo";
import type { ProviderId, WorkbenchConfig } from "@/features/command-center/types";
import { PROVIDERS } from "@/lib/workbench-config";
import { useLocale } from "@/lib/i18n";

export function AgentsAccountsTab({
  draft,
  update,
  onAccounts,
}: {
  draft: WorkbenchConfig;
  update: (value: WorkbenchConfig) => void;
  onAccounts: () => void;
}) {
  const { tr } = useLocale();

  function descriptionFor(id: ProviderId) {
    if (id === "codex") return tr("app-server 持续会话 · 支持权限审批与多账号切换", "Persistent app-server · approvals & account failover");
    if (id === "claude") return tr("stream-json 实时对话 · 工具审批与问题卡片", "Live stream-json · approvals & interactive questions");
    if (id === "antigravity") return tr("ACP 实时会话 · 表单审批与模型/强度切换", "ACP live sessions · form approvals & model effort");
    return tr("远端 headless 单次任务", "Remote headless single-turn runner");
  }

  return (
    <div className="settings-hub-body">
      <div className="settings-card">
        <div className="settings-card-head">
          <div>
            <h2>
              <KeyRound size={16} />
              {tr("Agent 账号登录与 Codex 账号池", "Agent Accounts & Codex Failover Pool")}
            </h2>
            <p>
              {tr(
                "统一查看各设备的 Codex、Claude Code 与 Antigravity 登录状态；支持一键打开 SSH 终端登录或切换 Claude / AGY，并管理远端多套 Codex Profile 自动切换。凭据始终留在对应设备上。",
                "Inspect Codex, Claude Code, and Antigravity login state per host, launch interactive SSH login for Claude / AGY, and manage multi-profile Codex failover. Credentials stay on your machines.",
              )}
            </p>
          </div>
          <button type="button" className="center-secondary" onClick={onAccounts}>
            <KeyRound size={14} />
            {tr("打开账号管理", "Manage accounts")}
          </button>
        </div>
      </div>

      <div className="provider-grid">
        {Object.entries(PROVIDERS).map(([key, definition]) => {
          const id = key as ProviderId;
          const provider = draft.providers[id];
          const edit = (field: string, value: string | boolean) =>
            update({
              ...draft,
              providers: {
                ...draft.providers,
                [id]: { ...provider, [field]: value },
              },
            });

          return (
            <article className="provider-card" key={id}>
              <header>
                <div>
                  <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <AgentLogo provider={id} size={20} />
                    {definition.name}
                  </h3>
                  <span>{descriptionFor(id)}</span>
                </div>
                <label className="provider-toggle">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(e) => edit("enabled", e.target.checked)}
                  />
                  {tr("启用", "Enabled")}
                </label>
              </header>
              <label>
                {tr("可执行文件", "Executable")}
                <input
                  value={provider.executable}
                  required
                  onChange={(e) => edit("executable", e.target.value)}
                />
              </label>
              {id !== "dsh" && (
                <label>
                  {tr("新会话默认模型（可选）", "Default model (optional)")}
                  <input
                    value={provider.model}
                    placeholder={tr("沿用远端 CLI 默认模型", "Use remote CLI default")}
                    onChange={(e) => edit("model", e.target.value)}
                  />
                </label>
              )}
              <label className="span-full">
                {tr("Agent 专属启动前命令（可选，留空则沿用主机设置）", "Agent pre-launch override (optional; empty inherits host setting)")}
                <textarea
                  rows={2}
                  value={provider.preLaunchCommand}
                  placeholder={tr(
                    "留空：沿用「远程主机与部署」中为每台服务器配置的环境/代理命令",
                    "Empty: inherits the per-host command configured in Hosts & Remote Deploy",
                  )}
                  onChange={(e) => edit("preLaunchCommand", e.target.value)}
                />
              </label>
            </article>
          );
        })}
      </div>
    </div>
  );
}
