import { LOCAL_HOST } from "../../lib/execution-host.js";
import { shellQuote } from "../transport/ssh-command.mjs";
import { runLocalPython } from "../local/python-probe.mjs";

export async function scanResearchHost({ host, encoded, script, timeoutMs, runSsh, runLocal = runLocalPython, cleanError = String }) {
  const failed = (error) => ({ host: host.alias, error: cleanError(error), terms: [], filesScanned: 0, totalFiles: 0, results: [] });
  try {
    const result = host.alias === LOCAL_HOST
      ? await runLocal(script, [encoded], timeoutMs, 8_000_000)
      : await runSsh(host.alias, `timeout ${Math.max(15, Math.floor(timeoutMs / 1000) - 3)}s python3 - ${shellQuote(encoded)}`, script, timeoutMs, 8_000_000);
    if (result.code !== 0) return failed(result.stderr || result.stdout || "检索未完成");
    const data = JSON.parse(result.stdout);
    if (!Array.isArray(data.results)) return failed("检索结果无法解析");
    return { ...data, host: host.alias, error: null };
  } catch (error) {
    return failed(error.message);
  }
}
