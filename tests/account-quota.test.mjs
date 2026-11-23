import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  createAccountQuotaService,
  PROVIDER_AUTH_PROBE_PY,
} from "../bridge/account-quotas.mjs";
import { AppServerManager } from "../bridge/app-server-client.mjs";
import { pythonExecutable } from "../bridge/local/python-probe.mjs";
import {
  formatQuotaWindowLabel,
  normalizeAccountQuota,
  quotaHeadline,
} from "../lib/account-quota.js";
import { LOCAL_HOST } from "../lib/execution-host.js";

class QuotaMockChild extends EventEmitter {
  constructor(handler) {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
    this.messages = [];
    this.buffer = "";
    this.handler = handler;
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        this.messages.push(message);
        this.handler?.(message, this);
      }
    });
  }

  send(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill() {
    this.killed = true;
    this.emit("exit", 0, null);
  }
}

function nextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

test("normalizeAccountQuota supports camelCase and snake_case, dual windows, expired resets, and credits", () => {
  const nowMs = Date.parse("2026-11-18T09:00:00Z");
  const futureReset = Math.floor(nowMs / 1000) + 3600;
  const pastReset = Math.floor(nowMs / 1000) - 60;

  const camel = normalizeAccountQuota(
    {
      rateLimits: {
        planType: "pro",
        primary: {
          usedPercent: 38.4,
          windowDurationMins: 300,
          resetsAt: futureReset,
        },
        secondary: {
          usedPercent: 72,
          windowDurationMins: 10080,
          resetsAt: futureReset + 86400,
        },
        credits: { hasCredits: false, unlimited: false, balance: "0" },
      },
    },
    nowMs,
  );
  assert.deepEqual(camel, {
    planType: "pro",
    primary: {
      usedPercent: 38,
      remainingPercent: 62,
      windowMinutes: 300,
      resetsAt: futureReset,
      expired: false,
    },
    secondary: {
      usedPercent: 72,
      remainingPercent: 28,
      windowMinutes: 10080,
      resetsAt: futureReset + 86400,
      expired: false,
    },
    credits: null,
  });
  // Tightest non-expired window wins headline (28% remaining vs 62%)
  assert.equal(quotaHeadline(camel)?.remainingPercent, 28);
  assert.equal(formatQuotaWindowLabel(300), "5h 额度");
  assert.equal(formatQuotaWindowLabel(10080), "周额度");
  assert.equal(formatQuotaWindowLabel(10080, "en-US"), "7d");

  const snakeExpired = normalizeAccountQuota(
    {
      plan_type: "plus",
      primary: {
        used_percent: 95,
        window_minutes: 300,
        resets_at: pastReset,
      },
      credits: { has_credits: true, unlimited: false, balance: "12.50" },
    },
    nowMs,
  );
  assert.equal(snakeExpired?.planType, "plus");
  assert.equal(snakeExpired?.primary?.expired, true);
  assert.equal(snakeExpired?.primary?.remainingPercent, 100);
  assert.equal(snakeExpired?.credits?.balance, "12.50");
  assert.equal(normalizeAccountQuota({ planType: "free" }), null);
});

test("AppServerManager reads and streams rate limits into connections and sessions", async () => {
  let child;
  const resetAt = Math.floor(Date.now() / 1000) + 7200;
  const manager = new AppServerManager({
    spawnConnection() {
      child = new QuotaMockChild((message, mock) => {
        if (message.method === "initialize") {
          mock.send({
            id: message.id,
            result: { userAgent: "codex-cli/0.141.0", codexHome: "/home/u/.codex" },
          });
        } else if (message.method === "thread/resume") {
          mock.send({
            id: message.id,
            result: {
              thread: { id: message.params.threadId, path: "/p/t.jsonl", cwd: "/w", status: { type: "idle" } },
              model: "model-default",
              cwd: "/w",
            },
          });
        } else if (message.method === "account/rateLimits/read") {
          mock.send({
            id: message.id,
            result: {
              rateLimits: {
                planType: "pro",
                primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: resetAt },
              },
            },
          });
        }
      });
      return child;
    },
    requestTimeoutMs: 1000,
  });

  try {
    await manager.resumeSession({ host: "gpu-a", sessionId: "s-1", cwd: "/w" });
    const quota = await manager.getRateLimits("gpu-a");
    assert.equal(quota?.primary?.remainingPercent, 75);
    assert.equal(manager.publicState().connections[0].rateLimits?.primary?.remainingPercent, 75);
    assert.equal(manager.sessionRecords()[0].rateLimits?.primary?.remainingPercent, 75);

    child.send({
      method: "account/rateLimits/updated",
      params: {
        rateLimits: {
          planType: "pro",
          primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: resetAt },
        },
      },
    });
    await nextTurn();
    assert.equal(manager.publicState().connections[0].rateLimits?.primary?.remainingPercent, 58);
    assert.equal(manager.sessionRecords()[0].rateLimits?.primary?.remainingPercent, 58);
  } finally {
    manager.close();
  }
});

