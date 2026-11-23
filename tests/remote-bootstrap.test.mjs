import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { RemoteTunnelManager } from "../bridge/remote-bootstrap/tunnels.mjs";
import { RemoteBootstrapService } from "../bridge/remote-bootstrap/service.mjs";
import { remoteBootstrapRoutes } from "../bridge/remote-bootstrap/routes.mjs";
import { jsonResponse, readJsonBody } from "../bridge/http.mjs";

function createFakeChild() {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => child.emit("close", 0));
  };
  return child;
}

test("RemoteTunnelManager persists enabled hosts, starts relay, and manages SSH tunnels", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "scope-tunnels-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const spawned = [];
  let relayStarted = 0;
  let relayClosed = false;

  const manager = await new RemoteTunnelManager({
    stateDir: dir,
    emailNotifier: { publicState: () => ({}), notify: async () => ({ sent: true }) },
    legacyTunnelHost: "legacy-gpu",
    localRelayPort: 14822,
    spawnProcess(cmd, args) {
      const child = createFakeChild();
      spawned.push({ cmd, args, child });
      return child;
    },
    createRelayServer() {
      const server = new EventEmitter();
      server.listen = (_port, _host, cb) => {
        relayStarted++;
        cb();
      };
      server.close = () => {
        relayClosed = true;
      };
      server.closeAllConnections = () => {};
      return server;
    },
  }).load();

  t.after(() => manager.stop());

  await manager.start();
  assert.equal(relayStarted, 1);
  assert.equal(spawned.length, 1);
  assert.ok(spawned[0].args.includes("127.0.0.1:4922:127.0.0.1:14822"));
  assert.equal(spawned[0].args.at(-1), "legacy-gpu");

  await manager.enable("gpu-node-2", 4950);
  assert.equal(spawned.length, 2);
  assert.ok(spawned[1].args.includes("127.0.0.1:4950:127.0.0.1:14822"));

  await manager.enable("gpu-node-2", 4951);
  assert.ok(spawned.at(-1).args.includes("127.0.0.1:4951:127.0.0.1:14822"));
  assert.equal(manager.hostStatus("gpu-node-2").remotePort, 4951);

  await manager.disable("legacy-gpu");
  assert.equal(manager.hostStatus("legacy-gpu").enabled, false);
  assert.equal(manager.hostStatus("gpu-node-2").enabled, true);

  manager.stop();
  assert.equal(relayClosed, true);
});

test("RemoteBootstrapService inspects, deploys to ~/.local without hardcoded names, and removes cleanly", async () => {
  const runs = [];
  const sampleReport = {
    user: "researcher",
    isRoot: false,
    home: "/home/researcher",
    python3: "Python 3.11.8",
    node: "v22.14.0",
    npm: true,
    tmux: true,
    gpuCount: 4,
    localBinInPath: true,
    systemdUserAvailable: true,
    clis: { codex: { installed: true, executable: "/home/researcher/.local/bin/codex", version: "0.158.0" } },
    scopeNotify: {
      installed: true,
      executable: "/home/researcher/.local/bin/scope-notify",
      daemonActive: true,
      systemdServiceActive: true,
      relayReachable: true,
      queued: 0,
      lastDeliveredAt: null,
      codexMcp: true,
      claudeMcp: false,
    },
  };

  let enabledHost = null;
  let disabledHost = null;
  const bootstrap = new RemoteBootstrapService({
    getHost: (alias) => (alias === "gpu-node" ? { alias, reachable: true } : null),
    readRemoteTool: async () => "#!/usr/bin/env python3\nprint('ok')\n",
    tunnels: {
      enable: async (host, port) => {
        enabledHost = { host, port };
        return { token: "a".repeat(48), localPort: 4822 };
      },
      disable: async (host) => {
        disabledHost = host;
      },
      hostStatus: (host) => ({ enabled: enabledHost?.host === host && disabledHost !== host, remotePort: 4922, status: "connected" }),
      status: () => ({ relayListening: true, relayPort: 4822, relayTokenReady: true }),
    },
    run: async (host, cmd, stdin) => {
      runs.push({ host, cmd, stdin });
      if (stdin.includes("SCOPE_DEPLOY_OK=")) {
        assert.match(stdin, /\.local/);
        assert.match(stdin, /systemd/);
        assert.doesNotMatch(stdin, new RegExp("Yi" + "fei", "i"));
        return { code: 0, stdout: 'SCOPE_DEPLOY_OK={"daemonMode":"systemd-user"}\n', stderr: "" };
      }
      if (stdin.includes("SCOPE_REMOVE_OK=")) {
        return { code: 0, stdout: 'SCOPE_REMOVE_OK={"removed":true}\n', stderr: "" };
      }
      return {
        code: 0,
        stdout: `SCOPE_BOOTSTRAP_REPORT=${JSON.stringify(sampleReport)}\n`,
        stderr: "",
      };
    },
  });

  const deployed = await bootstrap.deploy("gpu-node", { remotePort: 4922, registerMcp: true });
  assert.deepEqual(enabledHost, { host: "gpu-node", port: 4922 });
  assert.equal(deployed.lastAction, "deploy");
  assert.equal(deployed.report.gpuCount, 4);

  const removed = await bootstrap.remove("gpu-node");
  assert.equal(disabledHost, "gpu-node");
  assert.equal(removed.lastAction, "remove");

  const handler = remoteBootstrapRoutes({ bootstrap, readJsonBody, jsonResponse });
  let status = 0;
  let responseBody = null;
  await handler(
    { method: "GET" },
    {
      writeHead(code) { status = code; },
      end(body) { responseBody = JSON.parse(body); },
    },
    new URL("http://127.0.0.1/api/remote-bootstrap?host=gpu-node"),
  );
  assert.equal(status, 200);
  assert.equal(responseBody.host, "gpu-node");
});
