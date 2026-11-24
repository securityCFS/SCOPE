import { createReadStream } from "node:fs";
import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listRemoteDirectories } from "./remote-directory-listing.mjs";
import { remoteImageResponse } from "./remote-images.mjs";
import { remoteVideoResponse } from "./remote-videos.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_CLIENT_DIR = fileURLToPath(new URL("../dist/client/", import.meta.url));
const DEFAULT_WORKER_ENTRY = fileURLToPath(
  new URL("../dist/server/index.js", import.meta.url),
);

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
]);

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function safeAssetPath(clientDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, "");
  if (!relative || relative.split("/").some((segment) => segment.startsWith("."))) {
    return null;
  }
  const root = path.resolve(clientDir);
  const candidate = path.resolve(root, relative);
  return candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

async function assetResponse(clientDir, request) {
  const url = new URL(request.url);
  const filename = safeAssetPath(clientDir, url.pathname);
  if (!filename) return new Response("Not found", { status: 404 });
  let details;
  try {
    details = await stat(filename);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!details.isFile()) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type":
      CONTENT_TYPES.get(path.extname(filename).toLowerCase()) ||
      "application/octet-stream",
    "Content-Length": String(details.size),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": url.pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  const body =
    request.method === "HEAD"
      ? null
      : Readable.toWeb(createReadStream(filename));
  return new Response(body, { status: 200, headers });
}

function webRequest(request, host) {
  const init = {
    method: request.method,
    headers: request.headers,
  };
  if (!["GET", "HEAD"].includes(request.method || "GET")) {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }
  return new Request(new URL(request.url || "/", `http://${host}`), init);
}

async function sendWebResponse(response, target) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  target.writeHead(response.status, headers);
  if (!response.body) {
    target.end();
    return;
  }
  const stream = Readable.fromWeb(response.body);
  target.once("close", () => stream.destroy());
  stream.once("error", () => target.destroy());
  stream.pipe(target);
}

async function snapshotProductionBuild(clientDir, workerEntry) {
  const runtimeRoot = await mkdtemp(
    path.join(os.tmpdir(), "scope-ui-runtime-"),
  );
  const runtimeClientDir = path.join(runtimeRoot, "client");
  const runtimeServerDir = path.join(runtimeRoot, "server");
  try {
    await Promise.all([
      cp(clientDir, runtimeClientDir, { recursive: true }),
      cp(path.dirname(workerEntry), runtimeServerDir, { recursive: true }),
    ]);
    return {
      root: runtimeRoot,
      clientDir: runtimeClientDir,
      workerEntry: path.join(runtimeServerDir, path.basename(workerEntry)),
    };
  } catch (error) {
    await rm(runtimeRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function startProductionUiServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  clientDir = DEFAULT_CLIENT_DIR,
  workerEntry = DEFAULT_WORKER_ENTRY,
  directoryLister = listRemoteDirectories,
} = {}) {
  // A vinext build replaces hashed assets in dist in place. Keep the worker and
  // client assets from one build in a private runtime snapshot so a background
  // build cannot leave the running server's HTML pointing at deleted files.
  const runtime = await snapshotProductionBuild(clientDir, workerEntry);
  const workerUrl = pathToFileURL(runtime.workerEntry);
  workerUrl.searchParams.set("scope-ui", `${process.pid}-${Date.now()}`);
  let worker;
  try {
    ({ default: worker } = await import(workerUrl.href));
  } catch (error) {
    await rm(runtime.root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const server = createServer(async (request, response) => {
    try {
      const incoming = webRequest(request, request.headers.host || `${host}:${port}`);
      const incomingUrl = new URL(incoming.url);
      if (incomingUrl.pathname === "/scope-video-api") {
        await sendWebResponse(await remoteVideoResponse(incoming), response);
        return;
      }
      if (incomingUrl.pathname === "/scope-image-api") {
        await sendWebResponse(await remoteImageResponse(incoming), response);
        return;
      }
      if (incomingUrl.pathname === "/scope-directory-api") {
        if (incoming.method !== "GET") {
          await sendWebResponse(
            Response.json({ error: "只允许读取远端目录" }, { status: 405 }),
            response,
          );
          return;
        }
        try {
          const listing = await directoryLister({
            host: incomingUrl.searchParams.get("host") || "",
            requestedPath: incomingUrl.searchParams.get("path") || "/",
          });
          await sendWebResponse(Response.json(listing), response);
        } catch (error) {
          await sendWebResponse(
            Response.json(
              { error: error instanceof Error ? error.message : String(error) },
              { status: 400 },
            ),
            response,
          );
        }
        return;
      }
      const directAsset = await assetResponse(runtime.clientDir, incoming);
      if (directAsset.status !== 404) {
        await sendWebResponse(directAsset, response);
        return;
      }
      const rendered = await worker.fetch(
        incoming,
        {
          ASSETS: {
            fetch: (assetRequest) =>
              assetResponse(runtime.clientDir, assetRequest),
          },
        },
        {
          waitUntil() {},
          passThroughOnException() {},
        },
      );
      const customBridgePort = Number(process.env.SCOPE_BRIDGE_PORT || 4815);
      const contentType = rendered.headers.get("content-type") || "";
      if (
        Number.isInteger(customBridgePort) &&
        customBridgePort !== 4815 &&
        contentType.includes("text/html")
      ) {
        const html = await rendered.text();
        const injected = html.replace(
          /<head(\b[^>]*)>/i,
          `<head$1><meta name="scope-bridge-url" content="http://127.0.0.1:${customBridgePort}">`,
        );
        const headers = new Headers(rendered.headers);
        headers.delete("content-length");
        await sendWebResponse(new Response(injected, { status: rendered.status, headers }), response);
        return;
      }
      await sendWebResponse(rendered, response);
    } catch (error) {
      console.error(`[scope-ui] ${error instanceof Error ? error.stack : error}`);
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      response.end("SCOPE UI failed to render");
    }
  });
  server.once("close", () => {
    rm(runtime.root, { recursive: true, force: true }).catch(() => {});
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    await rm(runtime.root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return server;
}

if (pathToFileURL(process.argv[1] || "").href === import.meta.url) {
  const host = argumentValue("--hostname", DEFAULT_HOST);
  const port = Number(argumentValue("--port", String(DEFAULT_PORT)));
  const server = await startProductionUiServer({ host, port });
  console.log(`[scope-ui] Production server running at http://${host}:${port}`);
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
