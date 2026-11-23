const DEFAULT_PROFILE_COOLDOWN_MS = 30 * 60_000;

export function orderedReadyProfileCandidates(
  profiles,
  activeSlug,
  {
    failedUntil = new Map(),
    now = Date.now(),
  } = {},
) {
  const ready = (Array.isArray(profiles) ? profiles : []).filter(
    (profile) => profile?.ready && typeof profile.slug === "string" && profile.slug,
  );
  if (ready.length < 2) return [];
  const activeIndex = ready.findIndex((profile) => profile.slug === activeSlug);
  const rotationBase = activeIndex >= 0 ? activeIndex : -1;
  const candidateCount = activeIndex >= 0 ? ready.length - 1 : ready.length;
  const ordered = [];
  for (let offset = 1; offset <= candidateCount; offset += 1) {
    const index = (rotationBase + offset) % ready.length;
    const profile = ready[index];
    if (profile.slug === activeSlug) continue;
    if (Number(failedUntil.get(profile.slug) || 0) > now) continue;
    ordered.push(profile);
  }
  return ordered;
}

export function markProfileUnavailable(
  failedUntil,
  slug,
  {
    now = Date.now(),
    cooldownMs = DEFAULT_PROFILE_COOLDOWN_MS,
  } = {},
) {
  if (!(failedUntil instanceof Map) || !slug) return null;
  const until = now + Math.max(1_000, Number(cooldownMs) || DEFAULT_PROFILE_COOLDOWN_MS);
  failedUntil.set(slug, until);
  return until;
}

export function publicProfileFailoverJob(job) {
  if (!job) return null;
  return {
    host: job.host,
    status: job.status,
    failedProfile: job.failedProfile || null,
    targetProfile: job.targetProfile || null,
    interruptedSessions: Array.from(job.interruptedSessions || []),
    waitingForSessions: Array.from(job.waitingForSessions || []),
    attemptedProfiles: Array.from(job.attemptedProfiles || []),
    nextAttemptAt: job.nextAttemptAt || null,
    startedAt: job.startedAt,
    completedAt: job.completedAt || null,
    error: job.error || null,
  };
}
