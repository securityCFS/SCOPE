import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  directoryRoutes,
  validateDirectoryTarget,
  CREATE_DIRECTORY,
} from "../bridge/workbench/directory-routes.mjs";

test("folder creation rejects traversal, nested paths and control characters", () => {
  for (const name of [
    "",
    ".",
    "..",
    "../escape",
    "sub/folder",
    "sub\\folder",
    "bad\nname",
    "bad\0name",
    " padded ",
  ])
    assert.throws(() =>
      validateDirectoryTarget({ parent: "/workspace", name }),
    );
  for (const parent of ["relative", "/bad\npath", "/bad\0path"])
    assert.throws(() => validateDirectoryTarget({ parent, name: "project" }));
  assert.deepEqual(
    validateDirectoryTarget({
      parent: "/workspace",
      name: "实验 ' $(literal)",
    }),
    { parent: "/workspace", name: "实验 ' $(literal)" },
  );
});

test("directory route cannot create on unknown/offline hosts; failure stays a failure", async () => {
  let calls = 0,
    output;
  const route = directoryRoutes({
    getHost: (alias) =>
      alias === "online" ? { alias, reachable: true } : null,
    readJsonBody: async (req) => req.body,
    jsonResponse: (_res, status, body) => {
      output = { status, body };
    },
    shellQuote: (text) => `'${text}'`,
    cleanError: (text) => text,
    run: async () => {
      calls++;
      return { code: 1, stderr: "同名文件或目录已存在" };
    },
  });
  const url = new URL("http://localhost/api/remote/directories");
  await route(
    {
      method: "POST",
      body: { host: "offline", parent: "/workspace", name: "x" },
    },
    {},
    url,
  );
  assert.equal(output.status, 404);
  assert.equal(calls, 0);
  await route(
    {
      method: "POST",
      body: { host: "online", parent: "/workspace", name: "../x" },
    },
    {},
    url,
  );
  assert.equal(output.status, 400);
  assert.equal(calls, 0);
  await route(
    {
      method: "POST",
      body: { host: "online", parent: "/workspace", name: "x" },
    },
    {},
    url,
  );
  assert.equal(output.status, 400);
  assert.equal(calls, 1);
  assert.match(output.body.error, /已存在/);
});

test("remote mkdir script creates only one child and preserves existing contents", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "scope-directory-test-"));
  const name = "literal ' $(name)";
  const execute = (target) =>
    spawnSync(
      "python",
      ["-", Buffer.from(JSON.stringify(target)).toString("base64")],
      {
        input: CREATE_DIRECTORY,
        encoding: "utf8",
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      },
    );
  try {
    const result = execute({ parent, name });
    assert.equal(result.status, 0, result.stderr);
    const cwd = JSON.parse(result.stdout).cwd;
    assert.equal(cwd, path.join(parent, name));
    await writeFile(path.join(cwd, "keep.txt"), "keep");
    assert.notEqual(execute({ parent, name }).status, 0);
    assert.equal(await readFile(path.join(cwd, "keep.txt"), "utf8"), "keep");
    assert.notEqual(execute({ parent, name: "../escape" }).status, 0);
    assert.notEqual(
      execute({ parent: path.join(parent, "missing"), name: "x" }).status,
      0,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
