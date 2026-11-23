"use client";
import { useState } from "react";
import {
  Bot,
  Check,
  KeyRound,
  Mail,
  Plug,
  Save,
  Server,
  Sliders,
} from "lucide-react";
import type { Host } from "@/features/workspace/types";
import type { WorkbenchConfig, WorkbenchState } from "./types";
import type { WorkbenchClient } from "./use-workbench";
import { PluginSettings } from "@/features/plugins/PluginSettings";
import { GeneralSettingsTab } from "@/features/settings/GeneralSettingsTab";
import { HostsDeployTab } from "@/features/settings/HostsDeployTab";
import { AgentsAccountsTab } from "@/features/settings/AgentsAccountsTab";
import { EmailSettingsTab } from "@/features/settings/EmailSettingsTab";
import "@/features/settings/settings-hub.css";
import { useLocale, type SettingsTab } from "@/lib/i18n";

export function WorkbenchSettings({
  state,
  hosts,
  busy,
  mutate,
  onAccounts,
  tab,
  onTabChange,
  operatorName = "Operator",
  onSaveOperatorName,
}: Pick<WorkbenchClient, "busy" | "mutate"> & {
  state: WorkbenchState;
  hosts: Host[];
  onAccounts: () => void;
  tab?: SettingsTab;
  onTabChange?: (next: SettingsTab) => void;
  operatorName?: string;
  onSaveOperatorName?: (name: string) => Promise<void>;
}) {
  const { tr } = useLocale();
  const [localTab, setLocalTab] = useState<SettingsTab>("general");
  const activeTab = tab ?? localTab;
  const setActiveTab = (next: SettingsTab) => {
    setLocalTab(next);
    onTabChange?.(next);
  };

  const [draft, setDraft] = useState<WorkbenchConfig>(() =>
    structuredClone(state.config),
  );
  const [revision, setRevision] = useState(state.configRevision || 0);
  const [saved, setSaved] = useState(false);

  function update(value: WorkbenchConfig) {
    setDraft(value);
    setSaved(false);
  }

  async function save() {
    try {
      const result = await mutate("config", { config: draft, revision });
      setRevision(result.configRevision);
      setDraft(result.config);
      setSaved(true);
    } catch {
      /* shared error region */
    }
  }

  const tabs: { id: SettingsTab; label: string; icon: typeof Sliders }[] = [
    { id: "general", label: tr("常规与总调度", "General & Coordinator"), icon: Sliders },
    { id: "hosts", label: tr("远程主机与部署", "Hosts & Remote Deploy"), icon: Server },
    { id: "agents", label: tr("Agent 与账号", "Agents & Accounts"), icon: Bot },
    { id: "email", label: tr("邮件与通知", "Email & Notifications"), icon: Mail },
    { id: "plugins", label: tr("插件扩展", "Plugins"), icon: Plug },
  ];

  const needsConfigSave = activeTab === "general" || activeTab === "agents";

  return (
    <section className="workbench-settings settings-hub">
      <header className="center-page-heading">
        <div>
          <span className="center-eyebrow">
            {tr("SCOPE / 设置与管理", "SCOPE / Settings & Management")}
          </span>
          <h1>{tr("统一管理主机、Agent、通知与插件。", "Configure hosts, agents, alerts, and plugins.")}</h1>
          <p>
            {tr(
              "按需配置远端代理、邮箱凭据与服务部署；敏感信息全部留在本机 .scope/ 目录。",
              "All credentials, host runtime commands, and remote services stay under your local .scope/ directory.",
            )}
          </p>
        </div>
        <button type="button" className="center-secondary" onClick={onAccounts}>
          <KeyRound size={15} /> {tr("Codex 账号", "Codex Accounts")}
        </button>
      </header>

      <nav className="settings-hub-tabs" role="tablist" aria-label={tr("设置分组", "Settings sections")}>
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={activeTab === item.id}
              className={`settings-hub-tab ${activeTab === item.id ? "active" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              <Icon size={15} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {needsConfigSave ? (
        <form
          className="settings-hub-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {activeTab === "general" ? (
            <GeneralSettingsTab
              draft={draft}
              update={update}
              state={state}
              hosts={hosts}
              operatorName={operatorName}
              onSaveOperatorName={onSaveOperatorName}
            />
          ) : (
            <AgentsAccountsTab
              draft={draft}
              update={update}
              onAccounts={onAccounts}
            />
          )}

          <div className="settings-hub-body" style={{ paddingTop: 0 }}>
            <footer className="settings-footer" style={{ paddingTop: 6 }}>
              {revision !== (state.configRevision || 0) && (
                <button
                  type="button"
                  className="center-secondary"
                  onClick={() => {
                    setDraft(structuredClone(state.config));
                    setRevision(state.configRevision || 0);
                  }}
                >
                  {tr("载入最新配置", "Reload latest")}
                </button>
              )}
              {saved && (
                <span role="status">
                  <Check size={15} /> {tr("工作台配置已保存", "Settings saved")}
                </span>
              )}
              <button className="center-primary" disabled={busy}>
                <Save size={15} /> {tr("保存工作台配置", "Save settings")}
              </button>
            </footer>
          </div>
        </form>
      ) : activeTab === "hosts" ? (
        <HostsDeployTab hosts={hosts} />
      ) : activeTab === "email" ? (
        <EmailSettingsTab />
      ) : (
        <div className="settings-hub-body">
          <PluginSettings hosts={hosts} />
        </div>
      )}
    </section>
  );
}
