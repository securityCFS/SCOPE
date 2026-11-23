"use client";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Gauge,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Shield,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { QuotaMeterCard, quotaTone } from "@/components/quota-meter";
import { SessionProfileControl } from "@/components/session-profile-control";
import { normalizeAccountQuota, quotaHeadline } from "@/lib/account-quota";
import { LOCAL_HOST } from "@/lib/execution-host";
import { useLocale } from "@/lib/i18n";
import {
  bridgeUrl,
  managementKey,
  rolloutUsesYolo,
  sessionModelCatalogKey,
} from "@/features/workspace/shared";
import type { AccountQuota } from "@/features/workspace/types";
import type { WorkspaceController } from "@/features/workspace/use-workspace-controller";

const effortNamesZh: Record<string, string> = {
  none: "无",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
  ultra: "极限",
};
const effortNamesEn: Record<string, string> = {
  none: "None",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
  ultra: "Ultra",
};
export function ComposerControls({
  workspace,
}: {
  workspace: WorkspaceController;
}) {
  const { locale, tr } = useLocale();
  const effortNames = locale === "en" ? effortNamesEn : effortNamesZh;
  const agent = workspace.selectedAgent;
  const session = workspace.selectedAppServerSession;
  const [panel, setPanel] = useState<"model" | "permission" | "account" | null>(
    null,
  );
  const [applied, setApplied] = useState<{
    model: string;
    effort: string;
    yolo: boolean;
    source: string;
  } | null>(null);
  const [fetchedQuota, setFetchedQuota] = useState<{
    requestKey: string;
    quota: AccountQuota | null;
    error: string;
  } | null>(null);
  const [quotaRefresh, setQuotaRefresh] = useState<{
    key: string;
    seq: number;
  }>({ key: "", seq: 0 });
  const root = useRef<HTMLDivElement>(null);
  const agentHost = agent?.host || "";
  const activeConnKey =
    session?.profileAssignment?.status === "applied" &&
    session.profileAssignment.profile
      ? `profile:${session.profileAssignment.profile}`
      : "active";
  const quotaKey = `${agentHost}:${activeConnKey}`;
  const hostReachable = Boolean(
    agentHost &&
      workspace.snapshot.hosts.find((host) => host.alias === agentHost)
        ?.reachable,
  );
  const connQuota = agentHost
    ? workspace.snapshot.appServer.connections.find(
        (conn) =>
          conn.host === agentHost &&
          (conn.connectionKey || "active") === activeConnKey,
      )?.rateLimits || null
    : null;
  const liveQuota = session?.rateLimits || connQuota;
  const hasLiveQuota = Boolean(liveQuota);
  const refreshSeq = quotaRefresh.key === quotaKey ? quotaRefresh.seq : 0;
  const requestKey = `${quotaKey}:${refreshSeq}`;
  useEffect(() => {
    if (!panel) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanel(null);
        root.current
          ?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')
          ?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [panel]);
  useEffect(() => {
    if (!agentHost || !hostReachable) return;
    if (hasLiveQuota && refreshSeq === 0) return;
    const controller = new AbortController();
    const query =
      `/api/auth/quota?host=${encodeURIComponent(agentHost)}` +
      `&connectionKey=${encodeURIComponent(activeConnKey)}` +
      `${refreshSeq > 0 ? "&refresh=1" : ""}`;
    fetch(bridgeUrl(query), {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          quota?: AccountQuota | null;
          error?: string;
        };
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(result.error || "读取账号额度失败");
        }
        setFetchedQuota({
          requestKey,
          quota: result.quota || null,
          error: result.error || "",
        });
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setFetchedQuota({
          requestKey,
          quota: null,
          error: (failure as Error).message,
        });
      });
    return () => controller.abort();
  }, [
    agentHost,
    activeConnKey,
    hostReachable,
    hasLiveQuota,
    refreshSeq,
    requestKey,
  ]);
  if (!agent) return null;
  const currentFetched = fetchedQuota?.requestKey.startsWith(`${quotaKey}:`)
    ? fetchedQuota
    : null;
  const effectiveQuota =
    (refreshSeq > 0 ? currentFetched?.quota : null) ||
    liveQuota ||
    currentFetched?.quota ||
    normalizeAccountQuota(agent.rollout?.account);
  const quotaLoading = Boolean(
    hostReachable &&
      (!hasLiveQuota || refreshSeq > 0) &&
      fetchedQuota?.requestKey !== requestKey,
  );
  const headline = quotaHeadline(effectiveQuota);
  const key = managementKey(agent);
  const catalogKey = agent.rollout ? sessionModelCatalogKey(
    agent.host,
    agent.rollout.id,
    workspace.modelCatalogConnectionKey,
  ) : agent.host;
  const models = workspace.modelsByHost[catalogKey];
  const actual = {
    model: session?.model || agent.rollout?.model || "",
    effort: session?.effort || agent.rollout?.reasoningEffort || "",
    yolo:
      session?.yolo ?? rolloutUsesYolo(agent, workspace.snapshot.management),
  };
  const source = JSON.stringify(actual);
  const current = applied?.source === source ? applied : actual;
  const selected = models?.find((model) => model.id === current.model);
  const busy = workspace.busyAction === `model:${key}`;
  const changeable =
    Boolean(session || (agent.pane && agent.status !== "working")) &&
    !session?.profileAssignment?.handoff;
  async function apply(next: typeof current) {
    if (!agent || busy || !changeable) return;
    const success = await workspace.changeSessionModel(agent, next);
    if (success) {
      setApplied({ ...next, source });
      workspace.setModelDrafts((value) => ({ ...value, [key]: next.model }));
      workspace.setEffortDrafts((value) => ({ ...value, [key]: next.effort }));
      workspace.setYoloDrafts((value) => ({ ...value, [key]: next.yolo }));
      setPanel(null);
    }
  }
  function toggle(next: typeof panel) {
    setPanel((value) => (value === next ? null : next));
  }
  return (
    <div className="composer-controls" ref={root}>
      <button
        type="button"
        className={`composer-permission ${current.yolo ? "full-access" : ""}`}
        aria-label={tr("选择权限", "Select permissions")}
        aria-expanded={panel === "permission"}
        onClick={() => toggle("permission")}
      >
        {current.yolo ? <Shield size={14} /> : <ShieldCheck size={14} />}
        <span>{current.yolo ? tr("完全访问", "Full access") : tr("工作区权限", "Workspace")}</span>
        <ChevronDown size={12} />
      </button>
      <button
        type="button"
        className={`composer-quota is-${quotaTone(headline)}`}
        aria-label={tr("查看账号剩余额度", "View account quota")}
        aria-expanded={panel === "account"}
        onClick={() => toggle("account")}
      >
        {quotaLoading && !headline ? (
          <LoaderCircle size={13} className="is-spinning" />
        ) : (
          <Gauge size={13} />
        )}
        <span>
          {headline
            ? tr(`剩余 ${headline.remainingPercent}%`, `${headline.remainingPercent}% left`)
            : effectiveQuota?.credits?.unlimited
              ? tr("无限额度", "Unlimited")
              : effectiveQuota?.credits?.balance
                ? tr(`点数 ${effectiveQuota.credits.balance}`, `Credits ${effectiveQuota.credits.balance}`)
                : quotaLoading
                  ? tr("额度…", "Quota…")
                  : tr("额度", "Quota")}
        </span>
      </button>
      <button
        type="button"
        className="composer-model"
        aria-label={tr("选择模型与推理强度", "Select model & reasoning effort")}
        aria-expanded={panel === "model"}
        onClick={() => toggle("model")}
      >
        {busy ? <LoaderCircle size={14} className="is-spinning" /> : null}
        <span>{selected?.displayName || current.model || tr("选择模型", "Select model")}</span>
        <small>{effortNames[current.effort] || current.effort}</small>
        <ChevronDown size={12} />
      </button>
      {panel && (
        <section
          className={`composer-popover panel-${panel}`}
          role="dialog"
          aria-label={
            panel === "model"
              ? "模型与推理强度"
              : panel === "permission"
                ? "会话权限"
                : "会话账号"
          }
        >
          <header>
            <strong>
              {panel === "model"
                ? "模型与推理强度"
                : panel === "permission"
                  ? "会话权限"
                  : "会话账号"}
            </strong>
            <button
              type="button"
              aria-label="关闭设置菜单"
              onClick={() => setPanel(null)}
            >
              <X size={16} />
            </button>
          </header>
          {panel === "model" && (
            <>
              <div
                className="composer-model-list"
                role="group"
                aria-label="可用模型"
              >
                {!models && !workspace.modelErrors[catalogKey] && (
                  <p className="composer-menu-note">
                    正在读取此账号的可用模型…
                  </p>
                )}
                {models?.length === 0 && (
                  <p className="composer-menu-note">此账号暂未返回可用模型。</p>
                )}
                {models?.map((model) => (
                  <button
                    type="button"
                    key={model.id}
                    aria-pressed={model.id === current.model}
                    disabled={busy || !changeable}
                    onClick={() =>
                      void apply({
                        ...current,
                        model: model.id,
                        effort: model.supportedReasoningEfforts.includes(
                          current.effort,
                        )
                          ? current.effort
                          : model.defaultReasoningEffort ||
                            model.supportedReasoningEfforts[0] ||
                            "",
                      })
                    }
                  >
                    <span>{model.displayName || model.id}</span>
                    {model.id === current.model && <Check size={15} />}
                  </button>
                ))}
              </div>
              {selected && selected.supportedReasoningEfforts.length > 0 && (
                <div className="composer-efforts">
                  <span>推理强度</span>
                  <div>
                    {selected.supportedReasoningEfforts.map((effort) => (
                      <button
                        type="button"
                        key={effort}
                        aria-pressed={effort === current.effort}
                        disabled={busy || !changeable}
                        onClick={() => void apply({ ...current, effort })}
                      >
                        {effortNames[effort] || effort}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {workspace.modelErrors[catalogKey] && (
                <p className="composer-menu-error" role="alert">
                  {workspace.modelErrors[catalogKey]}
                </p>
              )}
              <footer>
                <button
                  type="button"
                  onClick={() => workspace.reloadModelsForHost(agent.host)}
                >
                  <RefreshCw size={13} />
                  刷新
                </button>
                <button type="button" onClick={() => setPanel("account")}>
                  <UserRound size={13} />
                  账号与额度
                </button>
              </footer>
            </>
          )}
          {panel === "permission" && (
            <div className="composer-permission-list">
              {[
                {
                  yolo: false,
                  title: "工作区权限",
                  text: "可修改工作目录；越界操作按需审批。",
                },
                {
                  yolo: true,
                  title: "完全访问",
                  text: "允许访问主机文件和网络，不请求工具审批。",
                },
              ].map((option) => (
                <button
                  type="button"
                  key={String(option.yolo)}
                  aria-pressed={option.yolo === current.yolo}
                  disabled={busy || !session || !changeable || !selected}
                  onClick={() => void apply({ ...current, yolo: option.yolo })}
                >
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.text}</small>
                  </span>
                  {option.yolo === current.yolo && <Check size={15} />}
                </button>
              ))}
              {!session && (
                <p className="composer-menu-note">
                  终端会话请在恢复时选择权限。
                </p>
              )}
              {session && !selected && (
                <p className="composer-menu-note">
                  先读取可用模型，再切换权限。
                </p>
              )}
            </div>
          )}
          {panel === "account" && (
            <div className="composer-account-panel">
              <QuotaMeterCard
                quota={effectiveQuota}
                loading={quotaLoading}
                error={currentFetched?.error}
                onRefresh={() =>
                  setQuotaRefresh((prev) => ({
                    key: quotaKey,
                    seq: prev.key === quotaKey ? prev.seq + 1 : 1,
                  }))
                }
              />
              <div className="composer-account-actions">
                <button
                  type="button"
                  className="inline-action"
                  onClick={() => {
                    setPanel(null);
                    workspace.openAccountProfiles();
                  }}
                >
                  <KeyRound size={13} />
                  账号管理
                </button>
              </div>
              {session && agent.host !== LOCAL_HOST && (
                <SessionProfileControl
                  host={agent.host}
                  sessionId={session.sessionId}
                  assignment={session.profileAssignment}
                  url={bridgeUrl}
                  onChanged={() => {
                    workspace.reloadModelsForHost(agent.host);
                    setQuotaRefresh((prev) => ({
                      key: quotaKey,
                      seq: prev.key === quotaKey ? prev.seq + 1 : 1,
                    }));
                  }}
                />
              )}
            </div>
          )}
          {panel !== "account" && !changeable && (
            <p className="composer-menu-note">
              恢复会话或等待当前操作结束后可更改设置。
            </p>
          )}
          {panel !== "account" && session?.status === "working" && (
            <p className="composer-menu-note">更改从下一轮回复生效。</p>
          )}
        </section>
      )}
    </div>
  );
}
