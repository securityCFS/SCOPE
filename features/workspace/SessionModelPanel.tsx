"use client";
import { ComposerControls } from "@/features/conversation/ComposerControls";
import { SessionProfileControl } from "@/components/session-profile-control";
import { bridgeUrl, InspectorModule } from "./shared";
import type { WorkspaceController } from "./use-workspace-controller";

export function SessionModelPanel(
  workspace: WorkspaceController & { defaultOpen?: boolean },
) {
  const agent = workspace.selectedAgent;
  const session = workspace.selectedAppServerSession;
  if (!agent) return null;
  return (
    <InspectorModule title="会话设置" defaultOpen={workspace.defaultOpen}>
      <div className="session-settings-inline">
        <ComposerControls workspace={workspace} />
      </div>
      {session && (
        <SessionProfileControl
          host={agent.host}
          sessionId={session.sessionId}
          assignment={session.profileAssignment}
          url={bridgeUrl}
          onChanged={() => workspace.reloadModelsForHost(agent.host)}
        />
      )}
      {workspace.selectedQuotaUsed !== null && (
        <p className="composer-menu-note">
          {agent.rollout?.account?.planType || "账号"} · 剩余额度{" "}
          {Math.max(0, 100 - workspace.selectedQuotaUsed).toFixed(0)}%
        </p>
      )}
    </InspectorModule>
  );
}
