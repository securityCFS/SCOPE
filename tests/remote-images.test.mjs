import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { markdownImageSource } from "../lib/markdown-images.js";
import { imageContentType, validateImagePath, remoteImageResponse, readRemoteImage } from "../bridge/remote-images.mjs";

test("SSH image references use the session host and working directory", () => {
  for (const [src, expected] of [
    ["/data/robotics_eval/图%201.png", "/data/robotics_eval/图 1.png"],
    ["plots/result.png", "/work/repo/plots/result.png"],
    ["../result.png", "/work/result.png"],
    ["file:///data/plot.png", "/data/plot.png"],
  ]) {
    const result = new URL(markdownImageSource(src, "10.0.0.12", "/work/repo"), "http://localhost:3000");
    assert.equal(result.pathname, "/scope-image-api");
    assert.equal(result.searchParams.get("host"), "10.0.0.12");
    assert.equal(result.searchParams.get("path"), expected);
  }
  assert.equal(markdownImageSource("https://example.com/p.png", "h", "/w"), "https://example.com/p.png");
  for (const src of ["javascript:alert(1)", "data:text/html,x", "//evil.com/p.png"]) assert.equal(markdownImageSource(src, "h", "/w"), "");
  assert.equal(markdownImageSource("/data/p.png", undefined, "/w"), "");
});

test("ReactMarkdown rewrites image sources before default file URL sanitization", () => {
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
    urlTransform: (url, key) => key === "src" ? markdownImageSource(url, "gpu-box", "/work") : defaultUrlTransform(url),
  }, "![plot](file:///data/plot.png)\n\n![relative](plots/p.png)\n\n[unsafe](javascript:alert)"));
  assert.match(html, /src="\/scope-image-api\?host=gpu-box&amp;path=%2Fdata%2Fplot.png"/);
  assert.match(html, /path=%2Fwork%2Fplots%2Fp.png/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("image-only path and content validation rejects non-images", async () => {
  for (const p of ["/root/.ssh/id_rsa", "/a.png\nwhoami", "relative.png", "//other/a.png", "/a.html", "/a.png\0"]) assert.throws(() => validateImagePath(p));
  assert.equal(validateImagePath("/data/it's a plot.PNG"), "/data/it's a plot.PNG");
  assert.equal(imageContentType(Buffer.from([137,80,78,71,13,10,26,10])), "image/png");
  assert.equal(imageContentType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), "image/svg+xml");
  assert.throws(() => imageContentType(Buffer.from('{"token":"secret"}')));
  assert.throws(() => imageContentType(Buffer.from('<html><svg></svg></html>')));
  await assert.rejects(readRemoteImage({ host: "-oProxyCommand=bad", requestedPath: "/x.png" }), /主机名/);
});

test("image responses are private, conditionally cached and sandbox SVG", async () => {
  const reader = async () => ({ data: Buffer.from("<svg></svg>"), type: "image/svg+xml", etag: '"hash"' });
  const url = "http://localhost:3000/scope-image-api?host=gpu-box&path=/x.svg";
  const response = await remoteImageResponse(new Request(url), reader);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private/);
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(await response.text(), "<svg></svg>");
  assert.equal((await remoteImageResponse(new Request(url, { headers: { "if-none-match": '"hash"' } }), reader)).status, 304);
  let called = false;
  const blockedReader = () => { called = true; throw new Error("must not read"); };
  assert.equal((await remoteImageResponse(new Request(url, { headers: { "sec-fetch-site": "cross-site" } }), blockedReader)).status, 403);
  assert.equal((await remoteImageResponse(new Request(url, { method: "POST" }), blockedReader)).status, 405);
  assert.equal(called, false);
  const error = await remoteImageResponse(new Request(url), async () => { throw new Error("missing"); });
  assert.equal(error.status, 400);
  assert.equal(error.headers.get("cache-control"), "no-store");
});
