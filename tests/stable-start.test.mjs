import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("starts SCOPE in production mode unless development is explicit", async () => {
  const [start, packageJson] = await Promise.all([
    readFile(new URL("../bridge/start.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  assert.match(start, /process\.argv\.includes\("--dev"\)/);
  assert.match(start, /process\.argv\.includes\("--skip-build"\)/);
  assert.match(start, /const uiEntry = fileURLToPath/);
  assert.match(start, /developmentMode\s*\? \[/);
  assert.match(start, /uiEntry,/);
  assert.match(start, /\[vinextEntry, "build"\]/);
  assert.match(start, /"--hostname",\s*"127\.0\.0\.1"/);
  assert.match(start, /function launchChild\(spec\)/);
  assert.match(start, /attempts > 5/);
  assert.match(start, /秒后自动重启/);
  assert.equal(packageJson.scripts.scope, "node bridge/start.mjs");
  assert.equal(packageJson.scripts["scope:dev"], "node bridge/start.mjs --dev");
});
