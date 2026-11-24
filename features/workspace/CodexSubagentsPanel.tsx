"use client";
import { Bot, ChevronRight, LoaderCircle } from "lucide-react";
import type { SubagentDrawerItem } from "@/components/subagent-workflow-drawer";
import type { Rollout } from "@/features/workspace/types";
import { useLocale } from "@/lib/i18n";

export function codexSubagentLabel(subagent: Rollout): string {
  return (
    subagent.agentNickname ||
    subagent.agentPath ||
    subagent.id.slice(0, 8)
  );
}

export function codexSubagentStatus(subagent: Rollout): string {
  return subagent.turnState === "working" ? "working" : "completed";
}

export function toCodexDrawerItems(subagents: Rollout[]): SubagentDrawerItem[] {
  return subagents.map((sub) => ({
    id: sub.id,
    label: codexSubagentLabel(sub),
    role: sub.agentNickname || sub.agentPath || sub.firstUser || sub.id.slice(0, 8),
    typeName: sub.agentRole || "",
    model: sub.model || "",
    status: codexSubagentStatus(sub),
    lastAction: sub.lastAction || sub.lastAssistant || sub.lastUser || "",
  }));
}

export function CodexSubagentRows({
  subagents,
  onInspect,
}: {
  subagents: Rollout[];
  onInspect: (subagent: Rollout) => void;
}) {
  const { tr } = useLocale();
  return (
    <div className="codex-subagents-list">
      {subagents.map((subagent) => {
        const status = codexSubagentStatus(subagent);
        const label = codexSubagentLabel(subagent);
        const summary =
          subagent.lastAction ||
          subagent.lastAssistant ||
          subagent.lastUser ||
          tr("暂无活动摘要", "No recent activity");
        return (
          <button
            type="button"
            key={subagent.id}
            className="codex-subagent-row"
            onClick={() => onInspect(subagent)}
            title={tr("点击查看子代理实际工作流", "Inspect subagent workflow")}
          >
            <div className="codex-subagent-row-main">
              <div className="codex-subagent-row-title">
                <span className={`subagent-dot is-${status}`} />
                <strong title={label}>{label}</strong>
                {subagent.agentRole && (
                  <span className="codex-subagent-role-pill">
                    {subagent.agentRole}
                  </span>
                )}
                {subagent.model && (
                  <span className="codex-subagent-role-pill">
                    {subagent.model}
                  </span>
                )}
              </div>
              <span className="codex-subagent-row-sub" title={summary}>
                {summary}
              </span>
            </div>
            <ChevronRight size={14} />
          </button>
        );
      })}
    </div>
  );
}

export function CodexSubagentsCard({
  subagents,
  onInspect,
}: {
  subagents: Rollout[];
  onInspect: (subagent: Rollout) => void;
}) {
  const { tr } = useLocale();
  if (!subagents.length) return null;
  const workingCount = subagents.filter(
    (sub) => codexSubagentStatus(sub) === "working",
  ).length;
  const finishedCount = subagents.length - workingCount;

  if (workingCount > 0) {
    return (
      <section
        className="codex-subagents-card is-working"
        aria-label={tr("Codex 子代理状态", "Codex subagents")}
      >
        <div className="codex-subagents-head">
          <LoaderCircle size={13} className="is-spinning" />
          <strong>
            {tr(
              `Codex 子代理工作中 · ${workingCount} 个运行中`,
              `Codex subagents working · ${workingCount} active`,
            )}
          </strong>
          {finishedCount > 0 && (
            <span>
              {tr(` · ${finishedCount} 个已完成`, ` · ${finishedCount} done`)}
            </span>
          )}
        </div>
        <CodexSubagentRows subagents={subagents} onInspect={onInspect} />
      </section>
    );
  }

  return (
    <details className="codex-subagents-card">
      <summary className="codex-subagents-head">
        <Bot size={13} />
        <span>
          {tr(
            `Codex 子代理记录 · ${subagents.length} 个已完成`,
            `Codex subagents · ${subagents.length} completed`,
          )}
        </span>
      </summary>
      <CodexSubagentRows subagents={subagents} onInspect={onInspect} />
    </details>
  );
}
