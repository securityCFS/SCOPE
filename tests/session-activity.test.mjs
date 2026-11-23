import assert from "node:assert/strict";
import test from "node:test";
import { activityLabel, activityTime, recentProjects } from "../lib/session-activity.js";

test("provider ISO, seconds and milliseconds produce the same activity time", () => {
  const time = Date.parse("2026-11-06T00:00:00Z");
  for (const value of [time, String(time), time / 1000, String(time / 1000), "2026-11-06T00:00:00Z"])
    assert.equal(activityTime(value), time);
  for (const value of [null, undefined, "", "invalid", 0, -1]) assert.equal(activityTime(value), 0);
  assert.equal(activityLabel(time, time + 120000), "2分钟前");
  assert.equal(activityLabel(null), "时间未知");
});

test("merged live and historical sessions sort by activity, with pinned projects first and unknown dates last", () => {
  const projects = [
    { key: "older", pinned: false, sessions: [{ id: "live", lastActivityAt: 10 }, { id: "recent-history", lastActivityAt: 20 }, { id: "unknown" }] },
    { key: "newest", pinned: false, sessions: [{ id: "external", lastActivityAt: 30 }] },
    { key: "pinned", pinned: true, sessions: [] },
  ];
  const result = recentProjects(projects);
  assert.deepEqual(result.map(project => project.key), ["pinned", "newest", "older"]);
  assert.deepEqual(result[2].sessions.map(session => session.id), ["recent-history", "live", "unknown"]);
  assert.equal(projects[0].sessions[0].id, "live", "must not mutate the source inventory");
  assert.deepEqual(recentProjects(result), result, "stable for unchanged timestamps");
});