test("createAccountQuotaService reads live cache, forces refresh, and probes local host when idle", async () => {
  const futureReset = Math.floor(Date.now() / 1000) + 3600;
  let remoteReadCount = 0;
  const fakeManager = {
    publicState: () => ({
      connections: [
        {
          host: "gpu-remote",
          connectionKey: "active",
          status: "connected",
          rateLimits: {
            planType: "pro",
            primary: { usedPercent: 10, windowMinutes: 300, resetsAt: futureReset, remainingPercent: 90, expired: false },
            secondary: null,
            credits: null,
          },
        },
      ],
    }),
    getRateLimits: async () => {
      remoteReadCount += 1;
      return {
        planType: "pro",
        primary: { usedPercent: 35, windowMinutes: 300, resetsAt: futureReset, remainingPercent: 65, expired: false },
        secondary: null,
        credits: null,
      };
    },
  };

  let probeCount = 0;
  const service = createAccountQuotaService({
    appServerManager: fakeManager,
    localCodex: {
      host: () => ({ agents: [] }),
      probe() {
        probeCount += 1;
        return new QuotaMockChild((message, mock) => {
          if (message.method === "initialize") {
            mock.send({ id: message.id, result: { userAgent: "codex-local" } });
          } else if (message.method === "account/read") {
            mock.send({ id: message.id, result: { account: { email: "me@example.com", planType: "plus" } } });
          } else if (message.method === "account/rateLimits/read") {
            mock.send({
              id: message.id,
              result: {
                rateLimits: {
                  planType: "plus",
                  primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: futureReset },
                },
              },
            });
          }
        });
      },
    },
    listAuthProfiles: async () => ({
      defaultAuthPresent: true,
      currentAccount: { email: "remote@example.com", planType: "pro" },
      profiles: [],
    }),
    hostCodexExecutable: () => "codex",
    hostRuntimeConfig: () => ({}),
    wrapBootstrapAppServer: (cmd) => cmd,
    shellQuote: (s) => `'${s}'`,
    mapLimit: async (items, _limit, fn) => Promise.all(items.map(fn)),
    sshTimeoutMs: 5000,
    getSnapshot: () => ({ hosts: [{ alias: "gpu-remote" }, { alias: LOCAL_HOST }] }),
  });

  const cachedRemote = await service.readSingleQuota("gpu-remote");
  assert.equal(cachedRemote.source, "app-server");
  assert.equal(cachedRemote.quota?.primary?.remainingPercent, 90);
  assert.equal(remoteReadCount, 0);

  const forcedRemote = await service.readSingleQuota("gpu-remote", { force: true });
  assert.equal(forcedRemote.quota?.primary?.remainingPercent, 65);
  assert.equal(remoteReadCount, 1);

  const localAll = await service.readHostQuotas(LOCAL_HOST);
  assert.equal(localAll.local, true);
  assert.equal(localAll.currentQuota?.primary?.remainingPercent, 85);
  assert.equal(localAll.currentAccount?.email, "me@example.com");
  assert.equal(probeCount, 1);
});

