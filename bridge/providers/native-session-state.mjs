import { readFile } from "node:fs/promises";
import { shellQuote } from "./cli-command.mjs";
const source = readFile(new URL("./native-session-state.py", import.meta.url), "utf8");
export async function nativeGuardCommand(payload) {
  const code = Buffer.from(await source).toString("base64");
  return `python3 -c ${shellQuote(`import base64;exec(base64.b64decode('${code}'))`)} ${shellQuote(Buffer.from(JSON.stringify(payload)).toString("base64url"))}`;
}
export function nativeSessionState(run) {
  return async (host, sessionId, action, provider = "claude") => {
    const result = await run(host, await nativeGuardCommand({ sessionId, action, provider }), "", 15000, 64000);
    if (result.code !== 0) throw new Error((result.stderr || "无法核实 Agent 会话状态").trim().split("\n").at(-1));
    return JSON.parse(result.stdout.trim());
  };
}
