import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EmailNotifier,
  dlcAlertEmailEvent,
  humanRequestEmailEvent,
} from "../bridge/email-notifier.mjs";

test("email notifier primes existing events, deduplicates, and sends safely", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "scope-email-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "email-notifications.json");
  const statePath = path.join(directory, "email-notification-state.json");
  await writeFile(
    configPath,
    `\uFEFF${JSON.stringify({
      enabled: true,
      to: ["operator@example.com"],
      from: "SCOPE <operator@example.com>",
      monitorUrl: "http://localhost:3000/",
      cooldownMinutes: 15,
      smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    })}`,
    "utf8",
  );

  const deliveries = [];
  let transportOptions = null;
  const notifier = await new EmailNotifier({
    configPath,
    statePath,
    environment: {
      SCOPE_EMAIL_SMTP_USER: "operator@example.com",
      SCOPE_EMAIL_SMTP_PASS: "app-password-secret",
    },
    transportFactory(options) {
      transportOptions = options;
      return {
        verify: async () => true,
        sendMail: async (message) => {
          deliveries.push(message);
          return { messageId: "mail-1" };
        },
      };
    },
    now: () => Date.parse("2026-07-24T06:00:00Z"),
  }).initialize();

  assert.equal(notifier.publicState().configured, true, notifier.publicState().lastError);
  assert.equal(transportOptions.secure, true);
  assert.equal(transportOptions.disableFileAccess, true);
  assert.equal(transportOptions.disableUrlAccess, true);

  const existing = {
    key: "existing",
    severity: "critical",
    title: "Existing alert",
    summary: "Do not send historical backlog",
    details: [],
  };
  await notifier.prime([existing]);
  assert.deepEqual(await notifier.notify(existing), {
    sent: false,
    reason: "duplicate",
  });
  assert.equal(deliveries.length, 0);

  const changed = { ...existing, summary: "The alert changed" };
  const result = await notifier.notify(changed);
  assert.equal(result.sent, true);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].to[0], "operator@example.com");
  assert.match(deliveries[0].subject, /^\[SCOPE\]\[CRITICAL\]/);
  assert.doesNotMatch(
    JSON.stringify(deliveries[0]),
    /app-password-secret/,
  );
  assert.deepEqual(await notifier.notify(changed), {
    sent: false,
    reason: "duplicate",
  });

  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(persisted.lastSentAt, "2026-07-24T06:00:00.000Z");
});

test("notification event builders omit command output and retain ownership", () => {
  const request = humanRequestEmailEvent({
    key: "request-key",
    kind: "command-approval",
    title: "命令执行审批",
    host: "gpu-box",
    threadId: "session-123",
    cwd: "/workspace/experiment",
    reason: "submit DLC",
    command: "secret command output",
    receivedAt: "2026-07-24T06:00:00Z",
  });
  assert.match(request.details.join("\n"), /session-123/);
  assert.doesNotMatch(request.details.join("\n"), /secret command output/);

  const alert = dlcAlertEmailEvent(
    {
      host: "gpu-box",
      sessionId: "session-123",
      sessionTheme: "temporal ablation",
      cwd: "/workspace/experiment",
      total: 8,
      failed: 6,
      queued: 2,
      running: 0,
    },
    "2026-07-24T06:05:00Z",
  );
  assert.match(alert.summary, /6 个失败或终止/);
  assert.match(alert.details.join("\n"), /\/workspace\/experiment/);
});

