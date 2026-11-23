import test from "node:test";
import assert from "node:assert/strict";
import {
  markProfileUnavailable,
  orderedReadyProfileCandidates,
  publicProfileFailoverJob,
} from "../bridge/auth-profile-failover.mjs";

test("rotates from the active profile and skips profiles in cooldown", () => {
  const profiles = [
    { slug: "pro-full", ready: true },
    { slug: "pro-full-2", ready: true },
    { slug: "pro-lite", ready: true },
    { slug: "unfinished", ready: false },
  ];
  const failedUntil = new Map([["pro-lite", 20_000]]);
  assert.deepEqual(
    orderedReadyProfileCandidates(profiles, "pro-full-2", {
      failedUntil,
      now: 10_000,
    }).map((profile) => profile.slug),
    ["pro-full"],
  );
});

test("returns every ready profile when no active marker exists", () => {
  assert.deepEqual(
    orderedReadyProfileCandidates(
      [
        { slug: "a", ready: true },
        { slug: "b", ready: true },
        { slug: "c", ready: true },
      ],
      null,
    ).map((profile) => profile.slug),
    ["a", "b", "c"],
  );
});

test("marks unavailable profiles and exposes no credential data", () => {
  const failedUntil = new Map();
  assert.equal(
    markProfileUnavailable(failedUntil, "bad-profile", {
      now: 1_000,
      cooldownMs: 5_000,
    }),
    6_000,
  );
  assert.equal(failedUntil.get("bad-profile"), 6_000);
  assert.deepEqual(
    publicProfileFailoverJob({
      host: "gpu",
      status: "waiting-for-turns",
      failedProfile: "bad-profile",
      interruptedSessions: new Set(["thread-a"]),
      waitingForSessions: new Set(["thread-b"]),
      attemptedProfiles: ["bad-profile"],
      startedAt: "2026-08-31T00:00:00.000Z",
      secret: "never expose this",
    }),
    {
      host: "gpu",
      status: "waiting-for-turns",
      failedProfile: "bad-profile",
      targetProfile: null,
      interruptedSessions: ["thread-a"],
      waitingForSessions: ["thread-b"],
      attemptedProfiles: ["bad-profile"],
      nextAttemptAt: null,
      startedAt: "2026-08-31T00:00:00.000Z",
      completedAt: null,
      error: null,
    },
  );
});
