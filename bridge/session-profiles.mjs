export function sessionProfileKey(slug) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(slug || "")) {
    throw new Error("Profile 标识无效");
  }
  return `account-${slug}`;
}

export function profileFromConnection(key) {
  if (!String(key || "").startsWith("account-")) return null;
  const slug = key.slice(8);
  sessionProfileKey(slug);
  return slug;
}

export function boundConnectionKey(binding, persistedKey = "active") {
  // A restart between writer transfer and committing the assignment must keep
  // the already-persisted target, not revive the previous account.
  if (binding?.status === "switching" && binding.desiredProfile &&
      persistedKey === sessionProfileKey(binding.desiredProfile)) return persistedKey;
  return binding?.profile ? sessionProfileKey(binding.profile) : persistedKey;
}

export function profileHandoffPending(binding) {
  return Boolean(binding?.handoff && binding.status !== "applied");
}

// Persist intent separately from the current writer. Never claim a queued or
// failed migration changed the account, and never fall back to another account.
export class SessionProfileAssignments {
  constructor({ read, write, session, blocked, verify, migrate,
    hold = () => {}, release = async () => {}, restore = async () => {}, now = () => Date.now() }) {
    Object.assign(this, { read, write, session, blocked, verify, migrate, hold, release, restore, now });
    this.running = new Set();
  }

  async assign(host, sessionId, slug) {
    sessionProfileKey(slug);
    const key = `${host}:${sessionId}`;
    if (this.running.has(key)) throw new Error("该 Session 正在切换账号，请稍后再试");
    const current = this.session(host, sessionId);
    if (!current) throw new Error("请先将这个 Session 恢复到 App Server");
    if (profileHandoffPending(this.read(host, sessionId))) throw new Error("旧账号正在释放 writer；请等待或先取消交接，再选择其他账号");
    this.running.add(key);
    try {
      await this.write(host, sessionId, {
        ...this.read(host, sessionId), desiredProfile: slug,
        status: "queued", error: null,
      });
    } finally { this.running.delete(key); }
    return this.apply(host, sessionId);
  }

  async cancel(host, sessionId) {
    const key = `${host}:${sessionId}`;
    if (this.running.has(key)) throw new Error("正在交接 writer，请等待本次检查完成后取消");
    const current = this.read(host, sessionId);
    if (!current || current.status === "applied") return current;
    this.running.add(key);
    try {
      if (profileHandoffPending(current)) await this.restore(host, sessionId, current.handoff.source);
      const restored = current.profile ? { profile: current.profile, desiredProfile: current.profile,
        status: "applied", error: null } : null;
      await this.write(host, sessionId, restored);
      return restored;
    } finally { this.running.delete(key); }
  }

  async apply(host, sessionId) {
    const key = `${host}:${sessionId}`;
    let intent = this.read(host, sessionId);
    if (!intent || !["queued", "switching", "waiting-writer"].includes(intent.status) || this.running.has(key)) return intent;
    if ((intent.nextAttemptAt || 0) > this.now()) return intent;
    const current = this.session(host, sessionId);
    if (!current || (!profileHandoffPending(intent) && (current.status === "offline" || this.blocked(host, sessionId)))) return intent;
    this.running.add(key);
    try {
      if (!profileHandoffPending(intent)) {
        await this.write(host, sessionId, { ...intent, status: "switching", error: null });
        const account = await this.verify(host, intent.desiredProfile, current.executable);
        if (this.blocked(host, sessionId)) {
          await this.write(host, sessionId, { ...intent, status: "queued", error: null });
          return this.read(host, sessionId);
        }
        const latest = this.session(host, sessionId);
        this.hold(host, sessionId);
        const source = Object.fromEntries(["host", "sessionId", "path", "cwd", "model", "effort", "yolo", "executable", "connectionKey", "resumeOnRecovery"]
          .map((field) => [field, latest[field]]));
        intent = { ...intent, status: "waiting-writer", error: null, targetAccount: account,
          handoff: { source, released: false, startedAt: this.now() } };
        await this.write(host, sessionId, intent);
      }
      if (!intent.handoff.released) {
        await this.release(host, sessionId, intent.handoff.source);
        intent = { ...intent, handoff: { ...intent.handoff, released: true, releasedAt: this.now() } };
        await this.write(host, sessionId, intent);
      }
      await this.migrate(host, sessionId, sessionProfileKey(intent.desiredProfile), current.executable, intent.handoff.source);
      await this.write(host, sessionId, {
        profile: intent.desiredProfile, desiredProfile: intent.desiredProfile,
        status: "applied", account: intent.targetAccount, verifiedAt: new Date(this.now()).toISOString(), error: null,
      });
    } catch (error) {
      if (profileHandoffPending(intent) && /already has an active writer|connection reset|disconnected|连接|超时|timeout|ECONN|远端 app-server 已退出/i.test(error.message)) {
        // Crucially, do not resume the source: doing so restarts its 30 minute
        // inactivity grace period. The timer retries only the target writer.
        await this.write(host, sessionId, { ...intent, status: "waiting-writer",
          error: /already has an active writer/i.test(error.message) ? null : `连接暂时不可用，后台将重试：${error.message}`,
          nextAttemptAt: this.now() + 30_000 });
      } else {
        await this.write(host, sessionId, { ...intent, status: "failed", error: error.message, nextAttemptAt: null });
      }
    } finally { this.running.delete(key); }
    return this.read(host, sessionId);
  }
}