test("readProviderAuthStatuses probes Claude & Antigravity state without exposing tokens", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "scope-provider-auth-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const agyDir = path.join(home, ".gemini", "antigravity-cli");
  await mkdir(agyDir, { recursive: true });
  const fakeToken = "oauth-credential-never-export-99887766";
  await writeFile(
    path.join(agyDir, "antigravity-oauth-token"),
    JSON.stringify({
      token: fakeToken,
      auth_method: "Google OAuth",
      id_token_email: "dev@example.com",
    }),
  );
  await writeFile(
    path.join(agyDir, "settings.json"),
    JSON.stringify({ model: "gemini-default-model", useG1Credits: true }),
  );
  await writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({
      oauthAccount: {
        emailAddress: "claude-dev@example.com",
        organizationName: "Example Org",
      },
    }),
  );

  let sshCalls = 0;
  let claudeExe = "nonexistent-test-claude";
  const service = createAccountQuotaService({
    appServerManager: { publicState: () => ({ connections: [] }) },
    localCodex: { host: () => ({ agents: [] }) },
    listAuthProfiles: async () => ({ profiles: [] }),
    hostCodexExecutable: () => "codex",
    hostRuntimeConfig: () => ({}),
    wrapBootstrapAppServer: (cmd) => cmd,
    shellQuote: (s) => `'${s}'`,
    mapLimit: async (items, _limit, fn) => Promise.all(items.map(fn)),
    sshTimeoutMs: 5000,
    getSnapshot: () => ({ hosts: [{ alias: LOCAL_HOST }, { alias: "gpu-remote" }] }),
    providerSettings: (p) => ({ executable: p === "claude" ? claudeExe : `nonexistent-test-${p}` }),
    localPython: async (script, args) => {
      const res = spawnSync(pythonExecutable(), ["-", ...args], {
        input: script,
        encoding: "utf8",
        env: { ...process.env, HOME: home, USERPROFILE: home, PYTHONIOENCODING: "utf-8" },
      });
      return { code: res.status ?? 1, stdout: res.stdout || "", stderr: res.stderr || "" };
    },
    runSshCommand: async (_host, _cmd, script) => {
      sshCalls += 1;
      assert.equal(script, PROVIDER_AUTH_PROBE_PY);
      return {
        code: 0,
        stdout: JSON.stringify({
          claude: { installed: true, executable: "/bin/claude", loggedIn: true, email: "remote@example.com", authMethod: "claude.ai", subscriptionType: "max", planTier: "max_20x", orgName: "", loginExpiresAt: "", error: null },
          antigravity: { installed: true, executable: "/bin/agy", loggedIn: true, email: "agy@example.com", authMethod: "Google OAuth", defaultModel: "gemini-default", useG1Credits: false, error: null },
        }),
        stderr: "",
      };
    },
  });

  const localRes = await service.readProviderAuthStatuses(LOCAL_HOST);
  assert.equal(localRes.local, true);
  assert.equal(localRes.antigravity?.loggedIn, true);
  assert.equal(localRes.antigravity?.email, "dev@example.com");
  assert.equal(localRes.antigravity?.useG1Credits, true);
  assert.equal(localRes.claude?.loggedIn, true);
  assert.equal(localRes.claude?.email, "claude-dev@example.com");
  assert.equal(JSON.stringify(localRes).includes(fakeToken), false);

  const prettyPayload = JSON.stringify(
    {
      loggedIn: true,
      email: "pretty@example.com",
      authMethod: "claude.ai",
      subscriptionType: "max",
      planTier: "max_20x",
      orgName: "Example Lab",
    },
    null,
    2,
  );
  const pyHelper = path.join(home, "emit_claude_status.py");
  await writeFile(
    pyHelper,
    `print("proxy initialized")\nprint(${JSON.stringify(prettyPayload)})\n`,
  );
  if (process.platform === "win32") {
    claudeExe = path.join(home, "fake-claude.cmd");
    await writeFile(claudeExe, `@echo off\r\n"${pythonExecutable()}" "${pyHelper}"\r\n`);
  } else {
    claudeExe = path.join(home, "fake-claude");
    await writeFile(claudeExe, `#!/bin/sh\n"${pythonExecutable()}" "${pyHelper}"\n`);
    await chmod(claudeExe, 0o755);
  }
  const prettyRes = await service.readProviderAuthStatuses(LOCAL_HOST, { force: true });
  assert.equal(prettyRes.claude?.installed, true);
  assert.equal(prettyRes.claude?.loggedIn, true);
  assert.equal(prettyRes.claude?.email, "pretty@example.com");
  assert.equal(prettyRes.claude?.subscriptionType, "max");
  assert.equal(prettyRes.claude?.planTier, "max_20x");
  assert.equal(prettyRes.claude?.orgName, "Example Lab");
  assert.equal(prettyRes.claude?.error, null);

  const remoteFirst = await service.readProviderAuthStatuses("gpu-remote");
  const remoteCached = await service.readProviderAuthStatuses("gpu-remote");
  assert.equal(remoteFirst.claude?.planTier, "max_20x");
  assert.equal(remoteCached.antigravity?.email, "agy@example.com");
  assert.equal(sshCalls, 1);

  await service.readProviderAuthStatuses("gpu-remote", { force: true });
  assert.equal(sshCalls, 2);
});

