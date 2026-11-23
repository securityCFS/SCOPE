"use client";
import { useEffect, useState } from "react";

type UpgradeJob = {
  host: string; status: string; phase: string; action: string; error?: string;
  info?: { installed: string; latest: string; executable: string; supported: boolean; backup?: string };
  runningVersions: { connectionKey: string; version: string | null; status: string; sessions: number }[];
  results: { sessionId: string; ok: boolean; error?: string }[];
};

async function readUpgradeResponse(response: Response): Promise<UpgradeJob | null> {
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); }
  catch {
    throw new Error(response.status === 404
      ? "更新接口未找到，请刷新网页加载最新界面。"
      : "更新服务返回异常（HTTP " + response.status + "），请刷新状态重试。");
  }
  if (!response.ok) throw new Error(value?.error || "更新请求失败（HTTP " + response.status + "）");
  if (value !== null && (typeof value !== "object" || typeof value.status !== "string" || !Array.isArray(value.results))) {
    throw new Error("更新服务返回的状态无效，请刷新状态重试。");
  }
  return value;
}

export function HostCodexSettings({ host, url }: { host: string; url: (path: string) => string }) {
  const [job, setJob] = useState<UpgradeJob | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch(url("/api/codex/upgrade?host=" + encodeURIComponent(host)), { signal: controller.signal, cache: "no-store" });
        const next = await readUpgradeResponse(response);
        if (disposed) return;
        setJob(next);
        setError("");
        timer = setTimeout(poll, next?.status === "running" ? 2000 : 15000);
      } catch (e) { if (!disposed) setError((e as Error).message); }
    }
    void poll();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [host, url, refreshKey]);

  async function start(action: "check" | "upgrade") {
    if (action === "upgrade" && !window.confirm("升级 " + host + " 的 npm 全局 Codex 并安全切换 SCOPE 托管会话？保留账号绑定、日志与工作目录；工作中会话或后台命令会阻止切换，不强杀 VS Code、tmux 或实验。不自动重发指令。")) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(url("/api/codex/upgrade"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, action, confirmation: "upgrade:" + host }),
      });
      const next = await readUpgradeResponse(response);
      if (!next) throw new Error("更新任务未创建，请刷新状态重试。");
      setJob(next);
      setRefreshKey((key) => key + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setSending(false); }
  }
  const busy = sending || job?.status === "running";
  const phases: Record<string, string> = { checking: "正在检查版本", installing: "正在备份、安装并验证", switching: "正在安全检查并恢复托管会话" };
  return <section className="host-model-panel" aria-label="主机 Codex 设置">
    <strong>{host} · 主机设置 / Codex 更新</strong>
    <p>检查稳定版 → 备份旧程序 → 升级 → 安全切换。只切换 SCOPE 托管会话；账号、模型、日志和工作目录保持不变。</p>
    <div className="host-model-actions">
      <button className="inline-action" disabled={busy} onClick={() => start("check")}>检查更新</button>
      <button className="inline-action" disabled={busy || job?.info?.supported === false} onClick={() => start("upgrade")}>
        {job?.status === "pending-switch" ? "重试安全切换" : "一键检查、升级并切换"}
      </button>
      <button className="inline-action" disabled={sending} onClick={() => setRefreshKey((key) => key + 1)}>刷新状态</button>
    </div>
    {job?.info && <p>已安装：{job.info.installed} · 最新稳定版：{job.info.latest}<br />
      程序路径：<code>{job.info.executable}</code>
      {!job.info.supported && <><br />该安装渠道不支持自动升级，请使用原安装渠道。</>}
    </p>}
    {job?.runningVersions?.map((runtime) => <p key={runtime.connectionKey}>
      {runtime.connectionKey}：运行版本 {runtime.version || "未确认"} · {runtime.sessions} 个会话 · {runtime.status}
    </p>)}
    <p role="status">{job?.status === "running" ? phases[job.phase]
      : job?.status === "pending-switch" ? "程序已升级，会话待切换（没有强制中断任务）"
      : job?.status === "completed" ? job.action === "check" ? "版本检查完成" : "升级与切换完成，未重发指令"
      : job?.status === "failed" ? "操作失败，请检查下方原因" : "点击检查更新查看安装和运行版本。"}</p>
    {(error || job?.error) && <p role="alert">{error || job?.error}</p>}
    {job?.info?.backup && <p>旧程序备份：<code>{job.info.backup}</code></p>}
    {!!job?.results?.length && <details><summary>会话切换结果（{job.results.length}）</summary>
      {job.results.map((result) => <div key={result.sessionId}>{result.sessionId}：{result.ok ? "已恢复" : result.error}</div>)}
    </details>}
    <p>有工作中会话或后台命令时会阻止切换。任务结束后点“重试安全切换”；不会自动中断任务。页面关闭不取消已提交的操作。</p>
  </section>;
}
