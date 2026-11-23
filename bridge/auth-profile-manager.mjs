import { randomUUID } from "node:crypto";
import { JsonlAppServerConnection } from "./app-server-client.mjs";

const PROFILE_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,47}$/u;

export function normalizeProfileName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!PROFILE_NAME_PATTERN.test(name)) {
    throw new Error("Profile 名称需为 1–48 个字母、数字、空格、点、下划线或短横线");
  }
  const slug = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return { name, slug: slug || `profile-${randomUUID().slice(0, 8)}` };
}

export function publicAccount(accountResponse) {
  const account = accountResponse?.account;
  if (!account || typeof account !== "object") return null;
  if (account.type === "chatgpt") {
    return {
      type: "chatgpt",
      email: typeof account.email === "string" ? account.email.slice(0, 320) : "",
      planType:
        typeof account.planType === "string" ? account.planType.slice(0, 80) : "unknown",
    };
  }
  if (["apiKey", "amazonBedrock"].includes(account.type)) {
    return { type: account.type, email: "", planType: "" };
  }
  return null;
}

export class AuthProfileManager {
  constructor({
    spawnConnection,
    prepareProfile,
    finalizeProfile,
    cancelProfile,
    requestTimeoutMs = 45_000,
    now = () => Date.now(),
  }) {
    this.spawnConnection = spawnConnection;
    this.prepareProfile = prepareProfile;
    this.finalizeProfile = finalizeProfile;
    this.cancelProfile = cancelProfile;
    this.requestTimeoutMs = requestTimeoutMs;
    this.now = now;
    this.jobs = new Map();
  }

  async start({ host, executable = "codex", profileName }) {
    const profile = normalizeProfileName(profileName);
    const existing = Array.from(this.jobs.values()).find(
      (job) =>
        job.host === host &&
        job.profile.slug === profile.slug &&
        ["starting", "waiting"].includes(job.status),
    );
    if (existing) return this.publicJob(existing);

    await this.prepareProfile(host, profile);
    const job = {
      id: randomUUID(),
      host,
      profile,
      status: "starting",
      verificationUrl: "",
      userCode: "",
      loginId: "",
      error: null,
      account: null,
      startedAt: new Date(this.now()).toISOString(),
      completedAt: null,
      connection: null,
    };
    this.jobs.set(job.id, job);

    try {
      const child = this.spawnConnection({ host, executable, profile });
      const connection = new JsonlAppServerConnection({
        host: `${host}:${profile.slug}`,
        child,
        requestTimeoutMs: this.requestTimeoutMs,
        now: this.now,
      });
      job.connection = connection;
      connection.on("notification", (message) => {
        if (
          message.method === "account/login/completed" &&
          (!message.params?.loginId || message.params.loginId === job.loginId)
        ) {
          this.#complete(job, message.params).catch((error) =>
            this.#fail(job, error),
          );
        }
      });
      connection.on("close", (error) => {
        if (["starting", "waiting"].includes(job.status)) this.#fail(job, error);
      });
      await connection.start();
      const login = await connection.request("account/login/start", {
        type: "chatgptDeviceCode",
      });
      if (
        login?.type !== "chatgptDeviceCode" ||
        !login.loginId ||
        !login.userCode ||
        !login.verificationUrl
      ) {
        throw new Error("远端 Codex 未返回完整的 device auth 信息");
      }
      let verificationUrl;
      try {
        verificationUrl = new URL(String(login.verificationUrl));
      } catch {
        throw new Error("远端 Codex 返回的 device auth URL 无效");
      }
      if (verificationUrl.protocol !== "https:") {
        throw new Error("远端 Codex 返回了非 HTTPS 的 device auth URL");
      }
      job.loginId = String(login.loginId);
      job.userCode = String(login.userCode);
      job.verificationUrl = verificationUrl.toString();
      job.status = "waiting";
      return this.publicJob(job);
    } catch (error) {
      this.#fail(job, error);
      throw error;
    }
  }

  get(id) {
    const job = this.jobs.get(String(id || ""));
    return job ? this.publicJob(job) : null;
  }

  async cancel(id) {
    const job = this.jobs.get(String(id || ""));
    if (!job) throw new Error("找不到这条登录任务");
    if (["completed", "failed", "cancelled"].includes(job.status)) {
      return this.publicJob(job);
    }
    try {
      if (job.loginId && job.connection && !job.connection.closed) {
        await job.connection.request("account/login/cancel", {
          loginId: job.loginId,
        });
      }
    } finally {
      job.status = "cancelled";
      job.completedAt = new Date(this.now()).toISOString();
      job.connection?.close();
      job.connection = null;
      await this.cancelProfile?.(job.host, job.profile).catch(() => {});
    }
    return this.publicJob(job);
  }

  async cancelForProfile(host, slug) {
    const matches = Array.from(this.jobs.values()).filter(
      (job) =>
        job.host === host &&
        job.profile.slug === slug &&
        ["starting", "waiting"].includes(job.status),
    );
    for (const job of matches) await this.cancel(job.id);
    return matches.length;
  }

  publicJob(job) {
    return {
      id: job.id,
      host: job.host,
      profile: { ...job.profile },
      status: job.status,
      verificationUrl: job.verificationUrl,
      userCode: job.userCode,
      error: job.error,
      account: job.account,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }

  close() {
    for (const job of this.jobs.values()) job.connection?.close();
  }

  async #complete(job, result) {
    if (!result?.success) {
      throw new Error(result?.error || "Device auth 未完成");
    }
    const response = await job.connection.request("account/read", {
      refreshToken: false,
    });
    job.account = publicAccount(response);
    await this.finalizeProfile(job.host, job.profile, job.account);
    job.status = "completed";
    job.completedAt = new Date(this.now()).toISOString();
    job.connection.close();
    job.connection = null;
  }

  #fail(job, error) {
    if (["completed", "cancelled", "failed"].includes(job.status)) return;
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error || "登录失败");
    job.completedAt = new Date(this.now()).toISOString();
    job.connection?.close();
    job.connection = null;
  }
}
