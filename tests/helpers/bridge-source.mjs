import { readFileSync } from "node:fs";
/** Transitional legacy source assertions across explicit domain modules. */
export function bridgeSource() {
  return [
    "probes/profile-list-probe.mjs",
    "probes/profile-write-probe.mjs",
    "probes/profile-cancel-probe.mjs",
    "probes/profile-delete-probe.mjs",
    "probes/remote-probe.mjs",
    "probes/dialogue-probe.mjs",
    "probes/raw-context-probe.mjs",
    "probes/history-probe.mjs",
    "probes/assistant-search-probe.mjs",
    "plugins/aliyun-dlc/probe.mjs",
    "probes/takeover-probe.mjs",
    "probes/new-session-preflight.mjs",
    "probes/vscode-open-preflight.mjs",
    "probes/app-server-handoff-probe.mjs",
    "probes/app-server-writer-probe.mjs",
    "server.mjs",
    "plugins/aliyun-dlc/monitor.mjs",
    "deployment-profile.mjs",
    "transport/ssh-command.mjs",
    "http.mjs",
    "routes/models.mjs",
    "routes/dialogue.mjs",
    "routes/runtime.mjs",
    "routes/accounts.mjs",
    "rollout-summary.mjs",
    "state-persistence.mjs",
    "attachment-store.mjs",
    "research/insights.mjs",
    "tmux-delivery.mjs",
    "inventory-scanner.mjs",
    "terminal-gateway.mjs",
    "routes/system.mjs",
    "routes/session-lifecycle.mjs",
    "routes/management.mjs",
    "routes/session-delivery.mjs",
    "account-quotas.mjs",
  ]
    .map((file) =>
      readFileSync(new URL("../../bridge/" + file, import.meta.url), "utf8"),
    )
    .join("\n");
}
