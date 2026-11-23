"use client";

import { Gauge, LoaderCircle, RefreshCw } from "lucide-react";
import "./quota-meter.css";
import { formatQuotaWindowLabel, quotaHeadline } from "@/lib/account-quota";
import { useLocale } from "@/lib/i18n";
import type { AccountQuota, AccountQuotaWindow } from "@/features/workspace/types";

export function quotaTone(
  window: AccountQuotaWindow | null | undefined,
): "ok" | "warn" | "danger" | "muted" {
  if (!window) return "muted";
  if (window.remainingPercent <= 10) return "danger";
  if (window.remainingPercent <= 30) return "warn";
  return "ok";
}

function formatResetAt(epochSeconds: number | null | undefined): string {
  if (!epochSeconds || !Number.isFinite(epochSeconds)) return "";
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function QuotaInlineBadge({
  quota,
  loading,
}: {
  quota?: AccountQuota | null;
  loading?: boolean;
}) {
  const { locale, tr } = useLocale();
  if (loading && !quota) {
    return (
      <span className="quota-inline-badge is-muted">
        <LoaderCircle size={11} className="is-spinning" />
        {tr("测算中", "Checking")}
      </span>
    );
  }
  const headline = quotaHeadline(quota);
  if (headline) {
    const label = formatQuotaWindowLabel(headline.windowMinutes, locale);
    return (
      <span
        className={`quota-inline-badge is-${quotaTone(headline)}`}
        title={tr(
          `${label}剩余 ${headline.remainingPercent}%`,
          `${label}: ${headline.remainingPercent}% left`,
        )}
      >
        {tr(`剩余 ${headline.remainingPercent}%`, `${headline.remainingPercent}% left`)}
      </span>
    );
  }
  if (quota?.credits?.unlimited) {
    return <span className="quota-inline-badge is-ok">{tr("无限点数", "Unlimited")}</span>;
  }
  if (quota?.credits?.balance) {
    return (
      <span className="quota-inline-badge is-ok">
        {tr(`点数 ${quota.credits.balance}`, `Credits ${quota.credits.balance}`)}
      </span>
    );
  }
  return null;
}

function QuotaWindowRow({ win }: { win: AccountQuotaWindow }) {
  const { locale, tr } = useLocale();
  const tone = quotaTone(win);
  const label = formatQuotaWindowLabel(win.windowMinutes, locale);
  const resetStr = formatResetAt(win.resetsAt);
  const detail = win.expired
    ? tr("窗口已重置", "Window reset")
    : resetStr
      ? tr(`重置 ${resetStr}`, `Resets ${resetStr}`)
      : tr(`已用 ${win.usedPercent}%`, `${win.usedPercent}% used`);
  return (
    <div className="quota-window-row">
      <div className="quota-window-top">
        <span>{label}</span>
        <strong className={`quota-value is-${tone}`}>
          {tr(`剩余 ${win.remainingPercent}%`, `${win.remainingPercent}% left`)}
        </strong>
      </div>
      <div className="quota-progress-track" aria-hidden="true">
        <div
          className={`quota-progress-fill is-${tone}`}
          style={{
            width: `${Math.max(0, Math.min(100, win.remainingPercent))}%`,
          }}
        />
      </div>
      <small className="quota-window-detail">{detail}</small>
    </div>
  );
}

export function QuotaMeterCard({
  quota,
  loading,
  error,
  compact,
  emptyNote,
  onRefresh,
}: {
  quota?: AccountQuota | null;
  loading?: boolean;
  error?: string | null;
  compact?: boolean;
  emptyNote?: string;
  onRefresh?: () => void;
}) {
  const { tr } = useLocale();
  const groups = (quota?.groups || []).filter((group) =>
    Boolean(group && (group.primary || group.secondary)),
  );
  const windows = [quota?.primary, quota?.secondary].filter(
    (item): item is AccountQuotaWindow => Boolean(item),
  );
  const credits = quota?.credits;
  const hasCredits = Boolean(
    credits && (credits.unlimited || credits.balance || credits.hasCredits),
  );

  return (
    <div className={`quota-meter-card${compact ? " is-compact" : ""}`}>
      <div className="quota-meter-head">
        <span className="quota-meter-title">
          <Gauge size={13} />
          {tr("订阅剩余额度", "Subscription Quota")}
        </span>
        <div className="quota-meter-meta">
          {quota?.planType && quota.planType !== "unknown" && (
            <small className="account-plan">{quota.planType}</small>
          )}
          {onRefresh && (
            <button
              type="button"
              className="quota-refresh-btn"
              title={tr("刷新订阅额度", "Refresh quota")}
              aria-label={tr("刷新订阅额度", "Refresh quota")}
              disabled={loading}
              onClick={onRefresh}
            >
              <RefreshCw size={12} className={loading ? "is-spinning" : ""} />
              {tr("刷新额度", "Refresh")}
            </button>
          )}
        </div>
      </div>

      {groups.length > 0 ? (
        <div className="quota-group-list">
          {groups.map((group) => {
            const groupWindows = [group.primary, group.secondary].filter(
              (item): item is AccountQuotaWindow => Boolean(item),
            );
            return (
              <div className="quota-group-block" key={group.name}>
                <div className="quota-group-head" title={group.description}>
                  <span>{group.name}</span>
                </div>
                <div className="quota-window-list">
                  {groupWindows.map((win, index) => (
                    <QuotaWindowRow
                      key={`${group.name}:${index}:${win.windowMinutes ?? "window"}`}
                      win={win}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : windows.length > 0 ? (
        <div className="quota-window-list">
          {windows.map((win, index) => (
            <QuotaWindowRow
              key={`${index}:${win.windowMinutes ?? "window"}`}
              win={win}
            />
          ))}
        </div>
      ) : (
        <p className="quota-empty-note">
          {loading
            ? tr("正在读取订阅额度…", "Loading subscription quota…")
            : error ||
              emptyNote ||
              tr(
                "当前未读取到订阅额度窗口（API Key 或离线会话不返回订阅配额）",
                "No subscription quota windows returned (API key or offline sessions do not expose plan quotas).",
              )}
        </p>
      )}

      {hasCredits && (
        <div className="quota-credits-row">
          <span>{tr("附加点数", "Extra Credits")}</span>
          <strong>
            {credits?.unlimited
              ? tr("无上限", "Unlimited")
              : credits?.balance
                ? credits.balance
                : tr("可用", "Available")}
          </strong>
        </div>
      )}
    </div>
  );
}
