import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isRemoteBrowserLocation,
  portForwardAccessUrl,
  remotePortTargetFromMarkdownHref,
} from "../lib/remote-ports.js";
import {
  detectServiceLabel,
  filterDiscoveredPorts,
  parseWindowsNetstatListening,
} from "../bridge/port-forwards/probe.mjs";
import {
  PortForwardManager,
  resolveRemoteTargetHost,
} from "../bridge/port-forwards/manager.mjs";
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

    // Remote 3000 avoids SCOPE's reserved local 3000 -> picks 13000 (uses localhost before scan so sshd tries IPv4 & IPv6)
    const res1 = await manager.forward({ host: "gpu-a", remotePort: 3000, label: "Next.js" });
    assert.equal(res1.alreadyActive, false);
    assert.equal(res1.forward.localPort, 13000);
    assert.equal(res1.forward.status, "connected");
    assert.ok(spawned[0].args.includes("-L"));
    assert.ok(spawned[0].args.includes("127.0.0.1:13000:localhost:3000"));
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

test("portForwardAccessUrl routes remote browsers through /scope-port and keeps loopback direct", () => {
  assert.equal(
    isRemoteBrowserLocation({ hostname: "127.0.0.1", origin: "http://127.0.0.1:3000" }),
    false,
  );
  assert.equal(
    isRemoteBrowserLocation({ hostname: "localhost", origin: "http://localhost:3000" }),
    false,
  );
  assert.equal(
    isRemoteBrowserLocation({ hostname: "scope.example.dev", origin: "https://scope.example.dev" }),
    true,
  );

  assert.equal(
    portForwardAccessUrl(4871, {
      pathAndQuery: "/docs?q=1",
      location: { hostname: "127.0.0.1", origin: "http://127.0.0.1:3000" },
    }),
    "http://127.0.0.1:4871/docs?q=1",
  );
  assert.equal(
    portForwardAccessUrl(4871, {
      pathAndQuery: "/docs?q=1",
      location: { hostname: "scope.example.dev", origin: "https://scope.example.dev" },
    }),
    "https://scope.example.dev/scope-port/4871/docs?q=1",
  );
  assert.equal(
    portForwardAccessUrl(6006, {
      location: { hostname: "scope.example.dev", origin: "https://scope.example.dev" },
    }),
    "https://scope.example.dev/scope-port/6006/",
  );
});

