// Read-only bounded benchmark; never scans hosts or starts agent turns.
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const base = process.env.SCOPE_BENCH_URL || "http://127.0.0.1:4815";
const duration = Number(process.env.SCOPE_BENCH_SECONDS || 60);
if (!Number.isFinite(duration) || duration < 5 || duration > 600) throw Error("Duration must be 5–600 seconds");
const request = async (route) => {
  const start = performance.now();
  const response = await fetch(base + route, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(`${route}: ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  return { ms: performance.now() - start, bytes: body.length, estimatedGzipBytes: gzipSync(body).length, value: JSON.parse(body) };
};
const full = await request("/api/snapshot");
const initial = await request("/api/sync");
const cursors = Array.from({ length: 4 }, () => initial.value);
const samples = [], requests = [];
const start = performance.now();
while (performance.now() - start < duration * 1000) {
  const health = await request("/api/health");
  samples.push({ seconds: Math.round((performance.now() - start) / 1000), ...health.value.memory, sync: health.value.sync });
  const batch = await Promise.all(cursors.map(c => request(`/api/sync?fields=1&epoch=${encodeURIComponent(c.epoch)}&since=${c.revision}`)));
  batch.forEach((r, i) => {
    cursors[i] = r.value;
    requests.push({ ms: r.ms, bytes: r.bytes, reset: r.value.reset, changed: r.value.revision !== r.value.fromRevision });
  });
  await new Promise(r => setTimeout(r, 1000));
}
const percentile = (values, p) => [...values].sort((a,b) => a-b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
const pick = ({ ms, bytes, estimatedGzipBytes }) => ({ ms, bytes, estimatedGzipBytes });
const report = { measuredAt: new Date().toISOString(), base, durationSeconds: duration, clients: cursors.length,
  fullSnapshot: pick(full), initialSync: pick(initial),
  sync: { requests: requests.length, p50Ms: percentile(requests.map(r=>r.ms),.5), p95Ms: percentile(requests.map(r=>r.ms),.95), totalBodyBytes: requests.reduce((s,r)=>s+r.bytes,0), unchangedBytes: requests.find(r=>!r.changed)?.bytes, resets: requests.filter(r=>r.reset).length },
  bridgeMemory: { initial: samples[0], final: samples.at(-1), peakRssMiB: Math.max(...samples.map(s=>s.rssMiB)), peakHeapUsedMiB: Math.max(...samples.map(s=>s.heapUsedMiB)) }, samples,
  limitations: "Four polling clients on loopback, short observation under real background inventory; HTTP body bytes exclude headers/TLS/SSH. Gzip is an estimate, not enabled compression. Bridge memory excludes UI, browser and remote CLI processes; this is not a memory-leak test." };
await mkdir("outputs/integration", { recursive: true });
await writeFile("outputs/integration/bridge-benchmark.json", JSON.stringify(report,null,2));
console.log(JSON.stringify({ ...report, samples: undefined }));
