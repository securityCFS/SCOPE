import assert from "node:assert/strict";
import { modelRoutes } from "../bridge/routes/models.mjs";

test("extracted model routes use fresh snapshot and session profile", async () => {
  let reachable = true,
    result;
  const response = {
    writeHead(status) {
      this.status = status;
    },
    end(value) {
      result = JSON.parse(value);
    },
  };
  const handler = modelRoutes(() => ({
    snapshot: { hosts: [{ alias: "h", reachable }] },
    jsonResponse,
    appServerManager: {
      sessionRecords: () => [
        { host: "h", sessionId: "s", connectionKey: "account-pinned" },
      ],
    },
    readInstalledModels: async (_host, refresh, key) => {
      assert.equal(refresh, true);
      assert.equal(key, "account-pinned");
      return { models: [{ id: "available" }] };
    },
  }));
  const url = new URL(
    "http://localhost/api/models?host=h&sessionId=s&refresh=1",
  );
  assert.equal(await handler({ method: "GET" }, response, url), true);
  assert.equal(response.status, 200);
  assert.equal(result.models[0].id, "available");
  reachable = false;
  await handler({ method: "GET" }, response, url);
  assert.equal(response.status, 404);
});
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { requestHandler, readJsonBody, jsonResponse } from "../bridge/http.mjs";
import { createSshCommand } from "../bridge/transport/ssh-command.mjs";

test("HTTP boundary blocks foreign writes, handles malformed bodies and survives async route exceptions", async (t) => {
  let calls = 0;
  const server = createServer(
    requestHandler(
      async (req, res, url) => {
        calls++;
        if (url.pathname === "/throw") throw new Error("internal secret");
        jsonResponse(res, 200, await readJsonBody(req));
      },
      {
        host: "127.0.0.1",
        trustedOrigins: new Set(["http://localhost:3000"]),
        onError() {},
      },
    ),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { Origin: "https://foreign.invalid" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await fetch(url, { method: "POST", body: "not-json" })).status,
    400,
  );
  const failed = await fetch(`${url}/throw`);
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /internal secret/);
  assert.equal((await fetch(url)).status, 200);
});

function transport(spawn) {
  const counts = new Map();
  const run = createSshCommand({
    inventoryOperations: new Map(),
    operationCounts: counts,
    connectTimeoutMs: 1000,
    audit() {},
    spawn,
  });
  return { run, counts };
}
function child() {
  const process = new EventEmitter();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.stdin = new PassThrough();
  process.kill = () => {
    process.killed = true;
  };
  return process;
}
test("SSH retains split UTF-8 bytes and releases operation counts on success or spawn error", async () => {
  const process = child();
  const f = transport(() => process);
  const pending = f.run("h", "read-only");
  await Promise.resolve();
  const data = Buffer.from("中文✓");
  for (const byte of data) process.stdout.write(Buffer.from([byte]));
  process.emit("close", 0);
  assert.equal((await pending).stdout, "中文✓");
  assert.equal(f.counts.size, 0);
  const broken = transport(() => {
    throw new Error("cannot spawn");
  });
  assert.equal((await broken.run("h", "read-only")).code, 1);
  assert.equal(broken.counts.size, 0);
});
test("SSH overflow fails explicitly and timeout never signals a remote session", async () => {
  const process = child();
  const f = transport(() => process);
  const pending = f.run("h", "read-only", "", 1000, 3);
  await Promise.resolve();
  process.stdout.write("abcdef");
  const result = await pending;
  assert.equal(result.code, 125);
  assert.equal(result.stdout, "abc");
  assert.equal(process.killed, true);
  assert.equal(f.counts.size, 0);
  const timeout = transport(() => child());
  assert.equal((await timeout.run("h", "read-only", "", 5)).code, 124);
  assert.equal(timeout.counts.size, 0);
});
