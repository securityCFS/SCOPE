import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Content-addressed, write-once versions. Never delete on scan/reset/reconnect.
export async function archiveSessionCache(directory, snapshot) {
  for (const host of snapshot?.hosts || []) {
    for (const s of host.sessions || []) {
      if (!s?.id && !s?.path) continue;
      const identity = createHash("sha256").update(`${host.alias}\0${s.id || s.path}`).digest("hex");
      const content = { host: host.alias, id: s.id, path: s.path, cwd: s.cwd,
        firstUser: s.firstUser, lastUser: s.lastUser, lastAssistant: s.lastAssistant,
        lastEventAt: s.lastEventAt, userMessages: s.userMessages, assistantMessages: s.assistantMessages };
      const data = JSON.stringify(content);
      const version = createHash("sha256").update(data).digest("hex");
      const folder = path.join(directory, identity);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      try { await writeFile(path.join(folder, `${version}.json`), data + "\n", { flag: "wx", mode: 0o600 }); }
      catch (e) { if (e.code !== "EEXIST") throw e; }
    }
  }
}
