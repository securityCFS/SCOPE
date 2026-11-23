import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { configuredSshTarget } from "./remote-images.mjs";

export const VIDEO_PROBE = String.raw`import os, sys, stat, json, re
p, r = sys.argv[1:3]
fd = os.open(p, os.O_RDONLY | os.O_NONBLOCK)
with os.fdopen(fd, 'rb') as f:
    s = os.fstat(f.fileno())
    if not stat.S_ISREG(s.st_mode): raise ValueError('Not a regular video file')
    head = f.read(4096)
    if head[4:8] == b'ftyp' and any(b in head[8:64] for b in [b'isom', b'iso2', b'iso4', b'iso5', b'iso6', b'mp41', b'mp42', b'avc1', b'M4V ']): mime = 'video/mp4'
    elif head[:4] == bytes([0x1a,0x45,0xdf,0xa3]) and b'webm' in head: mime = 'video/webm'
    elif head[:4] == b'OggS' and b'theora' in head: mime = 'video/ogg'
    else: raise ValueError('Unsupported video content (MP4/WebM/Ogg required)')
    size = s.st_size
    start, end, status = 0, size-1, 200
    if r:
        m = re.fullmatch(r'bytes=(\d*)-(\d*)', r)
        if not m or not any(m.groups()): status = 416
        elif not m[1]:
            suffix = int(m[2])
            start = max(0, size-suffix)
            if suffix == 0: status = 416
        else:
            start = int(m[1])
            if m[2]: end = min(end, int(m[2]))
        if start >= size or start > end: status = 416
        if status != 416: status = 206
    meta = dict(size=size, start=start, end=end, status=status, type=mime)
    sys.stdout.buffer.write((json.dumps(meta)+'\n').encode())
    sys.stdout.buffer.flush()
    if status != 416:
        f.seek(start)
        remaining = end-start+1
        while remaining:
            chunk = f.read(min(65536, remaining))
            if not chunk: raise ValueError('Video changed during reading')
            sys.stdout.buffer.write(chunk)
            remaining -= len(chunk)
`;

let active = 0;

export async function remoteVideoResponse(request, { spawnProcess = spawn, resolveHost = configuredSshTarget } = {}) {
  const url = new URL(request.url);
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.get("origin") && request.headers.get("origin") !== url.origin)) return new Response("Forbidden", { status: 403 });
  const remotePath = url.searchParams.get("path") || "";
  if (!remotePath.startsWith("/") || remotePath.startsWith("//") || remotePath.length > 4096 || /[\x00-\x1f]/.test(remotePath) || !/\.(mp4|m4v|webm|ogv)$/i.test(remotePath)) return new Response("Invalid video path", { status: 400 });
  if (active >= 4) return new Response("Video reader busy", { status: 503, headers: { "Retry-After": "2" } });
  active++;
  let child;
  let timer;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    active--;
    clearTimeout(timer);
    child?.kill(); // Only this request's read-only SSH subprocess.
    request.signal.removeEventListener("abort", release);
  };
  const refreshTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(release, 60_000);
  };
  try {
    const host = url.searchParams.get("host") || "";
    const sshConfig = await resolveHost(host);
    const quote = (s) => `'${s.replaceAll("'", `'"'"'`)}'`;
    child = spawnProcess("ssh", ["-F", sshConfig, "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "--", host, `python3 - ${quote(remotePath)} ${quote(request.headers.get("range") || "")}`], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let errors = "";
    const completion = new Promise((resolve) => {
      child.once("error", (error) => resolve({ error }));
      child.once("close", (code) => resolve({ code }));
    });
    child.stderr.on("data", (chunk) => { errors = (errors + chunk.toString()).slice(-2000); });
    child.stdin.on("error", () => {});
    child.stdin.end(VIDEO_PROBE);
    request.signal.addEventListener("abort", release, { once: true });
    if (request.signal.aborted) { release(); throw new Error("Request aborted"); }
    refreshTimeout();
    const iterator = child.stdout[Symbol.asyncIterator]();
    let initial = Buffer.alloc(0);
    let newline = -1;
    while (newline < 0) {
      const next = await iterator.next();
      if (next.done) throw new Error(errors || "Video reader exited");
      initial = Buffer.concat([initial, next.value]);
      newline = initial.indexOf(10);
      if ((newline < 0 && initial.length > 4096) || newline > 4096) throw new Error("Invalid video response");
    }
    const meta = JSON.parse(initial.subarray(0, newline).toString());
    const headers = {
      "Content-Type": meta.type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (meta.status === 416) { release(); return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${meta.size}` } }); }
    const length = meta.end-meta.start+1;
    headers["Content-Length"] = String(length);
    if (meta.status === 206) headers["Content-Range"] = `bytes ${meta.start}-${meta.end}/${meta.size}`;
    async function* body() {
      let received = 0;
      try {
        const first = initial.subarray(newline+1);
        received += first.length;
        if (first.length) yield first;
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          refreshTimeout();
          received += next.value.length;
          yield next.value;
        }
        const result = await completion;
        if (result.error || result.code !== 0 || received !== length) throw new Error("Video stream interrupted");
      } finally { release(); }
    }
    return new Response(Readable.toWeb(Readable.from(body())), { status: meta.status, headers });
  } catch (error) {
    release();
    return Response.json({ error: error.message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