test(
  "Windows DPAPI credential files can initialize the SMTP transport",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "scope-email-dpapi-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const credentialPath = path.join(directory, "credential.xml");
    const escapedPath = credentialPath.replaceAll("'", "''");
    const completed = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "$ErrorActionPreference='Stop'",
          "$secure=[System.Security.SecureString]::new(); 'dummy-app-password'.ToCharArray() | ForEach-Object { $secure.AppendChar($_) }",
          "$credential=[System.Management.Automation.PSCredential]::new('sender@example.com',$secure)",
          `$credential|Export-Clixml -LiteralPath '${escapedPath}'`,
        ].join("; "),
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(completed.status, 0, completed.stderr);

    const configPath = path.join(directory, "email-notifications.json");
    const statePath = path.join(directory, "email-notification-state.json");
    await writeFile(
      configPath,
      JSON.stringify({
        enabled: true,
        to: ["recipient@example.com"],
        smtp: {
          host: "smtp.example.com",
          port: 465,
          credentialFile: "credential.xml",
        },
      }),
      "utf8",
    );
    let options = null;
    const notifier = await new EmailNotifier({
      configPath,
      statePath,
      environment: {},
      transportFactory(transportOptions) {
        options = transportOptions;
        return { verify: async () => true, sendMail: async () => ({}) };
      },
    }).initialize();

    assert.equal(notifier.publicState().configured, true, notifier.publicState().lastError);
    assert.equal(notifier.publicState().credentialSource, "windows-dpapi");
    assert.deepEqual(options.auth, {
      user: "sender@example.com",
      pass: "dummy-app-password",
    });
  },
);

import { emailRoutes } from "../bridge/routes/email.mjs";
import { jsonResponse, readJsonBody } from "../bridge/http.mjs";

test("email notifier supports cross-platform saveConfig, hot-reload, trigger filters, and sendTest", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "scope-email-save-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "email-notifications.json");
  const statePath = path.join(directory, "email-notification-state.json");

  const deliveries = [];
  let verifyCalls = 0;
  const notifier = new EmailNotifier({
    configPath,
    statePath,
    environment: {},
    transportFactory(options) {
      return {
        verify: async () => {
          verifyCalls++;
          return Boolean(options.auth?.user);
        },
        sendMail: async (message) => {
          deliveries.push(message);
          return { messageId: `mail-${deliveries.length}` };
        },
      };
    },
  });
  await notifier.initialize();
  assert.equal(notifier.configView().enabled, false);
  assert.equal(notifier.configView().hasPassword, false);

  const saved = await notifier.saveConfig({
    enabled: true,
    smtp: { host: "smtp.example.org", port: 587, secure: false },
    smtpUser: "alerts@example.org",
    smtpPass: "super-secret-token",
    to: "user1@example.com, user2@example.com",
    from: "SCOPE <alerts@example.org>",
    cooldownMinutes: 5,
    monitorUrl: "http://localhost:3000/",
    triggers: { humanRequests: false, agentCompletion: true, dlcAlerts: true },
  });

  assert.equal(saved.enabled, true);
  assert.equal(saved.configured, true);
  assert.equal(saved.smtpUser, "alerts@example.org");
  assert.equal(saved.hasPassword, true);
  assert.equal(saved.credentialSource, "local-secret");
  assert.deepEqual(saved.to, ["user1@example.com", "user2@example.com"]);
  assert.doesNotMatch(JSON.stringify(saved), /super-secret-token/);

  const rawConfig = await readFile(configPath, "utf8");
  assert.doesNotMatch(rawConfig, /super-secret-token/);

  // Disabled humanRequests trigger must suppress human-request notifications
  const skipped = await notifier.notify({
    key: "human-request:req-1",
    severity: "approval",
    title: "Approval needed",
    summary: "Waiting",
  });
  assert.deepEqual(skipped, { sent: false, reason: "trigger-disabled" });

  const testResult = await notifier.sendTest();
  assert.equal(testResult.sent, true);
  assert.equal(deliveries.length, 1);
  assert.match(deliveries[0].subject, /\[SCOPE\]\[TEST\]/);

  // Exercise HTTP routes
  const handler = emailRoutes({
    emailNotifier: notifier,
    readJsonBody,
    jsonResponse,
    onChanged() {},
  });
  let statusCode = 0;
  let payload = null;
  const mockRes = {
    writeHead(code) { statusCode = code; },
    end(body) { payload = JSON.parse(body); },
  };
  await handler({ method: "GET" }, mockRes, new URL("http://127.0.0.1/api/email/settings"));
  assert.equal(statusCode, 200);
  assert.equal(payload.smtpUser, "alerts@example.org");
  await handler({ method: "POST" }, mockRes, new URL("http://127.0.0.1/api/email/verify"));
  assert.equal(statusCode, 200);
  assert.equal(verifyCalls, 1);
});
