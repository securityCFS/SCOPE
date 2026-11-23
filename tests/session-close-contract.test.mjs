import { bridgeSource } from "./helpers/bridge-source.mjs";
import { workspaceSource } from "./helpers/workspace-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("session close interrupts and unsubscribes without archiving its rollout", async () => {
  const [client, server, page] = await Promise.all([
    readFile(new URL("../bridge/app-server-client.mjs", import.meta.url), "utf8"),
    bridgeSource(),
    workspaceSource(),
  ]);

  assert.match(client, /request\("turn\/interrupt"/);
  assert.match(client, /request\("thread\/unsubscribe", \{ threadId: sessionId \}\)/);
  assert.doesNotMatch(client, /async stopSession[\s\S]*?request\("thread\/archive"/);
  assert.match(server, /url\.pathname === "\/api\/session\/close"/);
  assert.match(server, /appServerManager\.stopSession\(host, sessionId\)/);
  assert.doesNotMatch(
    server.match(
      /if \(url\.pathname === "\/api\/session\/close"[\s\S]*?\n  }\n\n  if \(url\.pathname/,
    )?.[0] || "",
    /thread\/archive|hideArchivedSession/,
  );
  assert.match(server, /remoteSessionSignalSent: false/);
  assert.match(server, /sharedTransportClosed: false/);
  assert.doesNotMatch(
    server.match(
      /if \(url\.pathname === "\/api\/session\/close"[\s\S]*?\n  }\n\n  if \(url\.pathname/,
    )?.[0] || "",
    /kill-session|kill\(|Stop-Process|process\.kill/,
  );
  assert.match(page, /停止当前 Turn 和网页托管；保留 Session 日志/);
  assert.match(page, /Session 日志与 Dialogue 会完整保留/);
});
