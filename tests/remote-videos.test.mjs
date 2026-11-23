import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { remoteVideoResponse } from "../bridge/remote-videos.mjs";
import { markdownVideoSource, isVideoSource } from "../lib/markdown-images.js";

test("both Markdown video links and embeds resolve on the session host", () => {
  for (const src of ["/data/clip.mp4", "file:///data/clip.mp4", "../clip.mp4"]) {
    const u = new URL(markdownVideoSource(src, "gpu-box", "/data/work"), "http://localhost");
    assert.equal(u.pathname, "/scope-video-api");
    assert.equal(u.searchParams.get("path"), "/data/clip.mp4");
  }
  assert.equal(markdownVideoSource("https://example.com/v.webm", "gpu-box"), "https://example.com/v.webm");
  assert.equal(markdownVideoSource("javascript:bad.mp4", "gpu-box", "/w"), "");
  assert.equal(isVideoSource("/path/image.png"), false);
});

function fakeSsh(meta, data = Buffer.from("xyz"), code = 0) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; child.stdout.end(); child.emit("close", 0); };
  child.stdin.once("finish", () => {
    setImmediate(() => {
      child.stdout.write(JSON.stringify(meta).slice(0, 10));
      child.stdout.end(Buffer.concat([Buffer.from(JSON.stringify(meta).slice(10) + "\n"), data]));
      child.emit("close", code);
    });
  });
  return child;
}

test("video endpoint streams range bytes with correct headers and quotes the path", async () => {
  const child = fakeSsh({ status: 206, type: "video/mp4", size: 100, start: 10, end: 12 });
  let args;
  const url = "http://localhost:3000/scope-video-api?" + new URLSearchParams({ host: "gpu-box", path: "/data/it's a clip.mp4" });
  const response = await remoteVideoResponse(new Request(url, { headers: { range: "bytes=10-12" } }), {
    resolveHost: async () => "config",
    spawnProcess: (_cmd, argv) => { args = argv; return child; },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 10-12/100");
  assert.equal(response.headers.get("content-length"), "3");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.match(args.at(-1), /'"'"'/);
  assert.equal(await response.text(), "xyz");
  assert.equal(child.killed, true);
});

test("invalid ranges return 416; truncated streams fail rather than silently complete", async () => {
  const url = "http://localhost:3000/scope-video-api?host=gpu-box&path=/x.mp4";
  const opts = (child) => ({ resolveHost: async () => "config", spawnProcess: () => child });
  const invalid = await remoteVideoResponse(new Request(url), opts(fakeSsh({ status: 416, type: "video/mp4", size: 10 }, Buffer.alloc(0))));
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), "bytes */10");
  const truncated = await remoteVideoResponse(new Request(url), opts(fakeSsh({ status: 200, type: "video/mp4", size: 5, start: 0, end: 4 })));
  await assert.rejects(truncated.text(), /interrupted/);
});

test("video access rejects cross-site requests and non-video paths before SSH", async () => {
  const opts = { resolveHost: () => { throw new Error("must not call"); } };
  const url = "http://localhost:3000/scope-video-api?host=gpu-box&path=/x.mp4";
  assert.equal((await remoteVideoResponse(new Request(url, { headers: { "sec-fetch-site": "cross-site" } }), opts)).status, 403);
  assert.equal((await remoteVideoResponse(new Request(url.replace("x.mp4", "auth.json")), opts)).status, 400);
});
