/** Isolated UI fixture: synthetic inventory and adapters, no SSH or model calls. */
import { sessionArchiveService } from "../bridge/archive/service.mjs";
import { archiveRoutes } from "../bridge/archive/routes.mjs";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startProductionUiServer } from "../bridge/ui-server.mjs";
import { WorkbenchStore } from "../bridge/workbench/store.mjs";
import { WorkbenchService } from "../bridge/workbench/service.mjs";
import { workbenchRoutes } from "../bridge/workbench/routes.mjs";
import { createIncrementalSnapshotStore } from "../lib/incremental-snapshot.js";
import { createConversationFixture } from "./fixtures/workbench-conversations.mjs";
import { nativeConversationFixture } from "./fixtures/native-conversations.mjs";
import { PluginRegistry } from "../bridge/plugins/registry.mjs";
import { pluginRoutes } from "../bridge/plugins/routes.mjs";
import { createAliyunDlcPlugin } from "../bridge/plugins/aliyun-dlc/index.mjs";
import { fileURLToPath } from "node:url";
import { installPackage } from "../bridge/plugins/package.mjs";
import { loadExternalPlugins } from "../bridge/plugins/external.mjs";

const dir = await mkdtemp(path.join(tmpdir(), "scope-ui-preview-"));
const store = await new WorkbenchStore(path.join(dir, "workbench.json")).load();
const projects = [
  { host: "lab-gpu", cwd: "/workspace/vision", name: "Vision Lab" },
  { host: "build-node", cwd: "/workspace/scope", name: "SCOPE" },
  { host: "lab-gpu", cwd: "/workspace/research", name: "研究笔记" },
];
const snapshot = {
  generatedAt: new Date().toISOString(),
  scanning: false,
  sshConfig: "Preview fixture — no SSH",
  summary: { hosts: 2, online: 2, codex: 0, tmux: 0, attention: 0 },
  management: {
    operatorName: "预览",
    sessions: {},
    projects,
    hostRuntimeConfigs: {},
    resourcePolicy: { prompt: "", version: 0, updatedAt: null },
  },
  appServer: {
    experimental: true,
    connections: [],
    sessions: [],
    pendingRequests: [],
    pendingInputs: [],
  },
  submissionTracker: {
    scannedAt: null,
    scanning: false,
    windowDays: 1,
    items: [],
    calls: [],
    launches: [],
    alerts: [],
    hosts: [],
    error: null,
  },
  gpuUsage: { updatedAt: null, retentionHours: 168, episodes: [] },
  notifications: { email: { enabled: false, configured: false, to: [] } },
  hosts: ["lab-gpu", "build-node"].map((alias) => ({
    alias,
    hostname: alias,
    reachable: true,
    latencyMs: 18,
    inventoryUpdatedAt: new Date().toISOString(),
    error: null,
    processes: [],
    panes: [],
    sessions: [],
    agents: [],
    workloads: [],
    gpus:
      alias === "lab-gpu"
        ? [
            {
              index: 0,
              name: "NVIDIA A100",
              utilization: 12,
              memoryUsed: 10240,
              memoryTotal: 81920,
            },
            {
              index: 1,
              name: "NVIDIA A100",
              utilization: 0,
              memoryUsed: 200,
              memoryTotal: 81920,
            },
          ]
        : [],
  })),
};
snapshot.hosts.unshift({alias: "@local", hostname: "preview-pc", reachable: true, defaultCwd: "C:/projects", kind: "local", latencyMs: 0, error: null, processes: [], panes: [], sessions: [], agents: [], workloads: [], gpus: []});
snapshot.summary.hosts = 3; snapshot.summary.online = 3;
const maintenanceFixture = new Map();
const emailFixture = {
  enabled: false,
  configured: false,
  to: [],
  from: "",
  monitorUrl: "http://localhost:3000/",
  cooldownMinutes: 15,
  triggers: { humanRequests: true, agentCompletion: true, dlcAlerts: true },
  smtp: { host: "", port: 465, secure: true },
  smtpUser: "",
  hasPassword: false,
  credentialSource: null,
  lastSentAt: null,
  lastError: null,
};
const adapter = {
  async archive() {},
  async restore() {},
  async launch(task) {
    return { startedAt: Date.now(), id: task.id };
  },
  async poll(task) {
    return Date.now() - task.remote.startedAt < 3500
      ? { status: "running" }
      : {
          status: "completed",
          text: "这是隔离预览的模拟回复，没有调用任何远端 Agent。\n\n可以从项目进展开始，或者在资源页为新任务选择执行主机。",
        };
  },
};
const service = new WorkbenchService({
  store,
  snapshot: () => snapshot,
  adapters: { codex: adapter, claude: adapter, dsh: adapter },
});
await store.update((state) => {
  state.tasks.push({
    id: "preview-task",
    requestId: "preview-task",
    kind: "task",
    host: "build-node",
    cwd: "/workspace/scope",
    provider: "codex",
    prompt: "整理后端模块与接口",
    status: "completed",
    gpuIndices: [],
    gpuCount: 0,
    minMemoryMiB: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    remote: { sessionId: "preview-task-session" },
  });
});
service.start();
const sync = createIncrementalSnapshotStore({
  epoch: `scope-isolated-preview-${crypto.randomUUID()}`,
});
sync.publish(snapshot);
const clients = new Set();
const conversations = createConversationFixture(snapshot, () => {
  snapshot.generatedAt = new Date().toISOString();
  sync.publish(snapshot);
  for (const response of clients)
    response.write(
      `data: ${JSON.stringify({ type: "snapshot-invalidated", ...sync.info() })}\n\n`,
    );
});
sync.publish(snapshot);
const jsonResponse = (response, status, value) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
};
const readJsonBody = async (request) => {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 100000) throw new Error("too large");
  }
  return JSON.parse(text || "{}");
};
const routes = workbenchRoutes(service, { jsonResponse, readJsonBody });
const fixturePlugins = new PluginRegistry();
installPackage(fileURLToPath(new URL("../examples/plugins/hello", import.meta.url)), dir);
loadExternalPlugins(fixturePlugins, dir);
fixturePlugins.register(createAliyunDlcPlugin({ stateDirectory: dir, legacyHost: "",
  context: () => ({ readSshConfig: async () => "", sshAliasesForHostname: () => new Set(), getSnapshot: () => ({ hosts: [] }) }),
  notify() {}, onScanComplete: async () => {} }));
