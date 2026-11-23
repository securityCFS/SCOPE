import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProjects, projectIdentity, projectList } from "../lib/projects.js";

test("project identity includes the host and accepts only absolute remote directories", () => {
  assert.notEqual(projectIdentity("alpha", "/work/a").key, projectIdentity("beta", "/work/a").key);
  assert.equal(projectIdentity("alpha", "/work/a/").key, projectIdentity("alpha", "/work/a").key);
  assert.equal(projectIdentity("alpha", ""), null);
  assert.equal(projectIdentity("alpha", "relative"), null);
  assert.equal(projectIdentity("alpha", "/work/\nname"), null);
  assert.equal(projectIdentity("alpha", "/").cwd, "/");
  assert.notEqual(projectIdentity("alpha", "/work/name ").key, projectIdentity("alpha", "/work/name").key);
});

test("pinned directories survive without sessions and do not merge with another host or child directory", () => {
  const pinned = normalizeProjects([{ host: "alpha", cwd: "/work/a/" }, { host: "alpha", cwd: "/work/a" }]);
  const projects = projectList(pinned, [
    { id: "1", host: "beta", cwd: "/work/a" },
    { id: "2", host: "alpha", cwd: "/work/a/child" },
    { id: "3", host: "alpha", cwd: "" },
  ]);
  assert.equal(projects.length, 3);
  assert.equal(projects[0].pinned, true);
  assert.equal(projects[0].sessions.length, 0);
  assert.equal(projects.find((project) => project.host === "beta").sessions[0].id, "1");
});
