import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { startProductionUiServer } from "../bridge/ui-server.mjs";

test("production UI serves every rendered CSS and JavaScript asset", async (t) => {
  const sourceClient = new URL("../dist/client/", import.meta.url);
  const sourceServer = new URL("../dist/server/", import.meta.url);
  const buildCopy = await mkdtemp(path.join(tmpdir(), "scope-ui-source-"));
  const clientDir = path.join(buildCopy, "client");
  const serverDir = path.join(buildCopy, "server");
  await Promise.all([
    cp(sourceClient, clientDir, { recursive: true }),
    cp(sourceServer, serverDir, { recursive: true }),
  ]);
  const server = await startProductionUiServer({
    port: 0,
    clientDir,
    workerEntry: path.join(serverDir, "index.js"),
    directoryLister: async ({ host, requestedPath }) => ({
      host,
      cwd: requestedPath,
      parent: "/workspace",
      directories: [
        { name: "project-a", path: `${requestedPath}/project-a` },
      ],
      truncated: false,
    }),
  });
  t.after(
    async () => {
      await new Promise((resolve) => {
        server.close(resolve);
      });
      await rm(buildCopy, { recursive: true, force: true });
    },
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  // Simulate a new build replacing dist while this process keeps serving the
  // old worker. The private runtime snapshot must remain self-consistent.
  await rm(buildCopy, { recursive: true, force: true });
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:href|src)="([^"]+\.(?:css|js))"/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  assert.ok(assets.length >= 2);

  const directoryResponse = await fetch(
    `${origin}/scope-directory-api?host=gpu-box&path=${encodeURIComponent(
      "/workspace/research",
    )}`,
  );
  assert.equal(directoryResponse.status, 200);
  const directoryListing = await directoryResponse.json();
  assert.equal(directoryListing.host, "gpu-box");
  assert.equal(directoryListing.cwd, "/workspace/research");
  assert.deepEqual(directoryListing.directories, [
    {
      name: "project-a",
      path: "/workspace/research/project-a",
    },
  ]);

  for (const asset of assets) {
    const assetResponse = await fetch(new URL(asset, origin));
    assert.equal(assetResponse.status, 200, asset);
    const type = assetResponse.headers.get("content-type") || "";
    if (asset.endsWith(".css")) assert.match(type, /^text\/css\b/);
    if (asset.endsWith(".js")) assert.match(type, /javascript/);
    assert.ok((await assetResponse.arrayBuffer()).byteLength > 0, asset);
  }
});
