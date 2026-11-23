function normalizeWindow(raw, nowMs) {
  if (!raw || typeof raw !== "object") return null;
  const usedRaw = raw.usedPercent ?? raw.used_percent;
  const usedNumeric = Number(usedRaw);
  if (usedRaw === null || usedRaw === undefined || !Number.isFinite(usedNumeric)) {
    return null;
  }
  const usedPercent = Math.max(0, Math.min(100, Math.round(usedNumeric)));
  const windowRaw = raw.windowDurationMins ?? raw.window_minutes;
  const windowNumeric = Number(windowRaw);
  const windowMinutes =
    windowRaw !== null && windowRaw !== undefined && Number.isFinite(windowNumeric) && windowNumeric > 0
      ? Math.round(windowNumeric)
      : null;
  const resetsRaw = raw.resetsAt ?? raw.resets_at;
  const resetsNumeric = Number(resetsRaw);
  const resetsAt =
    resetsRaw !== null && resetsRaw !== undefined && Number.isFinite(resetsNumeric) && resetsNumeric > 0
      ? Math.round(resetsNumeric)
      : null;
  const expired = Boolean(resetsAt && resetsAt * 1000 <= nowMs);
  return {
    usedPercent: expired ? 0 : usedPercent,
    remainingPercent: expired ? 100 : Math.max(0, 100 - usedPercent),
    windowMinutes,
    resetsAt,
    expired,
  };
}

function normalizeCredits(raw) {
  if (!raw || typeof raw !== "object") return null;
  const hasCredits = Boolean(raw.hasCredits ?? raw.has_credits);
  const unlimited = Boolean(raw.unlimited);
  const balance =
    raw.balance !== undefined && raw.balance !== null && String(raw.balance).trim() !== ""
      ? String(raw.balance).trim()
      : null;
  if (!hasCredits && !unlimited && (!balance || Number(balance) <= 0)) {
    return null;
  }
  return { hasCredits, unlimited, balance };
}

function normalizeGroup(raw, nowMs) {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const primary = normalizeWindow(raw.primary, nowMs);
  const secondary = normalizeWindow(raw.secondary, nowMs);
  if (!primary && !secondary) return null;
  const description =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim().slice(0, 300)
      : undefined;
  return description
    ? { name: name.slice(0, 120), description, primary, secondary }
    : { name: name.slice(0, 120), primary, secondary };
}

export function normalizeAccountQuota(raw, nowMs = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const source =
    raw.rateLimits && typeof raw.rateLimits === "object" ? raw.rateLimits : raw;
  const primary = normalizeWindow(source.primary, nowMs);
  const secondary = normalizeWindow(source.secondary, nowMs);
  const credits = normalizeCredits(source.credits);
  const groups = Array.isArray(source.groups)
    ? source.groups.map((item) => normalizeGroup(item, nowMs)).filter(Boolean)
    : [];
  const rawPlan = source.planType ?? source.plan_type;
  const planType = typeof rawPlan === "string" ? rawPlan.trim() || null : null;
  if (!primary && !secondary && !credits && groups.length === 0) return null;
  const result = {
    planType,
    primary,
    secondary,
    credits,
  };
  if (groups.length > 0) {
    result.groups = groups;
  }
  return result;
}

export function quotaHeadline(quota) {
  if (!quota) return null;
  const top = [quota.primary, quota.secondary].filter(Boolean);
  const windows =
    top.length > 0
      ? top
      : Array.isArray(quota.groups)
        ? quota.groups.flatMap((group) =>
            [group?.primary, group?.secondary].filter(Boolean),
          )
        : [];
  if (!windows.length) return null;
  const sorted = [...windows].sort(
    (left, right) =>
      Number(Boolean(left.expired)) - Number(Boolean(right.expired)) ||
      left.remainingPercent - right.remainingPercent,
  );
  return sorted[0] || null;
}

export function formatQuotaWindowLabel(windowMinutes, locale = "zh-CN") {
  const isEn = locale === "en-US" || locale === "en";
  if (!Number.isFinite(windowMinutes) || !windowMinutes) {
    return isEn ? "Limit" : "用量额度";
  }
  if (windowMinutes >= 10_080 && windowMinutes % 1440 === 0) {
    const days = Math.round(windowMinutes / 1440);
    if (days === 7) return isEn ? "7d" : "周额度";
    return isEn ? `${days}d` : `${days}天额度`;
  }
  if (windowMinutes >= 60 && windowMinutes % 60 === 0) {
    const hours = Math.round(windowMinutes / 60);
    return isEn ? `${hours}h` : `${hours}h 额度`;
  }
  return isEn ? `${windowMinutes}m` : `${windowMinutes}m 额度`;
}
