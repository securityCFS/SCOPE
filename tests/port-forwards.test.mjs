import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { remotePortTargetFromMarkdownHref } from "../lib/remote-ports.js";
import {
  detectServiceLabel,
  filterDiscoveredPorts,
} from "../bridge/port-forwards/probe.mjs";
import { PortForwardManager } from "../bridge/port-forwards/manager.mjs";
import { portForwardRoutes } from "../bridge/port-forwards/routes.mjs";

function makeFakeChild() {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.killed = false;
  child.kill = () => {
    if (child.killed) return;
    child.killed = true;
    queueMicrotask(() => child.emit("close", 0));
  };
  return child;
}

test("remotePortTargetFromMarkdownHref detects loopback HTTP(S) URLs and ignores external links", () => {
  assert.deepEqual(
    remotePortTargetFromMarkdownHref("http://localhost:6006/scalars?run=exp1#top"),
    {
      port: 6006,
      protocol: "http:",
      pathAndQuery: "/scalars?run=exp1#top",
      rawHost: "localhost",
    },
  );
  assert.deepEqual(
    remotePortTargetFromMarkdownHref("http://127.0.0.1:7860"),
    {
      port: 7860,
      protocol: "http:",
      pathAndQuery: "/",
      rawHost: "127.0.0.1",
    },
  );
  assert.deepEqual(
    remotePortTargetFromMarkdownHref("http://0.0.0.0:8501/demo"),
    {
      port: 8501,
      protocol: "http:",
      pathAndQuery: "/demo",
      rawHost: "0.0.0.0",
    },
  );
  assert.deepEqual(
    remotePortTargetFromMarkdownHref("https://[::1]:8443/app"),
    {
      port: 8443,
      protocol: "https:",
      pathAndQuery: "/app",
      rawHost: "[::1]",
    },
  );
  assert.equal(remotePortTargetFromMarkdownHref("https://github.com/securityCFS/SCOPE"), null);
  assert.equal(remotePortTargetFromMarkdownHref("file:///workspace/app.py#L12"), null);
});

test("filterDiscoveredPorts labels ML/dev servers, prioritizes project cwd, and filters system/internal daemons", () => {
  assert.equal(detectServiceLabel("python3", "tensorboard --logdir runs", 6006), "TensorBoard");
  assert.equal(detectServiceLabel("python", "python -m uvicorn app:app --port 8000", 8000), "FastAPI");
  assert.equal(detectServiceLabel("node", "vite --port 5173", 5173), "Vite");

  const filtered = filterDiscoveredPorts(
    [
      { port: 22, procName: "sshd", cmdline: "/usr/sbin/sshd", cwd: "/" },
      { port: 53, procName: "systemd-resolve", cmdline: "", cwd: "/" },
      { port: 4922, procName: "sshd", cmdline: "", cwd: "/" },
      { port: 40149, procName: "code-7debcd0e2a", cmdline: "vscode-server", cwd: "/home/dev" },
      { port: 39967, procName: "agy", cmdline: "antigravity", cwd: "/home/dev" },
      { port: 38123, procName: "python3", cmdline: "python3 -m ipykernel_launcher", cwd: "/workspace/exp" },
      { port: 44444, procName: "random-daemon", cmdline: "internal-ipc", cwd: "/" },
      { port: 8080, procName: "python", cmdline: "python -m http.server 8080", cwd: "/other/dir" },
      { port: 6006, procName: "tensorboard", cmdline: "tensorboard --logdir runs", cwd: "/workspace/exp/sub" },
      { port: 6006, procName: "tensorboard", cmdline: "tensorboard --logdir runs", cwd: "/workspace/exp/sub", bind: "::" },
      { port: 7860, procName: "python3", cmdline: "python3 demo.py # gradio", cwd: "/workspace/exp" },
    ],
    { cwd: "/workspace/exp" },
  );

  assert.deepEqual(
    filtered.map((item) => ({ port: item.port, label: item.label, inProject: item.inProject })),
    [
      { port: 6006, label: "TensorBoard", inProject: true },
      { port: 7860, label: "Gradio", inProject: true },
      { port: 8080, label: "Python HTTP", inProject: false },
    ],
  );
});

