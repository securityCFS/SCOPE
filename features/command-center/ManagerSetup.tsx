"use client";
import { useState } from "react";
import { ChoiceMenu } from "@/components/choice-menu";
import { hostLabel, LOCAL_HOST } from "@/lib/execution-host";
import type { Host } from "@/features/workspace/types";
import type { WorkbenchState } from "./types";
import type { WorkbenchClient } from "./use-workbench";

export function ManagerSetup({
  state,
  hosts,
  busy,
  mutate,
  onReady,
  onCancel,
  sending,
}: Pick<WorkbenchClient, "busy" | "mutate"> & {
  state: WorkbenchState;
  hosts: Pick<Host, "alias" | "reachable" | "defaultCwd">[];
  onReady: () => Promise<void>;
  onCancel: () => void;
  sending: boolean;
}) {
  const initial =
    state.config.manager.host ||
    hosts.find((h) => h.alias === LOCAL_HOST && h.reachable)?.alias ||
    hosts.find((h) => h.reachable)?.alias ||
    "";
  const [host, setHost] = useState(initial);
  const [cwd, setCwd] = useState(
    state.config.manager.cwd ||
      hosts.find((h) => h.alias === initial)?.defaultCwd ||
      "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (saving || busy) return;
    setSaving(true);
    setError("");
    try {
      await mutate("config", {
        revision: state.configRevision,
        config: {
          ...state.config,
          manager: { ...state.config.manager, host, cwd },
        },
      });
      await onReady();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="manager-inline-setup"
      aria-label="设置总调度运行位置"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <strong>选择运行位置</strong>
      <div className="manager-setup-fields">
        <div className="settings-field">
          <ChoiceMenu
            label="设备"
            fieldLabel="设备"
            value={host}
            disabled={saving}
            options={[
              { value: "", label: "选择设备" },
              ...hosts.map((h) => ({
                value: h.alias,
                label: hostLabel(h.alias),
                description: h.reachable ? "在线" : "离线",
                disabled: !h.reachable,
              })),
            ]}
            onChange={(nextHost) => {
              setHost(nextHost);
              setCwd(hosts.find((h) => h.alias === nextHost)?.defaultCwd || "");
            }}
          />
        </div>
        <label>
          工作目录
          <input
            required
            value={cwd}
            disabled={saving}
            placeholder={host === LOCAL_HOST ? "C:/projects" : "/workspace"}
            onChange={(e) => setCwd(e.target.value)}
          />
        </label>
      </div>
      {host === LOCAL_HOST && (
        <small>在运行 SCOPE 的电脑上执行，沿用本机 Codex 登录。</small>
      )}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button type="button" onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button
          type="submit"
          className="center-primary"
          disabled={busy || saving || !host || !cwd.trim()}
        >
          {saving ? "正在保存…" : sending ? "保存并发送" : "保存"}
        </button>
      </footer>
    </form>
  );
}
