import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { markdownUrlTransform } from "../lib/markdown-url.js";
import {
  remoteFileTargetFromMarkdownHref,
} from "../lib/remote-links.js";

test("AGY file links survive Markdown sanitization and reach the session file handler", () => {
  const targets = [];
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
    urlTransform: (url, key) => markdownUrlTransform(url, key, "remote", "/work"),
    components: { a: ({ href, children }) => {
      const target = remoteFileTargetFromMarkdownHref(href, "/work");
      if (target) targets.push(target);
      return React.createElement("span", null, children);
    } },
  }, "[报告](file:///work/%E6%8A%A5%E5%91%8A%20one.md#L12)\n\n[代码](file:///C:/work/main.ts:34:2)\n\n[bad](javascript:alert)"));
  assert.match(html, /报告/);
  assert.deepEqual(targets, [
    { path: "/work/报告 one.md", line: 12, column: null },
    { path: "C:/work/main.ts", line: 34, column: 2 },
  ]);
  assert.equal(markdownUrlTransform("file:///work/a.md", "href", undefined, "/work"), "");
  assert.equal(markdownUrlTransform("javascript:alert", "href", "remote", "/work"), "");
  assert.equal(markdownUrlTransform("https://example.com", "href", "remote", "/work"), "https://example.com");
});

test("file URI paths preserve drive letters, encoding and localhost while rejecting foreign authorities", () => {
  for (const [href, expected] of [
    ["file://C:/work/a%20b.md", "C:/work/a b.md"],
    ["file:///C:/work/a.md", "C:/work/a.md"],
    ["file://localhost/work/a.md", "/work/a.md"],
    ["file:///work/a%23b%25.md", "/work/a#b%.md"],
  ]) assert.equal(remoteFileTargetFromMarkdownHref(href)?.path, expected);
  assert.equal(remoteFileTargetFromMarkdownHref("file://other-server/share/a.md"), null);
  assert.equal(remoteFileTargetFromMarkdownHref("file:///work/a%00.md"), null);
  assert.equal(remoteFileTargetFromMarkdownHref("docs/a.md", "C:/work")?.path, "C:/work/docs/a.md");
});

test("recognizes remote absolute paths without treating web links as files", () => {
  assert.equal(
    remoteFileTargetFromMarkdownHref(
      "/mnt/cluster/dev/results/merged%20result.mp4?download=1",
    )?.path,
    "/mnt/cluster/dev/results/merged result.mp4",
  );
  assert.equal(
    remoteFileTargetFromMarkdownHref("file:///mnt/cluster/dev/report.md")
      ?.path,
    "/mnt/cluster/dev/report.md",
  );
  assert.equal(
    remoteFileTargetFromMarkdownHref("https://example.com/report"),
    null,
  );
  assert.equal(remoteFileTargetFromMarkdownHref("notes/report.md"), null);
});

test("resolves Markdown file locations against the remote workspace", () => {
  assert.deepEqual(
    remoteFileTargetFromMarkdownHref(
      "docs/experiment_plan.md:176:4",
      "/mnt/cluster/dev/codespace/rl_utils",
    ),
    {
      path: "/mnt/cluster/dev/codespace/rl_utils/docs/experiment_plan.md",
      line: 176,
      column: 4,
    },
  );
  assert.deepEqual(
    remoteFileTargetFromMarkdownHref("../results/report.md#L23", "/work/repo/docs"),
    { path: "/work/repo/results/report.md", line: 23, column: null },
  );
  assert.equal(
    remoteFileTargetFromMarkdownHref("https://example.com/report.md", "/work/repo"),
    null,
  );
});
