import vinext from "vinext";
import { defineConfig, type ViteDevServer } from "vite";
import { remoteImageResponse } from "./bridge/remote-images.mjs";
import { remoteVideoResponse } from "./bridge/remote-videos.mjs";
import { Readable } from "node:stream";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      {
        name: "scope-remote-images",
        configureServer(server: ViteDevServer) {
          server.middlewares.use(async (req, res, next) => {
            const route = req.url?.split("?")[0];
            if (route !== "/scope-image-api" && route !== "/scope-video-api") return next();
            const request = new Request(new URL(req.url || "/", `http://${req.headers.host}`), { method: req.method, headers: req.headers as Record<string, string> });
            const result = await (route === "/scope-video-api" ? remoteVideoResponse : remoteImageResponse)(request);
            res.writeHead(result.status, Object.fromEntries(result.headers));
            if (result.body) {
              const stream = Readable.fromWeb(result.body as import("node:stream/web").ReadableStream);
              res.on("close", () => stream.destroy());
              stream.on("error", () => res.destroy());
              stream.pipe(res);
            } else res.end();
          });
        },
      },
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
