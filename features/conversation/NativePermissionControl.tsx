"use client";
import { ShieldCheck } from "lucide-react";
import { ChoiceMenu } from "@/components/choice-menu";

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
  return (
    <div className="native-permission-control">
      <ChoiceMenu
        label="CLI 会话权限"
        fieldLabel={compact ? undefined : "权限"}
        value={value}
        disabled={disabled}
        compact={compact}
        icon={<ShieldCheck size={14} />}
        onChange={(next) => onChange(next as NativePermission)}
        options={[
          ...(provider === "antigravity" ? [{ value: "full", label: "完全访问", description: "跳过工具权限审批（--dangerously-skip-permissions）" }] : []),
          ...(["claude", "antigravity"].includes(provider || "") ? [{ value: "auto", label: "自动审批", disabled: autoSupported === false, description: autoSupported === false ? "当前账号、模型或 CLI 不支持" : "自动评估工具操作；高风险操作仍可能被拒绝" },
            { value: "plan", label: "规划模式", description: provider === "antigravity" ? "先调查并生成计划；不是只读权限隔离" : "调查和规划，不执行修改" }] : []),
          {
            value: "default",
            label: "默认权限",
            description: "沿用 CLI 的权限设置",
          },
          {
            value: "workspace",
            label: "工作区编辑",
            description: "允许工作区编辑；越界操作仍需审批",
          },
        ]}
      />
    </div>
  );
}
