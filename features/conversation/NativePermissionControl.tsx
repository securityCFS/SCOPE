"use client";
import { ShieldCheck } from "lucide-react";
import { ChoiceMenu } from "@/components/choice-menu";
import { useLocale } from "@/lib/i18n";

export type NativePermission = "default" | "workspace" | "auto" | "plan" | "full";
export function NativePermissionControl({
  value,
  onChange,
  disabled = false,
  compact = false,
  provider,
  autoSupported,
}: {
  value: NativePermission;
  onChange: (value: NativePermission) => void;
  disabled?: boolean;
  compact?: boolean;
  provider?: string;
  autoSupported?: boolean | null;
}) {
  const { tr } = useLocale();
  return (
    <div className="native-permission-control">
      <ChoiceMenu
        label={tr("CLI 会话权限", "CLI permissions")}
        fieldLabel={compact ? undefined : tr("权限", "Permissions")}
        value={value}
        disabled={disabled}
        compact={compact}
        icon={<ShieldCheck size={14} />}
        onChange={(next) => onChange(next as NativePermission)}
        options={[
          ...(provider === "antigravity"
            ? [{ value: "full", label: tr("完全访问", "Full access"), description: tr("跳过工具权限审批（--dangerously-skip-permissions）", "Skip tool approval prompts (--dangerously-skip-permissions)") }]
            : []),
          ...(["claude", "antigravity"].includes(provider || "")
            ? [
                { value: "auto", label: tr("自动审批", "Auto approve"), disabled: autoSupported === false, description: autoSupported === false ? tr("当前账号、模型或 CLI 不支持", "Not supported by current account, model, or CLI") : tr("自动评估工具操作；高风险操作仍可能被拒绝", "Automatically evaluates tool calls; high-risk actions may still be blocked") },
                { value: "plan", label: tr("规划模式", "Plan mode"), description: provider === "antigravity" ? tr("先调查并生成计划；不是只读权限隔离", "Explore and draft a plan first") : tr("调查和规划，不执行修改", "Investigate and plan without edits") },
              ]
            : []),
          {
            value: "default",
            label: tr("默认权限", "Default"),
            description: tr("沿用 CLI 的权限设置", "Use the CLI's default permission policy"),
          },
          {
            value: "workspace",
            label: tr("工作区编辑", "Workspace edit"),
            description: tr("允许工作区编辑；越界操作仍需审批", "Allow workspace edits; prompt for outside operations"),
          },
        ]}
      />
    </div>
  );
}
