"use client";

import { useEffect, useState } from "react";

export type ProfileAssignment = {
  profile?: string;
  desiredProfile: string;
  status: "queued" | "switching" | "waiting-writer" | "applied" | "failed";
  handoff?: { released?: boolean; releasedAt?: number; startedAt?: number };
  error?: string | null;
  account?: { email?: string; planType?: string };
  verifiedAt?: string;
};
type ProfileState = {
  profiles: Array<{
    slug: string;
    name: string;
    ready: boolean;
    account?: { email?: string };
  }>;
  activeProfile: string | null;
  assignment: ProfileAssignment | null;
  account?: { email?: string; planType?: string } | null;
  accountError?: string | null;
};

type SessionProfileControlProps = {
  host: string;
  sessionId: string;
  assignment?: ProfileAssignment | null;
  url: (path: string) => string;
  onChanged: () => void;
};
export function SessionProfileControl(props: SessionProfileControlProps) {
  return (
    <SessionProfileContent
      key={`${props.host}:${props.sessionId}`}
      {...props}
    />
  );
}
function SessionProfileContent({
  host,
  sessionId,
  assignment,
  url,
  onChanged,
}: {
  host: string;
  sessionId: string;
  assignment?: ProfileAssignment | null;
  url: (path: string) => string;
  onChanged: () => void;
}) {
  const [data, setData] = useState<ProfileState | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const current = assignment || data?.assignment;
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      url(
        `/api/session/profile?host=${encodeURIComponent(host)}&sessionId=${encodeURIComponent(sessionId)}`,
      ),
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "读取会话账号失败");
        if (controller.signal.aborted) return;
        setError("");
        setData(result);
        setDraft(
          result.assignment?.desiredProfile || result.activeProfile || "",
        );
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [host, sessionId, url, refresh, assignment?.verifiedAt]);

  async function apply(action?: "cancel") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url("/api/session/profile"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, sessionId, slug: draft, action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "切换失败");
      setData((previous) =>
        previous ? { ...previous, assignment: result.assignment } : previous,
      );
      if (result.assignment?.status === "failed")
        setError(result.assignment.error);
      onChanged();
      setRefresh((value) => value + 1);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="session-profile-control">
      <div>
        <strong>此会话账号</strong>
        <p>
          绑定：{current?.profile || "未固定（使用主机默认）"} · 实际账号：
          {data?.account?.email || "尚未核实"}
          {data?.account?.planType ? ` · ${data.account.planType}` : ""}
        </p>
      </div>
      <label>
        <span>固定 Profile</span>
        <select
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={busy || !data || Boolean(current?.handoff)}
        >
          <option value="">请选择账号</option>
          {data?.profiles.map((profile) => (
            <option
              key={profile.slug}
              value={profile.slug}
              disabled={!profile.ready}
            >
              {profile.name || profile.slug}
              {profile.account?.email ? ` · ${profile.account.email}` : ""}
              {!profile.ready ? "（未登录）" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        className="inline-action"
        type="button"
        disabled={
          busy ||
          !draft ||
          current?.status === "switching" ||
          Boolean(current?.handoff)
        }
        onClick={() => apply()}
      >
        {busy ? "正在处理…" : "仅应用到此会话"}
      </button>
      <button
        className="inline-action"
        type="button"
        disabled={busy}
        onClick={() => setRefresh((value) => value + 1)}
      >
        核实账号
      </button>
      {current &&
        ["queued", "failed", "waiting-writer"].includes(current.status) && (
          <button
            className="inline-action"
            type="button"
            disabled={busy}
            onClick={() => apply("cancel")}
          >
            取消待切换
          </button>
        )}
      <p>执行中会等待本轮结束；固定后不跟随主机切换，也不自动换用其他账号。</p>
      {current?.status === "queued" && (
        <p role="status">
          等待本轮结束或待处理问题解决后，切换到 {current.desiredProfile}。
        </p>
      )}
      {current?.status === "switching" && (
        <p role="status">正在切换到 {current.desiredProfile}…</p>
      )}
      {current?.status === "waiting-writer" && (
        <p role="status">
          等待旧账号释放写入锁，再恢复到 {current.desiredProfile}。Codex
          默认需连续 30 分钟无活动；后台每 30 秒检查一次，不会重新加载旧会话。
          {current.handoff?.releasedAt
            ? ` 已于 ${new Date(current.handoff.releasedAt).toLocaleTimeString()} 取消旧连接订阅。`
            : ""}
          等待期间暂停发送指令；取消交接可恢复原账号。
        </p>
      )}
      {(error || current?.error || data?.accountError) && (
        <p role="alert">{error || current?.error || data?.accountError}</p>
      )}
    </div>
  );
}
