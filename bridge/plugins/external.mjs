import path from "node:path";
import { pathToFileURL } from "node:url";
import { PluginConfigStore } from "./config-store.mjs";
import { installedPackages, inspectPackage } from "./package.mjs";

/** Trusted native Node extensions, not a sandbox or a Cordis compatibility layer. */
export function createExternalPlugin(pkg, stateDirectory) {
  const manifest = pkg.manifest;
  const store = new PluginConfigStore({
    filename: path.join(stateDirectory, "plugin-data", manifest.id, "settings.json"),
    migrate: () => ({ enabled: false, config: Object.fromEntries(manifest.settings.map(f => [f.key, f.default || ""])) }),
    validate(value) {
      if (typeof value.enabled !== "boolean" || !value.config || Array.isArray(value.config) || typeof value.config !== "object") throw new Error("无效的插件设置");
      if (Object.keys(value.config).some(key => !manifest.settings.some(f => f.key === key))) throw new Error("未知插件设置");
      const config = {};
      for (const field of manifest.settings) {
        const v = value.config[field.key] ?? field.default ?? "";
        if (typeof v !== "string" || v.length > 4096 || (value.enabled && field.requiredWhenEnabled && !v.trim())) throw new Error(`请填写有效的${field.label}`);
        if (v && field.type === "ssh-host" && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(v)) throw new Error("无效的 SSH 主机");
        config[field.key] = v;
      }
      return { enabled: value.enabled, config };
    },
  });
  let started = false, generation = 0, state = "disabled", error = null, running = 0, disposers = [], actions = new Map();
  function dispose() {
    generation++; actions.clear();
    for (const fn of disposers.splice(0).reverse()) {
      try { Promise.resolve(fn()).catch(cause => { error = cause.message; }); } catch (cause) { error = cause.message; }
    }
  }
  async function mount() {
    dispose(); error = null;
    if (!started || !store.read().enabled) { state = "disabled"; return; }
    const ownGeneration = generation;
    const alive = () => generation === ownGeneration;
    state = "loading";
    try {
      if (inspectPackage(pkg.directory).digest !== pkg.digest) throw new Error("插件文件已改变，请重新导入");
      const extension = await import(pathToFileURL(path.join(pkg.directory, manifest.entry)).href);
      if (!alive()) return;
      if (typeof extension.apply !== "function") throw new Error("插件必须导出 apply(ctx)");
      await extension.apply({
        config: store.read().config,
        action(id, handler) {
          if (!alive()) throw new Error("插件已卸载");
          if (!manifest.actions.some(a => a.id === id) || actions.has(id) || typeof handler !== "function") throw new Error("操作未声明或重复注册");
          actions.set(id, handler);
        },
        onDispose(fn) {
          if (typeof fn !== "function") throw new Error("清理器必须是函数");
          if (!alive()) Promise.resolve().then(fn).catch(() => {}); else disposers.push(fn);
        },
      });
      if (alive()) {
        if (manifest.actions.some(a => !actions.has(a.id))) throw new Error("插件没有注册清单中的全部操作");
        state = "idle";
      }
    } catch (cause) { if (alive()) { dispose(); error = cause.message; state = "error"; } }
  }
  return {
    manifest, store, source: "local",
    busy: () => running > 0,
    status: () => ({ state: running ? "running" : state, result: { error } }),
    configure: () => { void mount(); },
    start() { if (!started) { started = true; void mount(); } },
    stop() { started = false; dispose(); state = "disabled"; },
    async invoke(id, input) {
      if (running || state !== "idle" || !actions.has(id)) throw Object.assign(new Error(error || "插件尚未就绪或正在执行操作"), { statusCode: 409 });
      running++;
      try { return (await actions.get(id)(input)) ?? null; }
      finally { running--; }
    },
  };
}

export function loadExternalPlugins(registry, stateDirectory) {
  let packages;
  try { packages = installedPackages(stateDirectory); }
  catch (error) { registry.loadErrors.push({ id: "extensions", error: error.message }); return; }
  for (const pkg of packages) {
    try {
      if (pkg.error) throw new Error(pkg.error);
      registry.register(createExternalPlugin(pkg, stateDirectory));
    } catch (error) { registry.loadErrors.push({ id: pkg.id, error: error.message }); }
  }
}
