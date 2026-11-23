import { DEFAULT_CAPACITY_RETRY_DELAYS_MS } from "./capacity-recovery.mjs";

export function profileCapacityRetryDelays(profiles, account) {
  // Match the actual writer account, not merely the host's active marker.
  // Only this explicit account may send automatic continuation turns.
  const email = account?.type === "chatgpt" ? account.email?.trim().toLowerCase() : "";
  const target = profiles?.profiles?.find((profile) => profile.slug === "pro-plus");
  if (!email || target?.account?.email?.trim().toLowerCase() !== email) {
    return [];
  }
  return Array.from({ length: 100 }, (_, index) =>
    DEFAULT_CAPACITY_RETRY_DELAYS_MS[index] ?? 120_000,
  );
}