test("PortForwardManager supports @local discovery & zero-SSH exposure when allowLocal is enabled", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "scope-local-ports-"));
  const spawned = [];
  const listeningPorts = new Set([4871, 8080]);
  let lastExcludePorts = null;

  const filtered = filterDiscoveredPorts(
    [
      { port: 3000, procName: "node", cmdline: "ui-server", cwd: "/opt/scope" },
      { port: 4815, procName: "node", cmdline: "bridge/server.mjs", cwd: "/opt/scope" },
      { port: 4820, procName: "node", cmdline: "private-gateway", cwd: "/opt/scope" },
      { port: 2019, procName: "caddy", cmdline: "caddy run", cwd: "/" },
      { port: 7860, procName: "ssh", cmdline: "ssh -NT -L 127.0.0.1:7860:127.0.0.1:7860 gpu-a", cwd: "/" },
      { port: 4871, procName: "python3", cmdline: "python3 -m http.server 4871", cwd: "/workspace/demo" },
    ],
    { cwd: "/workspace/demo", excludePorts: [3000] },
  );
  assert.deepEqual(
    filtered.map((item) => item.port),
    [4871],
  );

  const manager = new PortForwardManager({
    stateDir: dir,
    allowLocal: true,
    getHost: (alias) => (alias === "gpu-a" ? { alias: "gpu-a", reachable: true } : null),
    runSsh: async () => ({ code: 0, stdout: "", stderr: "" }),
    discoverPorts: async ({ excludePorts }) => {
      lastExcludePorts = excludePorts ? new Set(excludePorts) : null;
      return [
        { port: 4871, bind: "127.0.0.1", pid: 201, procName: "python3", label: "Python HTTP", cmdline: "python3 -m http.server 4871", cwd: "/workspace/demo", inProject: true },
      ];
    },
    checkLocalPortFree: async () => true,
    probeTcpListening: async (port) => listeningPorts.has(port) || port === 9090,
    spawnProcess: (bin, args) => {
      const child = makeFakeChild();
      spawned.push({ bin, args, child });
      return child;
    },
  });

  try {
    await manager.load();

    // Blocked SCOPE/system ports must never be exposed locally
    for (const blocked of [22, 2019, 3000, 4815, 4820, 4822]) {
      await assert.rejects(
        () => manager.forward({ host: "@local", remotePort: blocked }),
        /系统保留端口/,
      );
    }

    // Unlistening local port is rejected cleanly
    await assert.rejects(
      () => manager.forward({ host: "@local", remotePort: 9999 }),
      /未检测到监听服务/,
    );

    // Listening @local port registers without spawning SSH
    const res = await manager.forward({ host: "@local", remotePort: 4871, label: "Demo Web" });
    assert.equal(res.alreadyActive, false);
    assert.equal(res.forward.host, "@local");
    assert.equal(res.forward.remotePort, 4871);
    assert.equal(res.forward.localPort, 4871);
    assert.equal(res.forward.localOnly, true);
    assert.equal(res.forward.status, "connected");
    assert.equal(spawned.length, 0);

    // Repeat call is idempotent
    const again = await manager.forward({ host: "@local", remotePort: 4871 });
    assert.equal(again.alreadyActive, true);
    assert.equal(spawned.length, 0);

    // Remote SSH forward on localPort 9090 blocks colliding @local exposure & is excluded from @local scan
    await manager.forward({ host: "gpu-a", remotePort: 9090 });
    assert.equal(spawned.length, 1);
    await assert.rejects(
      () => manager.forward({ host: "@local", remotePort: 9090 }),
      /已被远端主机/,
    );
    await manager.scan("@local", { cwd: "/workspace/demo", force: true });
    assert.equal(lastExcludePorts?.has(4815), true);
    assert.equal(lastExcludePorts?.has(3000), true);
    assert.equal(lastExcludePorts?.has(9090), true);

    // Stop revokes @local exposure immediately
    const afterStop = manager.stopForward("@local", 4871);
    assert.equal(afterStop.forwards.length, 0);

    // Auto-expose persistence works for @local when allowLocal is enabled
    await manager.setAutoForward("@local", true, { cwd: "/workspace/demo" });
    assert.equal(manager.state("@local").forwards.some((f) => f.remotePort === 4871 && f.localOnly), true);
    const reloaded = await new PortForwardManager({
      stateDir: dir,
      allowLocal: true,
    }).load();
    assert.equal(reloaded.state("@local").autoForward, true);
  } finally {
    manager.stop();
    await manager.writes;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("filterDiscoveredPorts keeps user servers in antigravity-cli directories, filters SCOPE ui-server, and parses Windows netstat", () => {
  const filtered = filterDiscoveredPorts([
    {
      port: 8787,
      bind: "127.0.0.1",
      pid: 9001,
      procName: "python3",
      cmdline: "python3 -m http.server 8787 --bind 127.0.0.1 --directory /home/dev/.gemini/antigravity-cli/brain/demo/scratch/web",
      cwd: "/home/dev",
    },
    {
      port: 3000,
      bind: "127.0.0.1",
      pid: 9002,
      procName: "node",
      cmdline: "/usr/bin/node /home/dev/scope/bridge/ui-server.mjs --hostname 127.0.0.1 --port 3000",
      cwd: "/home/dev/scope",
    },
    {
      port: 39991,
      bind: "127.0.0.1",
      pid: 9003,
      procName: "antigravity-language-server",
      cmdline: "/usr/bin/antigravity-language-server --port 39991",
      cwd: "/home/dev",
    },
  ]);

  assert.deepEqual(
    filtered.map((item) => ({ port: item.port, label: item.label })),
    [{ port: 8787, label: "Python HTTP" }],
  );

  const procMap = new Map([
    [1234, { name: "python", cmdline: "python -m http.server 8787" }],
    [5678, { name: "node", cmdline: "node vite --port 5173" }],
  ]);
  const winParsed = parseWindowsNetstatListening(
    [
      "Active Connections",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    127.0.0.1:8787         0.0.0.0:0              LISTENING       1234",
      "  TCP    [::1]:5173             [::]:0                 LISTENING       5678",
      "  TCP    127.0.0.1:8787         127.0.0.1:54321        ESTABLISHED     1234",
    ].join("\r\n"),
    procMap,
  );
  assert.deepEqual(
    winParsed.map((item) => ({ port: item.port, bind: item.bind, procName: item.procName })),
    [
      { port: 8787, bind: "127.0.0.1", procName: "python" },
      { port: 5173, bind: "::1", procName: "node" },
    ],
  );
});

test("resolveRemoteTargetHost supports IPv4, IPv6 loopback, interface IP, and wildcard/unknown fallback", async () => {
  assert.equal(resolveRemoteTargetHost("127.0.0.1"), "127.0.0.1");
  assert.equal(resolveRemoteTargetHost("::1"), "[::1]");
  assert.equal(resolveRemoteTargetHost("[::1]"), "[::1]");
  assert.equal(resolveRemoteTargetHost("10.120.8.53"), "10.120.8.53");
  assert.equal(resolveRemoteTargetHost("0.0.0.0"), "localhost");
  assert.equal(resolveRemoteTargetHost("*"), "localhost");
  assert.equal(resolveRemoteTargetHost("::"), "localhost");
  assert.equal(resolveRemoteTargetHost(""), "localhost");

  const dir = mkdtempSync(path.join(tmpdir(), "scope-port-binds-"));
  const spawned = [];
  const manager = new PortForwardManager({
    stateDir: dir,
    getHost: () => ({ alias: "gpu-v6", reachable: true }),
    runSsh: async () => ({ code: 0, stdout: "", stderr: "" }),
    discoverPorts: async () => [
      { port: 5173, bind: "::1", pid: 10, procName: "node", label: "Vite", cmdline: "vite", cwd: "/app", inProject: true },
      { port: 4142, bind: "10.120.8.53", pid: 11, procName: "ray", label: "Ray", cmdline: "ray", cwd: "/app", inProject: false },
    ],
    checkLocalPortFree: async () => true,
    probeTcpListening: async () => true,
    spawnProcess: (_bin, args) => {
      const child = makeFakeChild();
      spawned.push(args);
      return child;
    },
  });

  try {
    await manager.load();
    await manager.scan("gpu-v6", { force: true });
    await manager.forward({ host: "gpu-v6", remotePort: 5173 });
    await manager.forward({ host: "gpu-v6", remotePort: 4142 });
    await manager.forward({ host: "gpu-v6", remotePort: 9998 });
    assert.ok(spawned[0].includes("127.0.0.1:5173:[::1]:5173"));
    assert.ok(spawned[1].includes("127.0.0.1:4142:10.120.8.53:4142"));
    assert.ok(spawned[2].includes("127.0.0.1:9998:localhost:9998"));
  } finally {
    manager.stop();
    await manager.writes;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PortForwardManager opt-in public static share creates, rotates, expires, and auto-revokes tokens", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "scope-port-share-"));
  const manager = new PortForwardManager({
    stateDir: dir,
    allowLocal: true,
    getHost: () => null,
    runSsh: async () => ({ code: 0, stdout: "", stderr: "" }),
    discoverPorts: async () => [],
    checkLocalPortFree: async () => true,
    probeTcpListening: async (port) => port === 8787,
  });

  try {
    await manager.load();
    assert.throws(
      () => manager.shareForward({ host: "@local", remotePort: 8787 }),
      /请先开放或转发/,
    );

    await manager.forward({ host: "@local", remotePort: 8787, label: "Research Report" });
    assert.equal(manager.state("@local").forwards[0].publicShare, null);

    const created = manager.shareForward({ host: "@local", remotePort: 8787, ttlHours: 24 });
    assert.equal(created.share.mode, "readonly-static");
    assert.match(created.share.token, /^[A-Za-z0-9_-]{24,64}$/);
    assert.ok(created.share.expiresAt);
    assert.equal(created.forward.publicShare.token, created.share.token);

    // Calling again without rotate keeps the same token and updates expiry
    const updated = manager.shareForward({ host: "@local", remotePort: 8787, ttlHours: 0 });
    assert.equal(updated.share.token, created.share.token);
    assert.equal(updated.share.expiresAt, null);

    // Rotate mints a brand-new unguessable token
    const rotated = manager.shareForward({ host: "@local", remotePort: 8787, ttlHours: 168, rotate: true });
    assert.notEqual(rotated.share.token, created.share.token);

    // Explicit unshare clears the token immediately
    const unshared = manager.unshareForward("@local", 8787);
    assert.equal(unshared.forwards[0].publicShare, null);

    // Re-share then stopForward auto-revokes public share
    const reshared = manager.shareForward({ host: "@local", remotePort: 8787, ttlHours: 24 });
    assert.ok(reshared.share.token);
    const stopped = manager.stopForward("@local", 8787);
    assert.equal(stopped.forwards.length, 0);
  } finally {
    manager.stop();
    await manager.writes;
    rmSync(dir, { recursive: true, force: true });
  }
});
