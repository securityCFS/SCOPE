import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  AuthProfileManager,
  normalizeProfileName,
  publicAccount,
} from "../bridge/auth-profile-manager.mjs";

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new PassThrough();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (line) => this.handle(JSON.parse(line)));
    this.killed = false;
  }

  handle(message) {
    if (!message.id) return;
    let result = {};
    if (message.method === "initialize") result = { userAgent: "codex-test" };
    if (message.method === "account/login/start") {
      result = {
        type: "chatgptDeviceCode",
        loginId: "login-1",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/activate",
      };
    }
    if (message.method === "account/read") {
      result = {
        account: { type: "chatgpt", email: "dev@example.com", planType: "pro" },
        requiresOpenaiAuth: true,
      };
    }
    queueMicrotask(() =>
      this.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`),
    );
  }

  kill() {
    this.killed = true;
  }
}

test("profile names are stable and path-safe", () => {
  assert.deepEqual(normalizeProfileName("Lab Account 2"), {
    name: "Lab Account 2",
    slug: "Lab-Account-2",
  });
  assert.throws(() => normalizeProfileName("../secret"), /名称/);
});

test("account projection never includes tokens", () => {
  assert.deepEqual(
    publicAccount({
      account: {
        type: "chatgpt",
        email: "dev@example.com",
        planType: "pro",
        accessToken: "never-return-this",
      },
    }),
    { type: "chatgpt", email: "dev@example.com", planType: "pro" },
  );
});

test("device auth returns structured code and finalizes remotely", async () => {
  const prepared = [];
  const finalized = [];
  const child = new FakeChild();
  const manager = new AuthProfileManager({
    spawnConnection: () => child,
    prepareProfile: async (host, profile) => prepared.push({ host, profile }),
    finalizeProfile: async (host, profile, account) =>
      finalized.push({ host, profile, account }),
  });

  const job = await manager.start({
    host: "gpu-box",
    profileName: "Paper account",
  });
  assert.equal(job.status, "waiting");
  assert.equal(job.userCode, "ABCD-EFGH");
  assert.equal(job.verificationUrl, "https://auth.openai.com/activate");
  assert.equal(prepared[0].profile.slug, "Paper-account");

  child.stdout.write(
    `${JSON.stringify({
      method: "account/login/completed",
      params: { loginId: "login-1", success: true },
    })}\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  const completed = manager.get(job.id);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.account, {
    type: "chatgpt",
    email: "dev@example.com",
    planType: "pro",
  });
  assert.equal(finalized.length, 1);
});

test("cancels only the pending login for one host profile", async () => {
  const cleaned = [];
  const manager = new AuthProfileManager({
    spawnConnection: () => new FakeChild(),
    prepareProfile: async () => {},
    finalizeProfile: async () => {},
    cancelProfile: async (host, profile) => cleaned.push(`${host}:${profile.slug}`),
  });
  const target = await manager.start({
    host: "gpu-a",
    profileName: "Paper account",
  });
  const other = await manager.start({
    host: "gpu-b",
    profileName: "Paper account",
  });

  assert.equal(await manager.cancelForProfile("gpu-a", "Paper-account"), 1);
  assert.equal(manager.get(target.id).status, "cancelled");
  assert.equal(manager.get(other.id).status, "waiting");
  assert.deepEqual(cleaned, ["gpu-a:Paper-account"]);
});