test("readProviderAuthStatuses queries Claude OAuth usage, AGY /usage groups, and honors host preLaunchCommand", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "scope-provider-quota-"));
  t.after(() => rm(home, { recursive: true, force: true }));

  const claudeDir = path.join(home, ".claude");
  const agyDir = path.join(home, ".gemini", "antigravity-cli");
  await mkdir(claudeDir, { recursive: true });
  await mkdir(agyDir, { recursive: true });

  const claudeSecret = "claude-oauth-token-never-export-55443322";
  await writeFile(
    path.join(claudeDir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: claudeSecret,
        expiresAt: Date.now() + 3_600_000,
        subscriptionType: "max",
        rateLimitTier: "default_claude_max_20x",
      },
    }),
  );
  await writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({
      oauthAccount: {
        emailAddress: "claude-quota@example.com",
        organizationName: "Example Org",
      },
    }),
  );
  await writeFile(
    path.join(agyDir, "antigravity-oauth-token"),
    JSON.stringify({
      token: "agy-token-never-export-11223344",
      auth_method: "consumer",
      id_token_email: "agy-quota@example.com",
    }),
  );
  await writeFile(
    path.join(agyDir, "settings.json"),
    JSON.stringify({ model: "model-default", useG1Credits: true }),
  );

  const fiveHourReset = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const sevenDayReset = new Date(Date.now() + 5 * 86400 * 1000).toISOString();
  let seenAuthHeader = "";
  let seenBetaHeader = "";
  const server = http.createServer((req, res) => {
    seenAuthHeader = String(req.headers.authorization || "");
    seenBetaHeader = String(req.headers["anthropic-beta"] || "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        five_hour: { utilization: 12.4, resets_at: fiveHourReset },
        seven_day: { utilization: 5.0, resets_at: sevenDayReset },
        extra_usage: { is_enabled: false },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = server.address().port;

  const agyUsagePayload = JSON.stringify({
    conversation_id: "",
    status: "SUCCESS",
    num_turns: 0,
    command: {
      name: "usage",
      data: {
        groups: [
          {
            name: "Gemini Models",
            description: "Primary Gemini group",
            buckets: [
              { id: "gemini-weekly", window: "weekly", remaining_fraction: 0.84, reset_time: sevenDayReset },
              { id: "gemini-5h", window: "5h", remaining_fraction: 0.96, reset_time: fiveHourReset },
            ],
          },
          {
            name: "Claude and GPT models",
            description: "Third-party models",
            buckets: [
              { id: "3p-weekly", window: "weekly", remaining_fraction: 0.91, reset_time: sevenDayReset },
              { id: "3p-5h", window: "5h", remaining_fraction: 1.0, reset_time: fiveHourReset },
            ],
          },
        ],
      },
    },
  });
  const agyHelper = path.join(home, "emit_agy_usage.py");
  await writeFile(agyHelper, `print(${JSON.stringify(agyUsagePayload)})\n`);
  let agyExe;
  if (process.platform === "win32") {
    agyExe = path.join(home, "fake-agy.cmd");
    await writeFile(agyExe, `@echo off\r\n"${pythonExecutable()}" "${agyHelper}"\r\n`);
  } else {
    agyExe = path.join(home, "fake-agy");
    await writeFile(agyExe, `#!/bin/sh\n"${pythonExecutable()}" "${agyHelper}"\n`);
    await chmod(agyExe, 0o755);
  }

  const remoteCmds = [];
  const service = createAccountQuotaService({
    appServerManager: { publicState: () => ({ connections: [] }) },
    localCodex: { host: () => ({ agents: [] }) },
    listAuthProfiles: async () => ({ profiles: [] }),
    hostCodexExecutable: () => "codex",
    hostRuntimeConfig: (alias) => (alias === "gpu-proxy" ? { preLaunchCommand: "source ~/.proxy_env" } : {}),
    wrapBootstrapAppServer: (cmd, pre) => `WRAPPED(${pre})::${cmd}`,
    shellQuote: (s) => `'${s}'`,
    mapLimit: async (items, _limit, fn) => Promise.all(items.map(fn)),
    sshTimeoutMs: 5000,
    getSnapshot: () => ({ hosts: [{ alias: LOCAL_HOST }, { alias: "gpu-proxy" }] }),
    providerSettings: (p) => ({
      executable: p === "antigravity" ? agyExe : "nonexistent-test-claude",
      preLaunchCommand: "",
    }),
    localPython: (script, args) =>
      new Promise((resolve) => {
        const child = spawn(pythonExecutable(), ["-", ...args], {
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            PYTHONIOENCODING: "utf-8",
            NO_PROXY: "127.0.0.1,localhost",
            no_proxy: "127.0.0.1,localhost",
            HTTP_PROXY: "",
            HTTPS_PROXY: "",
            http_proxy: "",
            https_proxy: "",
            SCOPE_TEST_CLAUDE_USAGE_URL: `http://127.0.0.1:${port}/api/oauth/usage`,
          },
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => {
          stdout += d.toString("utf8");
        });
        child.stderr.on("data", (d) => {
          stderr += d.toString("utf8");
        });
        child.on("close", (code) => {
          resolve({ code: code ?? 1, stdout, stderr });
        });
        child.stdin.end(script);
      }),
    runSshCommand: async (_host, cmd) => {
      remoteCmds.push(cmd);
      return {
        code: 0,
        stdout: JSON.stringify({
          claude: { installed: true, executable: "/bin/claude", loggedIn: true, email: "r@example.com", authMethod: "claude.ai", subscriptionType: "max", planTier: "max_20x", orgName: "", loginExpiresAt: "", quota: null, quotaError: null, error: null },
          antigravity: { installed: true, executable: "/bin/agy", loggedIn: true, email: "a@example.com", authMethod: "consumer", defaultModel: "", useG1Credits: false, quota: null, quotaError: null, error: null },
        }),
        stderr: "",
      };
    },
  });

  const local = await service.readProviderAuthStatuses(LOCAL_HOST, { force: true });
  assert.equal(seenAuthHeader, `Bearer ${claudeSecret}`);
  assert.equal(seenBetaHeader, "oauth-2025-04-20");
  assert.equal(local.claude?.quota?.primary?.usedPercent, 12);
  assert.equal(local.claude?.quota?.primary?.remainingPercent, 88);
  assert.equal(local.claude?.quota?.primary?.windowMinutes, 300);
  assert.equal(local.claude?.quota?.secondary?.remainingPercent, 95);
  assert.equal(local.claude?.quota?.secondary?.windowMinutes, 10080);
  assert.equal(local.claude?.quotaError, null);

  assert.equal(local.antigravity?.quota?.primary?.remainingPercent, 96);
  assert.equal(local.antigravity?.quota?.secondary?.remainingPercent, 84);
  assert.equal(local.antigravity?.quota?.groups?.length, 2);
  assert.equal(local.antigravity?.quota?.groups?.[0]?.name, "Gemini Models");
  assert.equal(local.antigravity?.quota?.groups?.[1]?.name, "Claude and GPT models");
  assert.equal(local.antigravity?.quota?.groups?.[1]?.secondary?.remainingPercent, 91);
  assert.equal(quotaHeadline(local.antigravity?.quota)?.remainingPercent, 84);
  assert.equal(local.antigravity?.quotaError, null);
  assert.equal(JSON.stringify(local).includes(claudeSecret), false);
  assert.equal(JSON.stringify(local).includes("agy-token-never-export"), false);

  await service.readProviderAuthStatuses("gpu-proxy", { force: true });
  assert.equal(remoteCmds.length, 1);
  assert.match(remoteCmds[0], /WRAPPED\(\{ source ~\/\.proxy_env; \} >&2 \|\| exit \$\?\)/);
});
