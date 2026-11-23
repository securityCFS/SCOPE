import { spawn } from "node:child_process";
import { JsonlAppServerConnection } from "../bridge/app-server-client.mjs";

const executable = process.argv[2];
if (!executable) {
  console.error("usage: node tests/real-app-server-smoke.mjs <codex-binary>");
  process.exit(2);
}

const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const connection = new JsonlAppServerConnection({
  host: "local-smoke",
  child,
  requestTimeoutMs: 15_000,
});

try {
  const serverInfo = await connection.start();
  const threads = await connection.request("thread/list", {
    limit: 1,
    sortKey: "updated_at",
    sortDirection: "desc",
    useStateDbOnly: true,
  });
  const models = await connection.request("model/list", {});
  console.log(
    JSON.stringify({
      userAgent: serverInfo.userAgent,
      platformOs: serverInfo.platformOs,
      threadCount: threads.data.length,
      nextCursor: Boolean(threads.nextCursor),
      models: models.data.slice(0, 6).map((model) => model.id),
    }),
  );
} finally {
  connection.close();
}
