import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareProfileHome } from "../bridge/remote-profile-home.mjs";

const posix = process.platform !== "win32";
test("private CLI locks stay intact while SCOPE uses shared credentials and a separate home", { skip: !posix }, () => {
  const temp = mkdtempSync(join(tmpdir(), "scope-profile-test-"));
  const profile = join(temp, ".codex/scope-auth-profiles/example");
  const home = join(profile, "home");
  const runtime = join(profile, "scope-home");
  try {
    mkdirSync(join(home, "thread-writer-locks"), { recursive: true });
    writeFileSync(join(home, "thread-writer-locks/live.lock"), "held");
    writeFileSync(join(home, "auth.json"), "fixture credential");
    const inode = statSync(join(home, "thread-writer-locks/live.lock")).ino;
    const run = () => spawnSync("bash", ["-c", ["set -eu", ...prepareProfileHome("example"), 'printf "%s" "$app_codex_home"'].join("\n")],
      { env: { ...process.env, HOME: temp }, encoding: "utf8" });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, runtime);
    assert.equal(statSync(join(home, "thread-writer-locks/live.lock")).ino, inode);
    assert.equal(readFileSync(join(home, "thread-writer-locks/live.lock"), "utf8"), "held");
    assert.equal(realpathSync(join(runtime, "auth.json")), join(home, "auth.json"));
    writeFileSync(join(runtime, "auth.lock"), "commit lock");
    assert.equal(realpathSync(join(runtime, "auth.lock")), join(home, "auth.lock"));
    writeFileSync(join(runtime, "auth.json"), "refreshed fixture");
    assert.equal(readFileSync(join(home, "auth.json"), "utf8"), "refreshed fixture");
    assert.equal(run().status, 0, "repeated startup reuses the same home");
    rmSync(join(runtime, "auth.json"));
    writeFileSync(join(runtime, "auth.json"), "unexpected credential");
    assert.equal(run().status, 77, "never overwrite unrelated credential files");
    assert.equal(readFileSync(join(runtime, "auth.json"), "utf8"), "unexpected credential");
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("existing shared-lock profile keeps its original runtime", { skip: !posix }, () => {
  const temp = mkdtempSync(join(tmpdir(), "scope-profile-test-"));
  const home = join(temp, ".codex/scope-auth-profiles/example/home");
  try {
    mkdirSync(home, { recursive: true });
    mkdirSync(join(temp, ".codex/thread-writer-locks"));
    symlinkSync(join(temp, ".codex/thread-writer-locks"), join(home, "thread-writer-locks"));
    writeFileSync(join(home, "auth.json"), "fixture");
    const result = spawnSync("bash", ["-c", ["set -eu", ...prepareProfileHome("example"), 'printf "%s" "$app_codex_home"'].join("\n")],
      { env: { ...process.env, HOME: temp }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, home);
    assert.equal(existsSync(join(home, "../scope-home")), false);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