const fixturePluginRoutes = pluginRoutes(fixturePlugins);
fixturePlugins.start();
const archives = sessionArchiveService({
  manager: {
    sessionRecords: () => snapshot.appServer.sessions,
    async archiveSession(host, id) {
      const agent = snapshot.hosts
        .find((h) => h.alias === host)
        ?.agents.find((a) => a.rollout.id === id);
      if (agent?.status === "working") throw new Error("会话仍在执行");
    },
    async unarchiveSession() {
      return {};
    },
    async resumeSession() {},
  },
  getState: () => snapshot.management,
  persist: async () => {},
  findAgent: (host, id) =>
    snapshot.hosts
      .find((h) => h.alias === host)
      ?.agents.find((a) => a.rollout.id === id),
  getHost: (host) => snapshot.hosts.find((h) => h.alias === host),
  executable: () => "codex",
  connectionKey: async () => "active",
  restored() {},
  notify() {
    snapshot.generatedAt = new Date().toISOString();
    sync.publish(snapshot);
    for (const response of clients)
      response.write(
        `data: ${JSON.stringify({ type: "snapshot-invalidated", ...sync.info() })}\n\n`,
      );
  },
});
const archiveRoute = archiveRoutes(archives, { jsonResponse, readJsonBody });
const ui = await startProductionUiServer({ host: "127.0.0.1", port: 3002 });
const createdDirectories = new Map();
const preview = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.2:3001");
    if (await fixturePluginRoutes(request, response, new URL(url.pathname.replace(/^\/scope-api/, "") + url.search, url.origin))) return;
    if (url.pathname === "/scope-directory-api") {
      const cwd = url.searchParams.get("path") || "/workspace";
      const host = url.searchParams.get("host");
      const names = createdDirectories.get(`${host}:${cwd}`) || [
        "data",
        "experiments",
      ];
      return jsonResponse(response, 200, {
        host,
        cwd,
        parent:
          cwd === "/" ? null : cwd.split("/").slice(0, -1).join("/") || "/",
        directories: names.map((name) => ({
          name,
          path: `${cwd.replace(/\/$/, "")}/${name}`,
        })),
        truncated: false,
      });
    }
    if (url.pathname.startsWith("/scope-api/")) {
      url.pathname = url.pathname.slice("/scope-api".length);
      if (
        url.pathname === "/api/remote/directories" &&
        request.method === "POST"
      ) {
        const { host, parent, name } = await readJsonBody(request);
        const key = `${host}:${parent}`;
        const names = createdDirectories.get(key) || ["data", "experiments"];
        if (names.includes(name))
          return jsonResponse(response, 400, { error: "同名文件或目录已存在" });
        createdDirectories.set(key, [...names, name]);
        return jsonResponse(response, 200, {
          host,
          cwd: `${parent.replace(/\/$/, "")}/${name}`,
        });
      }
      if (url.pathname === "/api/session/attachment" && request.method === "POST") {
        let size = 0;
        for await (const chunk of request) size += chunk.length;
        const name = (url.searchParams.get("name") || "attachment").trim() || "attachment";
        const mimeType = (url.searchParams.get("mimeType") || "application/octet-stream").trim();
        return jsonResponse(response, 201, {
          ok: true,
          attachment: {
            token: crypto.randomUUID(),
            name,
            mimeType,
            kind: mimeType.startsWith("image/") ? "image" : "file",
            size,
            sha256: "preview",
            remotePath: `/workspace/.codex/scope-attachments/${name}`,
          },
        });
      }
      if (nativeConversationFixture(request, response, url, jsonResponse)) return;
      if (await archiveRoute(request, response, url)) return;
      if (await routes(request, response, url)) return;
      if (
        await conversations(request, response, url, jsonResponse, readJsonBody)
      )
        return;
      if (url.pathname === "/api/events") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write('data: {"type":"ready"}\n\n');
        clients.add(response);
        response.on("close", () => clients.delete(response));
        return;
      }
      if (url.pathname === "/api/sync")
        return jsonResponse(
          response,
          200,
          sync.read({
            clientEpoch: url.searchParams.get("epoch"),
            since: url.searchParams.get("since"),
          }),
        );
      if (url.pathname === "/api/history/cache")
        return jsonResponse(response, 200, {
          cached: true,
          scope: "preview",
          sessions: [],
          hosts: [],
          scannedAt: new Date().toISOString(),
        });
      if (url.pathname === "/api/agents/maintenance") {
        if (request.method === "POST") {
          const body = await readJsonBody(request);
          const job = {id: crypto.randomUUID(), action: body.action, status: "completed", info: {installed: body.action === "check" ? null : "fixture 1.0.0", latest: "1.0.0", supported: body.provider !== "antigravity"}, log: "Isolated fixture: no installation executed"};
          maintenanceFixture.set(body.host + ":" + body.provider, job);
          return jsonResponse(response, 202, {job});
        }
        return jsonResponse(response, 200, {agents: ["codex", "claude", "antigravity", "dsh"].map(provider => ({provider, job: maintenanceFixture.get(url.searchParams.get("host") + ":" + provider) || null}))});
      }
      if (url.pathname === "/api/email/settings") {
        if (request.method === "POST") {
          const body = await readJsonBody(request);
          Object.assign(emailFixture, {
            enabled: Boolean(body.enabled),
            configured: Boolean(body.enabled && body.smtp?.host && body.to),
            to: Array.isArray(body.to) ? body.to : String(body.to || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean),
            from: body.from || "",
            monitorUrl: body.monitorUrl || "http://localhost:3000/",
            cooldownMinutes: Number(body.cooldownMinutes ?? 15),
            triggers: body.triggers || emailFixture.triggers,
            smtp: body.smtp || emailFixture.smtp,
            smtpUser: body.smtpUser ?? emailFixture.smtpUser,
            hasPassword: body.clearCredentials ? false : Boolean(body.smtpPass || emailFixture.hasPassword),
          });
          return jsonResponse(response, 200, { ok: true, settings: emailFixture });
        }
        return jsonResponse(response, 200, emailFixture);
      }
      if (url.pathname === "/api/email/verify" || url.pathname === "/api/email/test") {
        return jsonResponse(response, 200, { ok: true, messageId: "fixture-mail-1", settings: emailFixture });
      }
      if (url.pathname === "/api/remote-bootstrap") {
        const host = request.method === "POST" ? (await readJsonBody(request)).host : url.searchParams.get("host") || "";
        return jsonResponse(response, 200, {
          host,
          checkedAt: new Date().toISOString(),
          lastAction: "inspect",
          report: {
            user: "researcher",
            isRoot: false,
            home: "/home/researcher",
            python3: "Python 3.11.8",
            node: "v22.14.0",
            npm: true,
            tmux: true,
            gpuCount: host === "lab-gpu" ? 2 : 0,
            localBinInPath: true,
            systemdUserAvailable: true,
            clis: {
              codex: { installed: true, executable: "/home/researcher/.local/bin/codex", version: "0.158.0" },
              claude: { installed: true, executable: "/home/researcher/.local/bin/claude", version: "2.1.325" },
              antigravity: { installed: false, executable: null, version: null },
              dsh: { installed: false, executable: null, version: null },
            },
            scopeNotify: { installed: false, executable: null, daemonActive: false, systemdServiceActive: false, relayReachable: false, queued: 0, lastDeliveredAt: null, codexMcp: false, claudeMcp: false },
          },
          tunnel: { enabled: false, remotePort: 4922, status: "disabled", connectedAt: null, lastError: null },
          relay: { relayListening: false, relayPort: 4822, relayTokenReady: false },
        });
      }
      if (url.pathname === "/api/models")
        return jsonResponse(response, 200, {
          models: [
            {
              id: "o3",
              model: "o3",
              displayName: "o3",
              supportedReasoningEfforts: ["medium", "high", "xhigh"],
              defaultReasoningEffort: "high",
            },
            {
              id: "gpt-5-codex",
              model: "gpt-5-codex",
              displayName: "GPT-5 Codex",
              supportedReasoningEfforts: ["medium", "high", "xhigh"],
              defaultReasoningEffort: "high",
            },
          ],
        });
      return jsonResponse(response, 200, {});
    }
    const upstream = await fetch(`http://127.0.0.1:3002${request.url}`);
    response.writeHead(
      upstream.status,
      Object.fromEntries(
        [...upstream.headers].filter(
          ([key]) => !["content-encoding", "content-length"].includes(key),
        ),
      ),
    );
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    jsonResponse(response, 500, { error: error.message });
  }
});
preview.listen(3001, "127.0.0.2", () =>
  console.log(
    "Isolated preview: http://127.0.0.2:3001 (synthetic data, no SSH; temporary state: " +
      dir +
      ")",
  ),
);
function stop() {
  fixturePlugins.stop();
  service.stop();
  preview.closeAllConnections();
  preview.close();
  ui.closeAllConnections();
  ui.close(() => process.exit(0));
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
