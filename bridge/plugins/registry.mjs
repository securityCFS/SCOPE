export const PLUGIN_PROTOCOL_VERSION = 1;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/** Bundled modules and explicitly installed trusted extensions. Not a sandbox. */
export class PluginRegistry {
  constructor() { this.plugins = new Map(); this.started = false; this.loadErrors = []; }
  register(plugin) {
    const m = plugin.manifest;
    if (m?.protocolVersion !== PLUGIN_PROTOCOL_VERSION) throw fail("不支持的插件协议版本");
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(m.id || "") || this.plugins.has(m.id)) throw fail("插件 ID 无效或重复");
    if (!m.name || !m.version || !Array.isArray(m.capabilities) || !Array.isArray(m.settings) || !Array.isArray(m.actions)) throw fail("插件清单不完整");
    if (m.actions.some(a => !/^[a-z][a-z0-9-]*$/.test(a.id)) || new Set(m.actions.map(a => a.id)).size !== m.actions.length) throw fail("插件操作 ID 无效或重复");
    this.plugins.set(m.id, plugin);
  }
  get(id) { const p = this.plugins.get(id); if (!p) throw fail("插件不存在", 404); return p; }
  describe(id) {
    const p = this.get(id);
    const { result, ...status } = p.status();
    return { manifest: p.manifest, source: p.source || "builtin", ...p.store.read(), status: { ...status, scannedAt: result?.scannedAt || null, error: result?.error || null } };
  }
  list() { return { protocolVersion: PLUGIN_PROTOCOL_VERSION, plugins: [...this.plugins.keys()].map(id => this.describe(id)), loadErrors: this.loadErrors }; }
  configure(id, value, revision) {
    const p = this.get(id);
    if (p.busy()) throw fail("插件正在扫描，请等待结束后保存", 409);
    p.store.save(value, revision);
    p.configure();
    return this.describe(id);
  }
  invoke(id, action, input) {
    const p = this.get(id);
    if (!p.manifest.actions.some(a => a.id === action)) throw fail("插件操作不存在", 404);
    if (!p.store.read().enabled) throw fail("请先在设置 → 插件中启用并配置此插件", 409);
    return p.invoke(action, input);
  }
  start() { if (this.started) return; this.started = true; for (const p of this.plugins.values()) p.start(); }
  stop() { this.started = false; for (const p of this.plugins.values()) p.stop(); }
}
