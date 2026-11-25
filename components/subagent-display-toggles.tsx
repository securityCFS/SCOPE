"use client";
import { RotateCcw } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import {
  isDefaultSubagentDisplayPrefs,
  useSubagentDisplayPrefs,
  type SubagentDisplayPrefs,
} from "@/lib/subagent-display-prefs";
import "./subagent-display-toggles.css";

type ToggleSpec = {
  key: keyof SubagentDisplayPrefs;
  drawerTitle: string;
  drawerDesc: string;
  settingsTitle: string;
  settingsDesc: string;
  disabled?: boolean;
};

export function SubagentDisplayToggles({
  variant,
}: {
  variant: "drawer" | "settings";
}) {
  const { tr } = useLocale();
  const { prefs, updatePrefs, resetPrefs } = useSubagentDisplayPrefs();
  const isDefault = isDefaultSubagentDisplayPrefs(prefs);

  const items: ToggleSpec[] = [
    {
      key: "showInlineCards",
      drawerTitle: tr("任务派发卡片", "Inline spawn cards"),
      drawerDesc: tr("对话中展示新建子代理与指令", "Show spawned agents per turn"),
      settingsTitle: tr("对话流任务派发卡片", "Inline subagent spawn cards"),
      settingsDesc: tr(
        "在对话中显示「当前任务新建了 N 个子代理」卡片与底部汇总",
        "Show per-turn 'Spawned N subagents' cards and summary bar in the feed",
      ),
    },
    {
      key: "showInteractions",
      drawerTitle: tr("主/子会话互动", "Parent ↔ subagent feed"),
      drawerDesc: tr("回传报告、跨会话消息与通知", "Handbacks, messages & notices"),
      settingsTitle: tr("主/子会话双向互动消息", "Parent ↔ subagent interaction messages"),
      settingsDesc: tr(
        "在对话流中显示子代理回传报告、跨会话 SendMessage 与后台任务通知",
        "Show subagent handback reports, SendMessage exchanges, and background notifications",
      ),
    },
    {
      key: "autoExpandInteractions",
      drawerTitle: tr("默认展开回传正文", "Auto-expand handbacks"),
      drawerDesc: tr("免点击直接展示回传详情", "Open handback reports by default"),
      settingsTitle: tr("默认展开回传与协作消息正文", "Auto-expand handback & interaction bodies"),
      settingsDesc: tr(
        "开启后无需逐条点击展开，直接显示主/子会话回传和协作详情",
        "Expand subagent handbacks and collaboration message bodies automatically",
      ),
      disabled: !prefs.showInteractions,
    },
    {
      key: "showHeaderBadge",
      drawerTitle: tr("顶栏「子代理」入口", "Header shortcut badge"),
      drawerDesc: tr("会话顶部显示「子代理 · N」按钮", "Show 'Subagents · N' in header"),
      settingsTitle: tr("会话顶栏「子代理 · N」快捷入口", "Header 'Subagents · N' shortcut button"),
      settingsDesc: tr(
        "在会话顶部显示子代理数量与快速打开入口（关闭后仍可在此重新开启）",
        "Show the subagent count and quick-open button in the conversation header",
      ),
    },
  ];

  const renderToggle = (item: ToggleSpec) => {
    const checked = Boolean(prefs[item.key]);
    const disabled = Boolean(item.disabled);
    const title = variant === "drawer" ? item.drawerTitle : item.settingsTitle;
    const desc = variant === "drawer" ? item.drawerDesc : item.settingsDesc;
    return (
      <button
        key={item.key}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        data-pref-key={item.key}
        className={`${variant === "drawer" ? "subagent-pref-card" : "subagent-pref-row"}${disabled ? " is-disabled" : ""}`}
        onClick={() => {
          if (disabled) return;
          updatePrefs({ [item.key]: !checked });
        }}
      >
        <span className="subagent-pref-copy">
          <span className="subagent-pref-title">{title}</span>
          <span className="subagent-pref-desc">{desc}</span>
        </span>
        <span
          className={`scope-switch${checked ? " is-checked" : ""}`}
          aria-hidden="true"
        >
          <span className="scope-switch-thumb" />
        </span>
      </button>
    );
  };

  if (variant === "settings") {
    return (
      <div
        className="subagent-prefs-list"
        role="group"
        aria-label={tr("子代理显示设置", "Subagent display settings")}
      >
        {items.map(renderToggle)}
      </div>
    );
  }

  return (
    <div
      className="subagent-prefs-panel"
      role="group"
      aria-label={tr("对话流子代理显示开关", "Conversation subagent display toggles")}
    >
      <div className="subagent-prefs-head">
        <div className="subagent-prefs-head-copy">
          <span className="subagent-prefs-head-title">
            {tr("对话流显示开关", "Conversation display")}
          </span>
          <span className="subagent-prefs-head-hint">
            {tr("即时生效", "Applies instantly")}
          </span>
        </div>
        {!isDefault && (
          <button
            type="button"
            className="subagent-prefs-reset"
            onClick={() => resetPrefs()}
          >
            <RotateCcw size={11} />
            {tr("恢复默认", "Reset")}
          </button>
        )}
      </div>
      <div className="subagent-prefs-grid">{items.map(renderToggle)}</div>
    </div>
  );
}
