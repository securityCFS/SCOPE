"use client";
import { hostLabel, LOCAL_HOST } from "@/lib/execution-host";
import { useEffect, useRef, useState } from "react";
import { AgentLogo } from "@/components/agent-logo";
import { ChoiceMenu } from "@/components/choice-menu";
import { QuotaMeterCard } from "@/components/quota-meter";
import { quotaHeadline } from "@/lib/account-quota";
import { useLocale } from "@/lib/i18n";
import { AccountProfileList } from "../accounts/AccountProfileList";
import { DeviceLoginCard } from "../accounts/DeviceLoginCard";
import "../accounts/accounts.css";
import {
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  SquareTerminal,
  X,
} from "lucide-react";
import { bridgeUrl } from "./shared";
import type {
  HostQuotasResponse,
  ProviderAuthStatusesResponse,
} from "./types";
import type { WorkspaceController } from "./use-workspace-controller";

type AccountProviderTab = "codex" | "claude" | "antigravity";

function formatLoginExpiry(iso: string | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatClaudePlan(tier?: string, sub?: string) {
  const key = (tier || sub || "").trim().toLowerCase();
  if (key === "max_20x") return "Claude Max (20x)";
  if (key === "max_5x") return "Claude Max (5x)";
  if (key === "max") return "Claude Max";
  if (key === "pro") return "Claude Pro";
  if (key === "team") return "Claude Team";
  if (key === "enterprise") return "Claude Enterprise";
  return tier || sub || "";
}

export function AccountsDialog({
  accountProfilesOpen,
  setAccountProfilesOpen,
  accountHost,
  accountHostRef,
  setAccountHost,
  setAccountProfiles,
  snapshot,
  accountProfilesLoading,
  loadAccountProfiles,
  accountProfiles,
  profileNameDraft,
  setProfileNameDraft,
  busyAction,
  saveCurrentAccountProfile,
  deviceLoginJob,
  startDeviceLogin,
  closeDeviceLogin,
  copy,
  copied,
  activateAuthProfile,
  deleteAuthProfile,
  restartHostSessionsForAccount,
  authRestartJob,
  setSshTerminalTarget,
  setActionNotice,
  defaultProvider = "codex",
}: Pick<
  WorkspaceController,
  | "accountProfilesOpen"
  | "setAccountProfilesOpen"
  | "accountHost"
  | "accountHostRef"
  | "setAccountHost"
  | "setAccountProfiles"
  | "snapshot"
  | "accountProfilesLoading"
  | "loadAccountProfiles"
  | "accountProfiles"
  | "profileNameDraft"
  | "setProfileNameDraft"
  | "busyAction"
  | "saveCurrentAccountProfile"
  | "deviceLoginJob"
  | "startDeviceLogin"
  | "closeDeviceLogin"
  | "copy"
  | "copied"
  | "activateAuthProfile"
  | "deleteAuthProfile"
  | "restartHostSessionsForAccount"
  | "authRestartJob"
  | "setSshTerminalTarget"
  | "setActionNotice"
> & {
  defaultProvider?: AccountProviderTab;
}) {
  const { locale, tr } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [tabOverride, setTabOverride] = useState<{
    sessionKey: string;
    tab: AccountProviderTab;
  } | null>(null);
  const [quotasState, setQuotasState] = useState<{
    requestKey: string;
    data: HostQuotasResponse | null;
    error: string;
  } | null>(null);
  const [providersState, setProvidersState] = useState<{
    requestKey: string;
    data: ProviderAuthStatusesResponse | null;
    error: string;
  } | null>(null);
  const [quotaRefreshSeq, setQuotaRefreshSeq] = useState(0);
  const dialogSessionKey = `${accountProfilesOpen ? "open" : "closed"}:${defaultProvider}`;
  const activeTab: AccountProviderTab =
    tabOverride?.sessionKey === dialogSessionKey
      ? tabOverride.tab
      : defaultProvider;
  const quotaRequestKey =
    accountProfilesOpen && accountHost
      ? `${accountHost}:${quotaRefreshSeq}`
      : "";
  useEffect(() => {
    if (accountProfilesOpen) dialog.current?.showModal();
  }, [accountProfilesOpen]);
  useEffect(() => {
    if (!accountProfilesOpen || !accountHost) return;
    const controller = new AbortController();
    const query =
      `/api/auth/quota?host=${encodeURIComponent(accountHost)}&all=1` +
      `${quotaRefreshSeq > 0 ? "&refresh=1" : ""}`;
    fetch(bridgeUrl(query), {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = (await response.json()) as HostQuotasResponse & {
          error?: string;
        };
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(result.error || "读取账号额度失败");
        }
        setQuotasState({
          requestKey: quotaRequestKey,
          data: result,
          error: result.error || "",
        });
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setQuotasState({
          requestKey: quotaRequestKey,
          data: null,
          error: (failure as Error).message,
        });
      });
    return () => controller.abort();
  }, [accountProfilesOpen, accountHost, quotaRefreshSeq, quotaRequestKey]);
  useEffect(() => {
    if (!accountProfilesOpen || !accountHost) return;
    const controller = new AbortController();
    const query =
      `/api/auth/providers?host=${encodeURIComponent(accountHost)}` +
      `${quotaRefreshSeq > 0 ? "&refresh=1" : ""}`;
    fetch(bridgeUrl(query), {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = (await response.json()) as ProviderAuthStatusesResponse & {
          error?: string;
        };
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(result.error || "读取 Agent 登录状态失败");
        }
        setProvidersState({
          requestKey: quotaRequestKey,
          data: result,
          error: "",
        });
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setProvidersState({
          requestKey: quotaRequestKey,
          data: null,
          error: (failure as Error).message,
        });
      });
    return () => controller.abort();
  }, [accountProfilesOpen, accountHost, quotaRefreshSeq, quotaRequestKey]);
  const quotasLoading = Boolean(
    quotaRequestKey && quotasState?.requestKey !== quotaRequestKey,
  );
  const providersLoading = Boolean(
    quotaRequestKey && providersState?.requestKey !== quotaRequestKey,
  );
  const activeHostQuotas =
    quotasState?.data?.host === accountHost ? quotasState.data : null;
  const activeQuotasError =
    quotasState?.requestKey === quotaRequestKey ? quotasState.error : "";
  const activeProviders =
    providersState?.data?.host === accountHost ? providersState.data : null;
  const activeProvidersError =
    providersState?.requestKey === quotaRequestKey ? providersState.error : "";
  const claudeAuth = activeProviders?.claude || null;
  const agyAuth = activeProviders?.antigravity || null;
  const isLocalHost =
    accountHost === LOCAL_HOST || Boolean(accountProfiles?.local);
  const refreshingAny =
    accountProfilesLoading || quotasLoading || providersLoading;
  function openProviderLoginTerminal(providerLabel: string, command: string) {
    if (!accountHost || isLocalHost) return;
    void copy(command, `login:${command}`);
    setAccountProfilesOpen(false);
    setSshTerminalTarget({ host: accountHost, cwd: "", tmuxSession: "" });
    setActionNotice({
      kind: "success",
      text: `已打开 ${accountHost} 的 SSH 终端并复制 ${command}，粘贴回车即可完成 ${providerLabel} 登录。`,
    });
  }
  const savedActive = accountProfiles?.profiles.find(
    (profile) => profile.active,
  );
  const accountMismatch = Boolean(
    savedActive?.account?.email &&
    accountProfiles?.currentAccount?.email &&
    savedActive.account.email.toLowerCase() !==
      accountProfiles.currentAccount.email.toLowerCase(),
  );
  return (
    <>
      {accountProfilesOpen && (
        <dialog
          ref={dialog}
          className="account-profile-modal"
          aria-labelledby="account-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            setAccountProfilesOpen(false);
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setAccountProfilesOpen(false);
          }}
        >
          <div className="account-dialog-head">
            <div>
              <h2 id="account-dialog-title">{tr("账号管理", "Accounts & Quotas")}</h2>
              <p>
                {tr(
                  "查看所选设备的 Codex、Claude Code 与 Antigravity 登录状态；凭据保留在对应设备上。",
                  "Inspect Codex, Claude Code, and Antigravity logins and live quotas; credentials stay on each host.",
                )}
              </p>
            </div>
            <button
              type="button"
              aria-label={tr("关闭账号管理", "Close accounts")}
              onClick={() => setAccountProfilesOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="account-profile-toolbar">
            <ChoiceMenu
              label={tr("账号所在设备", "Target host")}
              value={accountHost}
              onChange={(host) => {
                accountHostRef.current = host;
                setAccountHost(host);
                setAccountProfiles(null);
                setQuotasState(null);
                setProvidersState(null);
                setQuotaRefreshSeq(0);
              }}
              options={snapshot.hosts
                .filter((host) => host.reachable)
                .map((host) => ({
                  value: host.alias,
                  label: hostLabel(host.alias, locale),
                  description: tr(`${host.agents.length} 个 Codex 会话`, `${host.agents.length} Codex sessions`),
                }))}
            />
            <button
              type="button"
              className="inline-action"
              disabled={!accountHost || refreshingAny}
              onClick={() => {
                void loadAccountProfiles(accountHost);
                setQuotaRefreshSeq((value) => value + 1);
              }}
            >
              <RefreshCw
                size={14}
                className={refreshingAny ? "is-spinning" : ""}
              />
              {tr("刷新", "Refresh")}
            </button>
          </div>
          <div className="account-provider-tabs">
            <div className="new-agent-choice" role="group" aria-label={tr("选择 Agent 账号类型", "Choose agent provider")}>
              {(
                [
                  {
                    id: "codex",
                    label: "Codex",
                    tag:
                      accountProfilesLoading && !accountProfiles
                        ? "…"
                        : accountProfiles?.defaultAuthPresent
                          ? quotaHeadline(activeHostQuotas?.currentQuota)
                            ? tr(
                                `剩 ${quotaHeadline(activeHostQuotas?.currentQuota)!.remainingPercent}%`,
                                `${quotaHeadline(activeHostQuotas?.currentQuota)!.remainingPercent}% left`,
                              )
                            : tr("已登录", "Signed in")
                          : tr("未登录", "Signed out"),
                  },
                  {
                    id: "claude",
                    label: "Claude Code",
                    tag:
                      providersLoading && !claudeAuth
                        ? "…"
                        : claudeAuth?.loggedIn
                          ? quotaHeadline(claudeAuth.quota)
                            ? tr(
                                `剩 ${quotaHeadline(claudeAuth.quota)!.remainingPercent}%`,
                                `${quotaHeadline(claudeAuth.quota)!.remainingPercent}% left`,
                              )
                            : tr("已登录", "Signed in")
                          : claudeAuth?.installed
                            ? tr("未登录", "Signed out")
                            : tr("未安装", "Not installed"),
                  },
                  {
                    id: "antigravity",
                    label: "Antigravity",
                    tag:
                      providersLoading && !agyAuth
                        ? "…"
                        : agyAuth?.loggedIn
                          ? quotaHeadline(agyAuth.quota)
                            ? tr(
                                `剩 ${quotaHeadline(agyAuth.quota)!.remainingPercent}%`,
                                `${quotaHeadline(agyAuth.quota)!.remainingPercent}% left`,
                              )
                            : tr("已登录", "Signed in")
                          : agyAuth?.installed
                            ? tr("未登录", "Signed out")
                            : tr("未安装", "Not installed"),
                  },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={activeTab === item.id}
                  onClick={() =>
                    setTabOverride({ sessionKey: dialogSessionKey, tab: item.id })
                  }
                >
                  <AgentLogo provider={item.id} size={15} />
                  <span>{item.label}</span>
                  <small className="provider-tab-pill">{item.tag}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="account-profile-body">
            {activeTab === "claude" && (
              <>
                <div className="current-account-card">
                  <span>
                    {tr(
                      `Claude Code 当前登录（${hostLabel(accountHost, locale)}）`,
                      `Claude Code Active Login (${hostLabel(accountHost, locale)})`,
                    )}
                  </span>
                  <strong>
                    {providersLoading && !claudeAuth
                      ? tr("正在读取…", "Loading…")
                      : claudeAuth?.loggedIn
                        ? claudeAuth.email || tr("已登录 Claude Code", "Signed in to Claude Code")
                        : claudeAuth?.installed
                          ? tr("尚未登录", "Signed out")
                          : tr("未检测到 claude CLI", "claude CLI not detected")}
                  </strong>
                  <small>
                    {claudeAuth?.loggedIn
                      ? [
                          formatClaudePlan(
                            claudeAuth.planTier,
                            claudeAuth.subscriptionType,
                          ) || tr("未返回套餐类型", "Unknown plan"),
                          claudeAuth.authMethod && claudeAuth.authMethod !== "none"
                            ? claudeAuth.authMethod
                            : "",
                          claudeAuth.orgName,
                          claudeAuth.loginExpiresAt
                            ? tr(
                                `授权到期 ${formatLoginExpiry(claudeAuth.loginExpiresAt)}`,
                                `Expires ${formatLoginExpiry(claudeAuth.loginExpiresAt)}`,
                              )
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : providersLoading && !claudeAuth
                        ? tr("正在检测本机或远端登录态…", "Checking local or remote login…")
                        : claudeAuth?.installed
                          ? tr("尚未登录 · 请通过下方终端执行 claude auth login", "Signed out · run claude auth login via terminal below")
                          : tr("未在目标主机检测到 claude 命令", "claude CLI not found on target host")}
                  </small>
                  {(activeProvidersError || claudeAuth?.error) && (
                    <small className="account-mismatch">
                      {activeProvidersError || claudeAuth?.error}
                    </small>
                  )}
                  <QuotaMeterCard
                    quota={claudeAuth?.quota || null}
                    loading={providersLoading}
                    error={claudeAuth?.quotaError || activeProvidersError || null}
                    compact
                    onRefresh={() => setQuotaRefreshSeq((value) => value + 1)}
                    emptyNote={
                      claudeAuth?.loggedIn
                        ? tr(
                            "暂未读取到 Claude 订阅用量窗口（API Key 模式或网络未连通时不返回 OAuth 配额）",
                            "No Claude subscription quota returned (API key mode or offline host).",
                          )
                        : tr(
                            "登录 Claude Code 后可查看 5 小时与 7 天订阅剩余额度",
                            "Sign in to Claude Code to view 5-hour and 7-day subscription quotas.",
                          )
                    }
                  />
                </div>

                <div className="provider-auth-guide">
                  <strong>{tr("登录 / 切换 Claude Code 账号", "Sign in / switch Claude Code account")}</strong>
                  <p>
                    {locale === "en" ? (
                      <>
                        Run <code>claude auth login</code> in an interactive terminal to authorize via OAuth (credentials stay in <code>~/.claude</code> on the host). SCOPE queries Claude&apos;s OAuth usage endpoint directly on the host without exporting tokens; run <code>/usage</code> in CLI to cross-check.
                      </>
                    ) : (
                      <>
                        Claude Code 通过交互式终端执行{" "}
                        <code>claude auth login</code> 完成浏览器 OAuth 授权（凭据保存在目标主机{" "}
                        <code>~/.claude</code>）。SCOPE 会在目标主机本地直接查询 Claude OAuth 用量接口（不回传令牌），也可以在 CLI 中运行{" "}
                        <code>/usage</code> 核对。
                      </>
                    )}
                  </p>
                  <div className="provider-auth-actions">
                    {!isLocalHost && (
                      <button
                        type="button"
                        className="primary-action"
                        onClick={() =>
                          openProviderLoginTerminal("Claude Code", "claude auth login")
                        }
                      >
                        <SquareTerminal size={14} />
                        {tr("打开 SSH 终端登录 / 切换", "Open SSH terminal to sign in")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void copy("claude auth login", "claude-login")}
                    >
                      {copied === "claude-login" ? <Check size={14} /> : <Copy size={14} />}
                      {copied === "claude-login"
                        ? tr("已复制命令", "Copied")
                        : tr("复制 claude auth login", "Copy claude auth login")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copy("claude auth logout", "claude-logout")}
                    >
                      {copied === "claude-logout" ? <Check size={14} /> : <Copy size={14} />}
                      {copied === "claude-logout"
                        ? tr("已复制命令", "Copied")
                        : tr("复制退出命令", "Copy logout command")}
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeTab === "antigravity" && (
              <>
                <div className="current-account-card">
                  <span>
                    {tr(
                      `Antigravity (AGY) 当前登录（${hostLabel(accountHost, locale)}）`,
                      `Antigravity (AGY) Active Login (${hostLabel(accountHost, locale)})`,
                    )}
                  </span>
                  <strong>
                    {providersLoading && !agyAuth
                      ? tr("正在读取…", "Loading…")
                      : agyAuth?.loggedIn
                        ? agyAuth.email || tr("已登录 Antigravity", "Signed in to Antigravity")
                        : agyAuth?.installed
                          ? tr("尚未登录", "Signed out")
                          : tr("未检测到 agy CLI", "agy CLI not detected")}
                  </strong>
                  <small>
                    {[
                      agyAuth?.authMethod || "Google OAuth",
                      agyAuth?.defaultModel
                        ? tr(`默认模型 ${agyAuth.defaultModel}`, `Default ${agyAuth.defaultModel}`)
                        : "",
                      agyAuth?.useG1Credits ? tr("已启用 G1 Credits", "G1 Credits enabled") : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  {(activeProvidersError || agyAuth?.error) && (
                    <small className="account-mismatch">
                      {activeProvidersError || agyAuth?.error}
                    </small>
                  )}
                  <QuotaMeterCard
                    quota={agyAuth?.quota || null}
                    loading={providersLoading}
                    error={agyAuth?.quotaError || activeProvidersError || null}
                    compact
                    onRefresh={() => setQuotaRefreshSeq((value) => value + 1)}
                    emptyNote={
                      agyAuth?.loggedIn
                        ? tr(
                            "暂未读取到 Antigravity 额度（请确认目标主机已配置代理/网络且 agy CLI 支持 /usage）",
                            "No Antigravity quota returned (verify network/proxy and agy /usage support).",
                          )
                        : tr(
                            "登录 Antigravity 后可查看各模型分组的 5 小时与周剩余额度",
                            "Sign in to Antigravity to view per-model-group 5-hour and weekly quotas.",
                          )
                    }
                  />
                </div>

                {(agyAuth?.profiles || []).map((prof) => (
                  <div key={prof.profile || "extra"} className="current-account-card">
                    <span>
                      {tr(
                        `Antigravity 独立账号 · ${prof.profile}（${hostLabel(accountHost, locale)}）`,
                        `Antigravity Isolated Profile · ${prof.profile} (${hostLabel(accountHost, locale)})`,
                      )}
                    </span>
                    <strong>
                      {prof.loggedIn
                        ? prof.email || tr(`已登录 (${prof.profile})`, `Signed in (${prof.profile})`)
                        : tr("尚未登录", "Signed out")}
                    </strong>
                    <small>
                      {[
                        prof.authMethod || "Google OAuth",
                        prof.defaultModel
                          ? tr(`默认模型 ${prof.defaultModel}`, `Default ${prof.defaultModel}`)
                          : "",
                        prof.useG1Credits ? tr("已启用 G1 Credits", "G1 Credits enabled") : "",
                        prof.profile === "acc2" ? "agy2" : `agy-profile ${prof.profile}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    {prof.error && (
                      <small className="account-mismatch">{prof.error}</small>
                    )}
                    <QuotaMeterCard
                      quota={prof.quota || null}
                      loading={providersLoading}
                      error={prof.quotaError || null}
                      compact
                      onRefresh={() => setQuotaRefreshSeq((value) => value + 1)}
                      emptyNote={tr(
                        `独立配置 ${prof.profile} 暂未返回额度`,
                        `No quota returned for profile ${prof.profile}.`,
                      )}
                    />
                  </div>
                ))}

                <div className="provider-auth-guide">
                  <strong>{tr("登录 / 切换 Antigravity 账号", "Sign in / switch Antigravity account")}</strong>
                  <p>
                    {locale === "en" ? (
                      <>
                        Launch <code>agy</code> interactively (or run <code>/login</code>) to complete Google OAuth. Credentials stay in <code>~/.gemini/antigravity-cli/antigravity-oauth-token</code>, and quotas are read via <code>agy -p /usage --output-format json</code> with zero token cost.
                      </>
                    ) : (
                      <>
                        Antigravity CLI 通过交互式启动 <code>agy</code>（首次启动或会话内执行{" "}
                        <code>/login</code>）完成 Google OAuth 授权，凭据保存在目标主机{" "}
                        <code>~/.gemini/antigravity-cli/antigravity-oauth-token</code>。剩余额度通过目标主机官方{" "}
                        <code>agy -p /usage --output-format json</code>（零 Token 消耗）实时读取。
                      </>
                    )}
                  </p>
                  <div className="provider-auth-actions">
                    {!isLocalHost && (
                      <button
                        type="button"
                        className="primary-action"
                        onClick={() => openProviderLoginTerminal("Antigravity", "agy")}
                      >
                        <SquareTerminal size={14} />
                        {tr("打开 SSH 终端登录 / 管理 AGY", "Open SSH terminal for AGY")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void copy("agy", "agy-login")}
                    >
                      {copied === "agy-login" ? <Check size={14} /> : <Copy size={14} />}
                      {copied === "agy-login"
                        ? tr("已复制命令", "Copied")
                        : tr("复制启动命令 agy", "Copy agy command")}
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeTab === "codex" && (
              <>
                <div className="current-account-card">
              <span>{tr("当前登录", "Active login")}</span>
              <strong>
                {!accountProfiles && accountProfilesLoading
                  ? tr("正在读取…", "Loading…")
                  : accountProfiles?.currentAccount?.email ||
                    (accountProfiles?.defaultAuthPresent
                      ? tr("已登录（未读取邮箱）", "Signed in")
                      : tr("未登录", "Signed out"))}
              </strong>
              <small>
                {accountProfiles?.currentAccount?.planType &&
                accountProfiles.currentAccount.planType !== "unknown"
                  ? accountProfiles.currentAccount.planType
                  : tr("套餐未识别", "Unknown plan")}{" "}
                ·{" "}
                {isLocalHost
                  ? tr("本机当前登录", "Local active login")
                  : accountProfiles?.activeProfile
                    ? tr(
                        `已选配置 ${savedActive?.name || accountProfiles.activeProfile}`,
                        `Active profile ${savedActive?.name || accountProfiles.activeProfile}`,
                      )
                    : tr("尚未保存为账号配置", "Unsaved profile")}
              </small>
              {accountMismatch && (
                <small className="account-mismatch">
                  当前登录与已选配置不同，请核实后再切换。
                </small>
              )}
              <QuotaMeterCard
                quota={activeHostQuotas?.currentQuota || null}
                loading={quotasLoading}
                error={activeQuotasError || activeHostQuotas?.error || null}
                compact
              />
            </div>

            {accountProfiles?.automaticFailover && (
              <div className="profile-restart-card">
                <div>
                  <strong>账号故障自动切换</strong>
                  <span>
                    {accountProfiles.automaticFailover.status ===
                    "checking-profiles"
                      ? "正在验证下一套 Profile 的 refresh token。"
                      : accountProfiles.automaticFailover.status ===
                          "waiting-for-turns"
                        ? `已选 ${accountProfiles.automaticFailover.targetProfile || "备用账号"}；为避免中断 ${accountProfiles.automaticFailover.waitingForSessions.length} 条正在运行的 Turn，空闲后自动切换。`
                        : accountProfiles.automaticFailover.status ===
                            "switching"
                          ? `正在将该主机从 ${accountProfiles.automaticFailover.failedProfile || "失效账号"} 切换到 ${accountProfiles.automaticFailover.targetProfile || "备用账号"} 并恢复中断任务。`
                          : accountProfiles.automaticFailover.status ===
                              "completed"
                            ? `已切换到 ${accountProfiles.automaticFailover.targetProfile || "备用账号"}。`
                            : `自动切换失败：${accountProfiles.automaticFailover.error || "没有可用 Profile"}`}
                  </span>
                </div>
              </div>
            )}

            {isLocalHost ? (
              <p className="account-local-note">
                本机读取 <code>~/.codex/auth.json</code> 的当前登录与实时订阅额度；
                多账号 Profile 保存、Device Auth 登录与会话自动故障切换仅适用于远端 SSH 主机。
              </p>
            ) : (
              <>
                <details className="account-add-section">
                  <summary>{tr("添加账号", "Add account")}</summary>
                  <div className="profile-create-row">
                    <label>
                      <span>{tr("账号名称", "Profile name")}</span>
                      <input
                        value={profileNameDraft}
                        maxLength={48}
                        placeholder={tr("例如 work / personal", "e.g. work / personal")}
                        onChange={(event) =>
                          setProfileNameDraft(event.target.value)
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={
                        !profileNameDraft.trim() ||
                        !accountProfiles?.defaultAuthPresent ||
                        busyAction === "profile-save-current"
                      }
                      onClick={saveCurrentAccountProfile}
                    >
                      {busyAction === "profile-save-current" ? (
                        <LoaderCircle size={14} className="is-spinning" />
                      ) : (
                        <Save size={14} />
                      )}
                      {tr("保存当前登录", "Save active login")}
                    </button>
                    <button
                      type="button"
                      className="primary-action"
                      disabled={
                        !profileNameDraft.trim() ||
                        busyAction === "profile-device-login" ||
                        Boolean(
                          deviceLoginJob &&
                          ["starting", "waiting"].includes(deviceLoginJob.status),
                        )
                      }
                      onClick={startDeviceLogin}
                    >
                      {busyAction === "profile-device-login" ? (
                        <LoaderCircle size={14} className="is-spinning" />
                      ) : (
                        <KeyRound size={14} />
                      )}
                      {tr("登录其他账号", "Sign in another")}
                    </button>
                  </div>
                </details>

                <DeviceLoginCard
                  deviceLoginJob={deviceLoginJob}
                  busyAction={busyAction}
                  closeDeviceLogin={closeDeviceLogin}
                  copy={copy}
                  copied={copied}
                />

                <AccountProfileList
                  accountProfiles={accountProfiles}
                  accountProfilesLoading={accountProfilesLoading}
                  busyAction={busyAction}
                  activateAuthProfile={activateAuthProfile}
                  deleteAuthProfile={deleteAuthProfile}
                  profileQuotas={activeHostQuotas?.profileQuotas}
                  quotasLoading={quotasLoading}
                />

                {(accountProfiles?.runningSessions || 0) > 0 && (
                  <details className="account-recovery-section">
                    <summary>
                      {tr(
                        `会话恢复 · ${accountProfiles?.runningSessions} 个会话`,
                        `Session recovery · ${accountProfiles?.runningSessions} sessions`,
                      )}
                    </summary>
                    <div className="profile-restart-card">
                      <div>
                        <strong>切换账号后恢复会话</strong>
                        <span>
                          只处理 {accountHost} 上可精确关联 rollout 的{" "}
                          {accountProfiles?.runningSessions} 个 Codex
                          Session；按主机串行恢复， 不主动终止训练/评测进程。
                        </span>
                      </div>
                      <button
                        type="button"
                        className="danger-secondary-action"
                        disabled={busyAction === "profile-restart-host"}
                        onClick={restartHostSessionsForAccount}
                      >
                        {busyAction === "profile-restart-host" ? (
                          <LoaderCircle size={14} className="is-spinning" />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                        重启该主机 Codex
                      </button>
                      {authRestartJob && (
                        <div className="auth-restart-report">
                          <small>
                            {authRestartJob.status} · {authRestartJob.completed}/
                            {authRestartJob.total} · 成功{" "}
                            {
                              authRestartJob.results.filter((result) => result.ok)
                                .length
                            }{" "}
                            · 失败{" "}
                            {
                              authRestartJob.results.filter((result) => !result.ok)
                                .length
                            }
                          </small>
                          {authRestartJob.results.some((result) => !result.ok) && (
                            <div className="auth-restart-failures">
                              {authRestartJob.results
                                .filter((result) => !result.ok)
                                .slice(0, 12)
                                .map((result) => (
                                  <span key={result.sessionId} title={result.error}>
                                    <code>{result.sessionId.slice(0, 8)}</code>
                                    {result.error || "恢复失败"}
                                  </span>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </>
            )}
              </>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
