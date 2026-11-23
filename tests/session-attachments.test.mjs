import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  MAX_ATTACHMENT_BYTES,
  appServerTurnInput,
  attachmentKind,
  formatUserPromptPreview,
  isValidAttachmentPath,
  renderInstructionWithAttachments,
  safeAttachmentFilename,
  streamAttachmentToLocal,
} from "../bridge/session-attachments.mjs";

test("sanitizes attachment filenames while preserving a useful extension", () => {
  assert.equal(
    safeAttachmentFilename("../../实验 reward (final).PNG", "a1b2"),
    "reward-final-a1b2.png",
  );
  assert.equal(safeAttachmentFilename("..\\..\\", "x"), "attachment-x");
});

test("only supported raster MIME types become structured images", () => {
  assert.equal(attachmentKind("image/png"), "image");
  assert.equal(attachmentKind("image/webp"), "image");
  assert.equal(attachmentKind("image/svg+xml"), "file");
  assert.equal(attachmentKind("application/pdf"), "file");
});

test("renders paths for all files and localImage input only for images", () => {
  const attachments = [
    {
      name: "curve.png",
      mimeType: "image/png",
      size: 10,
      kind: "image",
      remotePath: "/home/dev/.codex/scope-attachments/curve.png",
    },
    {
      name: "metrics.csv",
      mimeType: "text/csv",
      size: 20,
      kind: "file",
      remotePath: "/home/dev/.codex/scope-attachments/metrics.csv",
    },
  ];
  const rendered = renderInstructionWithAttachments("检查实验", attachments);
  assert.match(rendered, /检查实验/);
  assert.match(rendered, /curve\.png/);
  assert.match(rendered, /metrics\.csv/);

  assert.deepEqual(appServerTurnInput("检查实验", attachments), [
    { type: "text", text: rendered, text_elements: [] },
    {
      type: "localImage",
      path: "/home/dev/.codex/scope-attachments/curve.png",
    },
  ]);
});

test("supports Windows local paths, prompt previews, and bounded local streaming", async (t) => {
  assert.equal(isValidAttachmentPath("C:\\Users\\dev\\.codex\\scope-attachments\\plot.png"), true);
  assert.equal(isValidAttachmentPath("/home/dev/.codex/scope-attachments/plot.png"), true);
  assert.equal(isValidAttachmentPath("relative/path.png"), false);

  const localAttachments = [
    {
      name: "plot.png",
      mimeType: "image/png",
      size: 42,
      kind: "image",
      remotePath: "C:\\Users\\dev\\.codex\\scope-attachments\\plot.png",
    },
  ];
  assert.equal(
    formatUserPromptPreview("", localAttachments),
    "[附件: plot.png]",
  );
  assert.equal(
    formatUserPromptPreview("分析结果", localAttachments),
    "分析结果\n\n[附件: plot.png]",
  );
  assert.deepEqual(appServerTurnInput("分析结果", localAttachments)[1], {
    type: "localImage",
    path: "C:\\Users\\dev\\.codex\\scope-attachments\\plot.png",
  });

  const dir = await mkdtemp(path.join(tmpdir(), "scope-attach-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const req = Readable.from([Buffer.from("hello-"), Buffer.from("scope")]);
  req.headers = { "content-length": "11" };
  const uploaded = await streamAttachmentToLocal(req, {
    baseDir: dir,
    scopeSegment: "manager",
    uploadId: "u1",
    filename: "note.txt",
  });
  assert.equal(uploaded.size, 11);
  assert.equal(await readFile(uploaded.remotePath, "utf8"), "hello-scope");

  const oversized = Readable.from([Buffer.alloc(1024)]);
  oversized.headers = { "content-length": String(MAX_ATTACHMENT_BYTES + 1) };
  await assert.rejects(
    streamAttachmentToLocal(oversized, {
      baseDir: dir,
      scopeSegment: "manager",
      uploadId: "u2",
      filename: "huge.bin",
    }),
    (err) => err?.statusCode === 413,
  );
});

test("local upload open failure is caught without crashing or overwriting an existing file", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "scope-attach-error-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "manager/u1"), { recursive: true });
  const target = path.join(dir, "manager/u1/note.txt");
  await writeFile(target, "keep");
  // Separate process proves an early writer error cannot escape as an unhandled event.
  const code = `
    import { Readable } from 'node:stream';
    import { streamAttachmentToLocal } from ${JSON.stringify(new URL("../bridge/session-attachments.mjs", import.meta.url).href)};
    const request = Readable.from((async function* () { await new Promise(r => setTimeout(r, 100)); yield Buffer.from('replace'); })());
    request.headers = {};
    try { await streamAttachmentToLocal(request, { baseDir: ${JSON.stringify(dir)}, scopeSegment: 'manager', uploadId: 'u1', filename: 'note.txt' }); process.exitCode = 2; }
    catch (error) { if (error.code !== 'EEXIST') throw error; console.log('caught:EEXIST'); }
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", code]);
  assert.match(stdout, /caught:EEXIST/);
  assert.equal(await readFile(target, "utf8"), "keep");
});