test("PortForwardManager handles local port conflicts, hardened ssh -L args, auto-forward, dismissal, and reclaim", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "scope-port-forwards-"));
  const spawned = [];
  let remotePorts = [
    { port: 3000, bind: "127.0.0.1", pid: 101, procName: "node", label: "Next.js", cmdline: "next dev", cwd: "/app", inProject: true },
    { port: 6006, bind: "127.0.0.1", pid: 102, procName: "tensorboard", label: "TensorBoard", cmdline: "tensorboard", cwd: "/app", inProject: true },
  ];

  const manager = new PortForwardManager({
    stateDir: dir,
    getHost: (alias) => (alias === "gpu-a" ? { alias: "gpu-a", reachable: true } : null),
    runSsh: async () => ({ code: 0, stdout: "", stderr: "" }),
    discoverPorts: async () => remotePorts,
    checkLocalPortFree: async (port) => port !== 6006, // Simulate 6006 busy locally
    probeTcpListening: async () => true,
    spawnProcess: (bin, args) => {
      const child = makeFakeChild();
      spawned.push({ bin, args, child });
      return child;
    },
  });

  try {
    await manager.load();

    // Rejects @local and unknown hosts
    await assert.rejects(() => manager.forward({ host: "@local", remotePort: 6006 }));
    await assert.rejects(() => manager.forward({ host: "unknown-host", remotePort: 6006 }));

    // Remote 3000 avoids SCOPE's reserved local 3000 -> picks 13000
    const res1 = await manager.forward({ host: "gpu-a", remotePort: 3000, label: "Next.js" });
    assert.equal(res1.alreadyActive, false);
    assert.equal(res1.forward.localPort, 13000);
    assert.equal(res1.forward.status, "connected");
    assert.ok(spawned[0].args.includes("-L"));
    assert.ok(spawned[0].args.includes("127.0.0.1:13000:127.0.0.1:3000"));
    assert.ok(spawned[0].args.includes("ExitOnForwardFailure=yes"));

    // Idempotent repeat call reuses existing tunnel
    const res1Again = await manager.forward({ host: "gpu-a", remotePort: 3000 });
    assert.equal(res1Again.alreadyActive, true);
    assert.equal(spawned.length, 1);

    // Enable auto-forward -> discovers 6006 (busy locally -> 16006) and persists host setting
    const autoState = await manager.setAutoForward("gpu-a", true, { cwd: "/app" });
    assert.equal(autoState.autoForward, true);
    const tb = autoState.forwards.find((f) => f.remotePort === 6006);
    assert.ok(tb);
    assert.equal(tb.localPort, 16006);
    assert.equal(tb.auto, true);

    // Reload persistence check
    const reloaded = await new PortForwardManager({
      stateDir: dir,
      getHost: () => ({ alias: "gpu-a", reachable: true }),
    }).load();
    assert.equal(reloaded.state("gpu-a").autoForward, true);

    // Manual stop on auto-forwarded port dismisses it so next scan won't re-open it
    manager.stopForward("gpu-a", 6006);
    const afterDismissScan = await manager.scan("gpu-a", { force: true });
    assert.equal(afterDismissScan.forwards.some((f) => f.remotePort === 6006), false);

    // Auto-forward new port 7860, then verify 2 consecutive misses reclaim it
    remotePorts = [
      ...remotePorts,
      { port: 7860, bind: "127.0.0.1", pid: 103, procName: "python", label: "Gradio", cmdline: "gradio", cwd: "/app", inProject: true },
    ];
    const withGradio = await manager.scan("gpu-a", { force: true });
    assert.equal(withGradio.forwards.some((f) => f.remotePort === 7860 && f.auto), true);

    remotePorts = remotePorts.filter((p) => p.port !== 7860);
    const miss1 = await manager.scan("gpu-a", { force: true });
    assert.equal(miss1.forwards.some((f) => f.remotePort === 7860), true);
    const miss2 = await manager.scan("gpu-a", { force: true });
    assert.equal(miss2.forwards.some((f) => f.remotePort === 7860), false);

    // HTTP routes smoke test
    const responses = [];
    const routes = portForwardRoutes({
      portForwards: manager,
      readJsonBody: async () => ({ host: "gpu-a", remotePort: 8080 }),
      jsonResponse: (_res, status, payload) => responses.push({ status, payload }),
    });
    const handled = await routes(
      { method: "GET" },
      {},
      new URL("http://127.0.0.1:4815/api/port-forwards?host=gpu-a"),
    );
    assert.equal(handled, true);
    assert.equal(responses[0].status, 200);
    assert.equal(responses[0].payload.host, "gpu-a");

    await routes(
      { method: "POST" },
      {},
      new URL("http://127.0.0.1:4815/api/port-forwards/forward"),
    );
    assert.equal(responses[1].status, 200);
    assert.equal(responses[1].payload.forward.localPort, 8080);
  } finally {
    manager.stop();
    await manager.writes;
    rmSync(dir, { recursive: true, force: true });
  }
});
