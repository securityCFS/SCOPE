import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jsonResponse, readJsonBody } from "../http.mjs";

export function validateSubmissionSettings(value) {
  if (!value || typeof value.enabled !== "boolean" || typeof value.host !== "string")
    throw new Error("请指定是否启用，以及提交主机");
  const host = value.host.trim();
  if (host.length > 253 || (host && !/^[a-zA-Z0-9_][a-zA-Z0-9_.:@-]*$/.test(host)) || host === "@local")
    throw new Error("请选择 SSH 主机，或填写有效的 SSH 别名 / HostName");
  if (value.enabled && !host) throw new Error("启用监控前请选择提交主机");
  return { enabled: value.enabled, host };
}

export class SubmissionSettings {
  constructor({ filename, legacyHost = "" }) {
    this.filename = filename;
    this.value = validateSubmissionSettings({ enabled: Boolean(legacyHost), host: legacyHost });
    try { this.value = validateSubmissionSettings(JSON.parse(readFileSync(filename, "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  read() { return { ...this.value }; }
  save(value) {
    const next = validateSubmissionSettings(value);
    mkdirSync(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.tmp`;
    writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
    renameSync(temporary, this.filename);
    this.value = next;
    return this.read();
  }
}

export function submissionSettingsRoutes({ store, isScanning, apply }) {
  return async (request, response, url) => {
    if (url.pathname !== "/api/submissions/settings") return false;
    if (request.method === "GET") jsonResponse(response, 200, store.read());
    else if (request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        // Check after reading the body: a scan may have started in the meantime.
        if (isScanning()) { jsonResponse(response, 409, { error: "正在扫描，请等待扫描结束后保存监控设置" }); return true; }
        const value = store.save(body);
        apply(value);
        jsonResponse(response, 200, value);
      } catch (error) { jsonResponse(response, 400, { error: error.message }); }
    } else jsonResponse(response, 405, { error: "不支持此操作" });
    return true;
  };
}
