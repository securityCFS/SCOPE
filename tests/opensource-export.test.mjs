import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareExportDirectory } from "../scripts/lib/export-directory.mjs";
import {
  loadDenylistPatterns,
  scanContentForLeaks,
} from "../scripts/lib/secret-scanner.mjs";

test("export refuses repository roots, ancestors, nonempty folders and directory links without removing data", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scope-export-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo"), existing = path.join(root, "existing");
  await mkdir(repo); await mkdir(existing);
  await writeFile(path.join(existing, "keep.txt"), "keep");
  await assert.rejects(prepareExportDirectory(repo, repo), /repository/);
  await assert.rejects(prepareExportDirectory(root, repo), /ancestors/);
  await assert.rejects(prepareExportDirectory(existing, repo), /empty/);
  assert.equal(await readFile(path.join(existing, "keep.txt"), "utf8"), "keep");
  const linked = path.join(root, "linked");
  await symlink(existing, linked, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(prepareExportDirectory(path.join(linked, "new"), repo), /symlink|junction/);
});

test("export CLI copies a fresh source-only tree and refuses to overwrite an earlier export", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scope-export-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo"), out = path.join(root, "release");
  await mkdir(repo);
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  await writeFile(path.join(repo, "README.md"), "# Example\n");
  await writeFile(path.join(repo, ".gitignore"), ".scope/\n");
  await mkdir(path.join(repo, ".scope"));
  await writeFile(path.join(repo, ".scope/private.txt"), "private local state");
  execFileSync("git", ["add", "README.md", ".gitignore"], { cwd: repo });
  const script = fileURLToPath(new URL("../scripts/export-opensource.mjs", import.meta.url));
  const run = (...args) => execFileSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8", stdio: "pipe" });
  run("--out", out);
  assert.equal(await readFile(path.join(out, "README.md"), "utf8"), "# Example\n");
  await assert.rejects(readFile(path.join(out, ".scope/private.txt")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(out, ".git/config")), { code: "ENOENT" });
  assert.throws(() => run("--out", out), /must be empty/);
  assert.throws(() => run("--out"), /requires an output directory/);
  assert.equal(await readFile(path.join(out, "README.md"), "utf8"), "# Example\n");
});

test("secret heuristic scanner detects common API keys, private keys, and credential URLs", () => {
  const sample = [
    "TOKEN=" + "ghp_" + "A".repeat(36),
    "KEY=" + "sk-" + "proj-" + "B".repeat(28),
    "-----BEGIN " + "OPENSSH PRIVATE KEY-----",
    "URL=https://deploy:" + "supersecret99" + "@internal.company.example/repo",
    "SAFE_LOCAL=https://user:pass1234@localhost:8080/ok",
  ].join("\n");
  const hits = scanContentForLeaks(sample, "sample.env");
  assert.deepEqual(
    hits.map((item) => [item.line, item.rule]),
    [
      [1, "github-token"],
      [2, "openai-or-anthropic-key"],
      [3, "private-key"],
      [4, "credential-url"],
    ],
  );
  assert.ok(!hits.some((item) => item.token.includes("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")));
});

test("custom denylist file catches private hostnames and codenames without baking them into public code", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scope-denylist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const denylistFile = path.join(root, "leak-denylist.json");
  await writeFile(
    denylistFile,
    JSON.stringify({
      literals: ["10.99.88.77", "corp-secret-codename"],
      patterns: ["\\bcustom_proxy_helper\\b"],
    }),
  );
  const patterns = await loadDenylistPatterns(denylistFile);
  assert.equal(patterns.length, 3);
  const hits = scanContentForLeaks(
    "host = 10.99.88.77\nrun custom_proxy_helper\nclean line\n",
    "notes.md",
    patterns,
  );
  assert.deepEqual(
    hits.map((item) => [item.line, item.rule]),
    [
      [1, "custom-denylist"],
      [2, "custom-denylist"],
    ],
  );
  assert.deepEqual(await loadDenylistPatterns(path.join(root, "missing.json")), []);
});
