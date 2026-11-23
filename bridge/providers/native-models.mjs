import { shellQuote } from "./cli-command.mjs";
import { readFile } from "node:fs/promises";

export function parseNativeModels(output) {
  return [
    ...new Map(
      String(output)
        .split(/\r?\n/)
        .flatMap((line) => {
          const [id, label] = line.trim().split("\t");
          return label && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(id)
            ? [[id, { id, label }]]
            : [];
        }),
    ).values(),
  ];
}
export class NativeModels {
  constructor({ run, hosts, settings }) {
    Object.assign(this, { run, hosts, settings });
    this.cache = new Map();
    this.pending = new Map();
  }
  async list(host, provider, force = false) {
    if (!["antigravity", "claude"].includes(provider))
      throw new Error("此 Agent 暂无可读取的模型目录，请填写 CLI 模型名称");
    if (
      !this.hosts().some((item) => item.alias === host && item.reachable) ||
      host === "@local"
    )
      throw new Error("请选择在线远程设备");
    const config = this.settings(provider, host) || {};
    const key = JSON.stringify([
      host,
      provider,
      config.executable,
      config.preLaunchCommand,
    ]);
    const cached = this.cache.get(key);
    if (!force && cached && Date.now() - cached.at < 300000)
      return cached.models;
    if (this.pending.has(key)) return this.pending.get(key);
    const request = (async () => {
      const setup = String(config.preLaunchCommand || "").trim();
      const probe = provider === "claude" ? Buffer.from(await readFile(new URL("./claude-capabilities.py", import.meta.url))).toString("base64") : "";
      const command = provider === "claude"
        ? `python3 -c ${shellQuote(`import base64;exec(base64.b64decode('${probe}'))`)} ${shellQuote(config.executable || "claude")}`
        : `${shellQuote(config.executable || "agy")} models && ${shellQuote(config.executable || "agy")} --help 2>&1 && ${shellQuote(config.executable || "agy")} --mode auto --sandbox -p /effort --output-format json 2>&1`;
      const bootstrap = setup ? `${setup}\nscope_proxy_status=$?\nif [ "$scope_proxy_status" -ne 0 ]; then exit "$scope_proxy_status"; fi\n` : "";
      const script = `${bootstrap}${command}`;
      const result = await this.run(
        host,
        `bash -ic ${shellQuote(script)}`,
        "",
        30000,
        512000,
      );
      if (result.code !== 0)
        throw new Error(
          `无法读取 ${provider} 模型：请检查设备上的代理、登录和 CLI 版本`,
        );
      const models = provider === "claude" ? parseClaudeModels(result.stdout) : agyModelCapabilities(result.stdout);
      if (!models.length)
        throw new Error(`${provider} 返回了空模型目录，请检查登录状态`);
      this.cache.set(key, { at: Date.now(), models });
      return models;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
  async validate(host, provider, model) {
    if (provider !== "antigravity" || !model) return;
    if (!(await this.list(host, provider)).some((item) => item.id === model))
      throw new Error("该设备不支持所选 AGY 模型，请刷新模型列表后重选");
  }
  async validateClaudeOptions(host, model, effort, permissionMode) {
    const models = await this.list(host, "claude");
    const selected = models.find(item => item.id === (model || "default") || item.resolvedModel === model);
    if (!selected) throw new Error("该设备未报告所选 Claude 模型，请刷新模型列表");
    if (effort && !selected.efforts.includes(effort)) throw new Error("该 Claude 模型不支持所选推理强度");
    if (permissionMode === "auto" && !selected.supportsAutoMode) throw new Error("该 Claude 模型未报告 auto 权限支持，请换模型或权限模式");
  }
  async validateAgyOptions(host, model, effort, permissionMode) {
    const models = await this.list(host, "antigravity");
    const selected = models.find(item => item.id === model);
    if (permissionMode === "auto" && !models[0]?.supportsAutoMode)
      throw new Error("远端 AGY 当前账号或 CLI 不支持 auto；请选择默认权限或工作区编辑，不会静默退回其他模式");
    if (permissionMode === "plan" && !models[0]?.supportsPlanMode)
      throw new Error("远端 AGY 未报告 plan 模式支持");
    if (!effort) return model;
    if (!selected) throw new Error("请先选择 AGY 模型，再设置推理强度");
    if (!selected.efforts.includes(effort)) throw new Error("该 AGY 模型不支持所选推理强度");
    return selected.effortModels[effort];
  }
}

export function agyModelCapabilities(output) {
  const models = parseNativeModels(output);
  const supportsEffort = /--effort\s/.test(output);
  const modeLine = String(output).split(/\r?\n/).find(line => /--mode\s/.test(line)) || "";
  return models.map(model => {
    const family = model.id.replace(/-(low|medium|high|xhigh|max)$/, "");
    const effortModels = {};
    if (supportsEffort && family !== model.id) {
      for (const level of ["low", "medium", "high", "xhigh", "max"]) {
        const id = `${family}-${level}`;
        if (models.some(m => m.id === id)) effortModels[level] = id;
      }
    }
    return { ...model, efforts: Object.keys(effortModels), effortModels,
      currentEffort: family !== model.id ? model.id.slice(family.length + 1) : "",
      supportsAutoMode: /\bauto\b/.test(modeLine) && !/auto is not available|continuing in the default mode/i.test(output), supportsPlanMode: /\bplan\b/.test(modeLine) };
  });
}

export function parseClaudeModels(output) {
  for (const line of String(output).trim().split(/\r?\n/).reverse()) {
    try {
      const data = JSON.parse(line);
      if (!Array.isArray(data.models)) continue;
      return data.models.filter(m => typeof m.id === "string" && typeof m.label === "string").map(m => ({
        id: m.id, label: m.label, resolvedModel: m.resolvedModel,
        efforts: (Array.isArray(m.efforts) ? m.efforts : []).filter(e => ["low", "medium", "high", "xhigh", "max"].includes(e)),
        supportsAutoMode: m.supportsAutoMode === true,
      }));
    } catch { /* shell banner */ }
  }
  return [];
}
