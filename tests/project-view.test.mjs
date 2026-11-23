import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROJECT_FILTERS,
  filterProjects,
  normalizeProjectFilters,
} from "../lib/project-view.js";
const session = (title, lastActivityAt, extra = {}) => ({
  title,
  lastActivityAt,
  status: "idle",
  ...extra,
});
const project = (key, sessions, extra = {}) => ({
  key,
  name: key,
  host: "host",
  cwd: `/work/${key}`,
  pinned: false,
  sessions,
  ...extra,
});
test("sidebar orders by actual activity, keeps unknown dates last and pins projects", () => {
  const input = [
    project("one", [
      session("old", 10),
      session("unknown", null),
      session("new", 30),
    ]),
    project("two", [session("middle", 20)]),
    project("pin", [], { pinned: true }),
  ];
  const recent = filterProjects(input, DEFAULT_PROJECT_FILTERS);
  assert.deepEqual(
    recent.map((p) => p.key),
    ["pin", "one", "two"],
  );
  assert.deepEqual(
    recent[1].sessions.map((s) => s.title),
    ["new", "old", "unknown"],
  );
  const oldest = filterProjects(input, {
    ...DEFAULT_PROJECT_FILTERS,
    order: "oldest",
  });
  assert.deepEqual(
    oldest[1].sessions.map((s) => s.title),
    ["old", "new", "unknown"],
  );
  assert.equal(input[0].sessions[0].title, "old");
});
test("task, provider, status and text filters intersect before sorting projects", () => {
  const input = [
    project("one", [
      session("irrelevant newest", 100, { category: "research" }),
      session("train model", 10, {
        category: "training",
        provider: "antigravity",
        status: "attention",
      }),
    ]),
    project("two", [
      session("train model", 20, {
        category: "training",
        provider: "antigravity",
        status: "attention",
      }),
    ]),
  ];
  const result = filterProjects(
    input,
    {
      ...DEFAULT_PROJECT_FILTERS,
      category: "training",
      provider: "antigravity",
      status: "attention",
    },
    "train",
  );
  assert.deepEqual(
    result.map((p) => p.key),
    ["two", "one"],
  );
  assert.ok(result.every((p) => p.sessions.length === 1));
  assert.equal(
    filterProjects(input, {
      ...DEFAULT_PROJECT_FILTERS,
      category: "evaluation",
    }).length,
    0,
  );
});
test("unknown saved filter values reset, missing categories remain unclassified", () => {
  assert.deepEqual(
    normalizeProjectFilters({ order: "invalid", category: "__proto__" }),
    DEFAULT_PROJECT_FILTERS,
  );
  assert.equal(
    filterProjects([project("x", [session("a", 1)])], {
      ...DEFAULT_PROJECT_FILTERS,
      category: "other",
    }).length,
    1,
  );
});
