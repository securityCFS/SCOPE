"use client";

import { Gauge, LoaderCircle, RefreshCw } from "lucide-react";
import "./quota-meter.css";
import { formatQuotaWindowLabel, quotaHeadline } from "@/lib/account-quota";
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
  if (loading && !quota) {
    return (
      <span className="quota-inline-badge is-muted">
        <LoaderCircle size={11} className="is-spinning" />
        测算中
      </span>
    );
  }
  const headline = quotaHeadline(quota);
  if (headline) {
    const label = formatQuotaWindowLabel(headline.windowMinutes);
    return (
      <span
        className={`quota-inline-badge is-${quotaTone(headline)}`}
        title={`${label}剩余 ${headline.remainingPercent}%`}
      >
        剩余 {headline.remainingPercent}%
      </span>
    );
  }
  if (quota?.credits?.unlimited) {
    return <span className="quota-inline-badge is-ok">无限点数</span>;
  }
  if (quota?.credits?.balance) {
    return (
      <span className="quota-inline-badge is-ok">
        点数 {quota.credits.balance}
      </span>
    );
  }
  return null;
}

function QuotaWindowRow({ win }: { win: AccountQuotaWindow }) {
  const tone = quotaTone(win);
  const label = formatQuotaWindowLabel(win.windowMinutes);
  const resetStr = formatResetAt(win.resetsAt);
  const detail = win.expired
    ? "窗口已重置"
    : resetStr
      ? `重置 ${resetStr}`
      : `已用 ${win.usedPercent}%`;
  return (
    <div className="quota-window-row">
      <div className="quota-window-top">
        <span>{label}</span>
        <strong className={`quota-value is-${tone}`}>
          剩余 {win.remainingPercent}%
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
          订阅剩余额度
        </span>
        <div className="quota-meter-meta">
          {quota?.planType && quota.planType !== "unknown" && (
            <small className="account-plan">{quota.planType}</small>
          )}
          {onRefresh && (
            <button
              type="button"
              className="quota-refresh-btn"
              title="刷新订阅额度"
              aria-label="刷新订阅额度"
              disabled={loading}
              onClick={onRefresh}
            >
              <RefreshCw size={12} className={loading ? "is-spinning" : ""} />
              刷新额度
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
            ? "正在读取订阅额度…"
            : error ||
              emptyNote ||
              "当前未读取到订阅额度窗口（API Key 或离线会话不返回订阅配额）"}
        </p>
      )}

      {hasCredits && (
        <div className="quota-credits-row">
          <span>附加点数</span>
          <strong>
            {credits?.unlimited
              ? "无上限"
              : credits?.balance
                ? credits.balance
                : "可用"}
          </strong>
        </div>
      )}
    </div>
  );
}
