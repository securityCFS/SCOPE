export interface AccountQuotaWindow {
  usedPercent: number;
  remainingPercent: number;
  windowMinutes: number | null;
  resetsAt: number | null;
  expired: boolean;
}

export interface AccountCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface AccountQuotaGroup {
  name: string;
  description?: string;
  primary: AccountQuotaWindow | null;
  secondary: AccountQuotaWindow | null;
}

export interface AccountQuota {
  planType: string | null;
  primary: AccountQuotaWindow | null;
  secondary: AccountQuotaWindow | null;
  credits: AccountCredits | null;
  groups?: AccountQuotaGroup[];
}

export function normalizeAccountQuota(
  raw: unknown,
  nowMs?: number,
): AccountQuota | null;

export function quotaHeadline(
  quota: AccountQuota | null | undefined,
): AccountQuotaWindow | null;

export function formatQuotaWindowLabel(
  windowMinutes: number | null | undefined,
  locale?: string,
): string;
