import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const cli = path.join(root, "bin", "scope.mjs");

test("npm package metadata exposes scope CLI and points to securityCFS/SCOPE", () => {
  assert.equal(pkg.name, "@godchaser/scope");
  assert.equal(pkg.bin.scope, "./bin/scope.mjs");
  assert.match(pkg.repository.url, /securityCFS\/SCOPE\.git$/);
  assert.ok(pkg.files.includes("bin/"));
  assert.ok(pkg.files.includes("dist/"));
  assert.ok(pkg.files.includes("bridge/"));
  assert.ok(pkg.files.includes("!**/__pycache__/**"));
});

test("scope CLI supports --version and --help without touching network or state", () => {
  const version = execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim();
  assert.equal(version, `${pkg.name} v${pkg.version}`);
  const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.match(help, /One monitor for all agent sessions/);
  assert.match(help, /scope gateway/);
  assert.match(help, /scope token/);
  assert.match(help, /scope expose tailscale/);
  assert.match(help, /scope expose cloudflare/);
  assert.match(help, /scope service/);
  assert.match(help, /scope preview/);
  assert.match(help, /sync-protocol/);
  assert.match(help, /https:\/\/github\.com\/securityCFS\/SCOPE/);
});
