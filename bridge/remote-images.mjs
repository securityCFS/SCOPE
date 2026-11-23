import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const TTL = 60_000;
const cache = new Map();
const pending = new Map();
let cacheBytes = 0;
let activeReads = 0;
const waiting = [];

export function validateImagePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 4096 || /[\x00-\x1f]/.test(value)) {
    throw new Error("图片必须使用远端绝对路径");
  }
  if (!/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(value)) throw new Error("不支持的图片格式");
  return value;
}

export function imageContentType(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(data.subarray(0, 6).toString())) return "image/gif";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (data.toString("ascii", 0, 2) === "BM") return "image/bmp";
  if (data.subarray(0, 4).equals(Buffer.from([0,0,1,0]))) return "image/x-icon";
  if (data.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(data.toString("ascii", 8, 32))) return "image/avif";
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(data.subarray(0, 4096).toString("utf8"))) return "image/svg+xml";
  throw new Error("文件内容不是支持的图片");
}

const PROBE = `import os, stat, sys
p = sys.argv[1]
fd = os.open(p, os.O_RDONLY | os.O_NONBLOCK)
with os.fdopen(fd, 'rb') as f:
    s = os.fstat(f.fileno())
    if not stat.S_ISREG(s.st_mode): raise ValueError('Not a regular image file')
    if s.st_size > ${MAX_IMAGE_BYTES}: raise ValueError('Image exceeds 20 MiB')
    data = f.read(${MAX_IMAGE_BYTES + 1})
    if len(data) > ${MAX_IMAGE_BYTES}: raise ValueError('Image exceeds 20 MiB')
    sys.stdout.buffer.write(data)
`;

export async function configuredSshTarget(host) {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.@:-]*$/.test(host || "")) throw new Error("SSH 主机名无效");
  const sshConfig = process.env.SCOPE_SSH_CONFIG || path.join(os.homedir(), ".ssh", "config");
  const config = await readFile(sshConfig, "utf8");
  const aliases = [...config.matchAll(/^\s*Host\s+([^\r\n#]+)/gmi)].flatMap((m) => m[1].trim().split(/\s+/));
  if (!aliases.includes(host)) throw new Error("只能读取已配置 SSH 主机的图片");
  return sshConfig;
}

export async function readRemoteImage({ host, requestedPath }) {
  validateImagePath(requestedPath);
  const sshConfig = await configuredSshTarget(host);
  const key = JSON.stringify([host, requestedPath]);
  const old = cache.get(key);
  if (old && Date.now() - old.time < TTL) return old;
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 36) throw new Error("图片加载繁忙，请稍后重试");
  const slot = activeReads < 4 ? (activeReads++, Promise.resolve()) : new Promise((resolve) => waiting.push(resolve));
  const work = slot.then(() => new Promise((resolve, reject) => {
    const quoted = `'${requestedPath.replaceAll("'", `'"'"'`)}'`;
    const child = spawn("ssh", ["-F", sshConfig, "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "--", host, `python3 - ${quoted}`], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let size = 0;
    let errorText = "";
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) { child.kill(); reject(error); } else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("远端图片读取超时")), 30_000);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) finish(new Error("图片超过 20 MiB"));
      else if (!done) chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => { errorText = (errorText + chunk.toString()).slice(-2000); });
    child.stdin.on("error", (error) => finish(error));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (done) return;
      if (code !== 0) return finish(new Error(errorText.trim() || "远端图片读取失败"));
      try {
        const data = Buffer.concat(chunks);
        const type = imageContentType(data);
        finish(null, { data, type, etag: `"${createHash("sha256").update(data).digest("hex")}"`, time: Date.now() });
      } catch (error) { finish(error); }
    });
    child.stdin.end(PROBE);
  })).finally(() => {
    const next = waiting.shift();
    if (next) next();
    else activeReads--;
  });
  pending.set(key, work);
  try {
    const result = await work;
    if (old) { cache.delete(key); cacheBytes -= old.data.length; }
    while (cache.size && (cacheBytes + result.data.length > MAX_CACHE_BYTES || cache.size >= 128)) {
      const first = cache.keys().next().value;
      cacheBytes -= cache.get(first).data.length;
      cache.delete(first);
    }
    cache.set(key, result);
    cacheBytes += result.data.length;
    return result;
  } finally { pending.delete(key); }
}

export async function remoteImageResponse(request, reader = readRemoteImage) {
  const url = new URL(request.url);
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  // Prevent other sites from embedding private SSH files or reading this endpoint.
  if (request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.get("origin") && request.headers.get("origin") !== url.origin)) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const result = await reader({ host: url.searchParams.get("host") || "", requestedPath: url.searchParams.get("path") || "" });
    const headers = {
      "Content-Type": result.type,
      "Cache-Control": "private, max-age=60",
      "ETag": result.etag,
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    };
    if (request.headers.get("if-none-match") === result.etag) return new Response(null, { status: 304, headers });
    return new Response(result.data, { headers });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
