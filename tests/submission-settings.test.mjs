import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { SubmissionSettings, submissionSettingsRoutes } from "../bridge/submissions/settings.mjs";

test("DLC is opt-in, migrates a configured host, and explicit disable survives restart", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "scope-submission-settings-"));
  const filename = path.join(dir, "monitor.json");
  try {
    assert.deepEqual(new SubmissionSettings({ filename }).read(), { enabled: false, host: "" });
    const store = new SubmissionSettings({ filename, legacyHost: "old-dlc" });
    assert.deepEqual(store.read(), { enabled: true, host: "old-dlc" });
    store.save({ enabled: true, host: "new-dlc" });
    assert.equal(new SubmissionSettings({ filename, legacyHost: "old-dlc" }).read().host, "new-dlc");
    store.save({ enabled: false, host: "new-dlc" });
    assert.deepEqual(new SubmissionSettings({ filename, legacyHost: "old-dlc" }).read(), { enabled: false, host: "new-dlc" });
    for (const host of ["", "@local", "-oProxyCommand=test", "bad;host", "two hosts"]) {
      assert.throws(() => store.save({ enabled: true, host }));
    }
    assert.deepEqual(store.read(), { enabled: false, host: "new-dlc" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("settings endpoint applies saved targets, rejects changes during scan and never runs scans", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "scope-submission-route-"));
  try {
    const store = new SubmissionSettings({ filename: path.join(dir, "monitor.json") });
    let scanning = false;
    const applied = [];
    const route = submissionSettingsRoutes({ store, isScanning: () => scanning, apply: (v) => applied.push(v) });
    async function request(method, body) {
      const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []); req.method = method;
      let status, value;
      await route(req, { writeHead: (v) => status = v, end: (v) => value = JSON.parse(v) }, new URL("http://localhost/api/submissions/settings"));
      return { status, value };
    }
    assert.equal((await request("GET")).value.enabled, false);
    assert.equal((await request("POST", { enabled: true, host: "dlc" })).status, 200);
    scanning = true;
    assert.equal((await request("POST", { enabled: false, host: "dlc" })).status, 409);
    assert.equal(store.read().enabled, true);
    assert.equal(applied.length, 1);
    scanning = false;
    assert.equal((await request("POST", { enabled: false, host: "dlc" })).status, 200);
    assert.equal(applied.at(-1).enabled, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
