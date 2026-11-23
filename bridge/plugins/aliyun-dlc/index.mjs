import path from "node:path";
import { SubmissionSettings, validateSubmissionSettings } from "../../submissions/settings.mjs";
import { PluginConfigStore } from "../config-store.mjs";
import { manifest } from "./manifest.mjs";
import { createSubmissionMonitor } from "./monitor.mjs";

export function createAliyunDlcPlugin({ stateDirectory, legacyHost, context, notify, onScanComplete, defaultWindowDays = 1 }) {
  const store = new PluginConfigStore({
    filename: path.join(stateDirectory, "plugins", manifest.id + ".json"),
    validate(value) {
      if (!value.config || Object.keys(value.config).some(key => key !== "host")) throw new Error("未知的 DLC 插件设置");
      const config = validateSubmissionSettings({ enabled: value.enabled, host: value.config.host });
      return { enabled: config.enabled, config: { host: config.host } };
    },
    migrate() {
      const legacy = new SubmissionSettings({ filename: path.join(stateDirectory, "submission-monitor.json"), legacyHost }).read();
      return { enabled: legacy.enabled, config: { host: legacy.host } };
    },
  });
  const settings = () => { const s = store.read(); return { enabled: s.enabled, host: s.config.host }; };
  const monitor = createSubmissionMonitor({ settings, context, notify, onScanComplete, defaultWindowDays });
  let started = false, initialTimer, interval;
  function clearTimers() { clearTimeout(initialTimer); clearInterval(interval); }
  function schedule(initial = false) {
    clearTimers();
    if (!started || !store.read().enabled) return;
    if (initial) { initialTimer = setTimeout(() => void monitor.scan(), 8000); initialTimer.unref(); }
    interval = setInterval(() => void monitor.scan(), 5 * 60000); interval.unref();
  }
  return {
    manifest, store,
    busy: monitor.busy,
    status: () => ({ state: !store.read().enabled ? "disabled" : monitor.busy() ? "running" : monitor.snapshot().error ? "error" : "idle", resultType: manifest.view, result: monitor.snapshot() }),
    configure() { monitor.reset(); schedule(); notify(); },
    start() { if (started) return; started = true; schedule(true); },
    stop() { started = false; clearTimers(); },
    snapshot: monitor.snapshot,
    invoke(action, input = {}) {
      if (action !== "scan") throw new Error("未知插件操作");
      const limit = Math.max(20, Math.min(200, Number(input.limit) || 100));
      const windowDays = [0, 1, 7, 14, 30, 90].includes(Number(input.days)) ? Number(input.days) : defaultWindowDays;
      const alreadyScanning = monitor.busy();
      void monitor.scan(limit, windowDays);
      return { accepted: true, alreadyScanning, limit, windowDays, targetHostname: settings().host };
    },
  };
}
