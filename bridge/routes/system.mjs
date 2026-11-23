import { spawn } from "node:child_process";
import { excludeActiveSessions } from "../../lib/session-filters.js";
import { HISTORY_PROBE, VSCODE_OPEN_PREFLIGHT } from "../probes/index.mjs";
import {
  launchVscodeRemoteFile,
  normalizeRemoteAbsolutePath,
  normalizeRemoteFileTarget,
} from "../vscode-opener.mjs";

/** System health, snapshot sync, directory/VS Code helpers, and scan endpoints. */
export function systemRoutes(context) {
  return async (_request, response, url) => {
    const {
      HISTORY_TIMEOUT_MS,
      cachedHistoryResult,
      cleanSshError,
      clients,
      enrichAgentRelations,
      getSnapshot,
      historicalAgent,
      historicalSessions,
      jsonResponse,
      mapLimit,
      persistHistoryIndex,
      plugins,
      publicSnapshot,
      publishSnapshotSync,
      readJsonBody,
      runSshCommand,
      scanAll,
      sessionKey,
      shellQuote,
      snapshotSyncStore,
      updateHistoryIndex,
      appServerManager,
    } = context();

    if (url.pathname === "/api/health" && _request.method === "GET") {
      const snapshot = getSnapshot();
      const memory = process.memoryUsage();
      jsonResponse(response, 200, {
        ok: true,
        service: "scope-bridge",
        generatedAt: snapshot.generatedAt,
        scanning: snapshot.scanning,
        clients: clients.size,
        memory: {
          rssMiB: Math.round(memory.rss / 1024 / 1024),
          heapUsedMiB: Math.round(memory.heapUsed / 1024 / 1024),
        },
        sync: snapshotSyncStore.info(),
      });
      return true;
    }

    if (url.pathname === "/api/sync" && _request.method === "GET") {
      if (snapshotSyncStore.info().revision === 0) publishSnapshotSync();
      const payload = snapshotSyncStore.read({
        clientEpoch: url.searchParams.get("epoch") || "",
        since: url.searchParams.get("since"),
        fieldDeltas: url.searchParams.get("fields") === "1",
      });
      response.setHeader("Cache-Control", "no-store");
      jsonResponse(response, 200, payload);
      return true;
    }

    if (url.pathname === "/api/snapshot" && _request.method === "GET") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify(publicSnapshot()));
      return true;
    }

    if (url.pathname === "/api/refresh" && _request.method === "POST") {
      scanAll({ force: true }).catch(() => {});
      response.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ accepted: true }));
      return true;
    }

    if (url.pathname === "/api/history/cache" && _request.method === "GET") {
      const requestedHost = url.searchParams.get("host") || "all";
      const limit = Math.max(
        25,
        Math.min(300, Number(url.searchParams.get("limit")) || 100),
      );
      const requestedOrder =
        url.searchParams.get("order") === "oldest" ? "oldest" : "recent";
      jsonResponse(
        response,
        200,
        cachedHistoryResult(requestedHost, limit, requestedOrder),
      );
      return true;
    }

    if (url.pathname === "/api/vscode/open" && _request.method === "POST") {
      try {
        const snapshot = getSnapshot();
        const body = await readJsonBody(_request);
        const host = snapshot.hosts.find(
          (candidate) => candidate.alias === body.host,
        );
        if (!host?.reachable) {
          jsonResponse(response, 404, { error: "对应 SSH 主机当前不可连接" });
          return true;
        }

        const cwd = normalizeRemoteAbsolutePath(body.cwd, "远端工作目录");
        const target = normalizeRemoteFileTarget({
          file: body.file,
          line: body.line,
          column: body.column,
        });
        const file = target?.path || "";
        const preflight = await runSshCommand(
          host.alias,
          `python3 - ${shellQuote(cwd)} ${shellQuote(file)}`,
          VSCODE_OPEN_PREFLIGHT,
          15_000,
          100_000,
        );
        if (preflight.code !== 0) {
          jsonResponse(response, 400, {
            error: `无法打开 VS Code：${cleanSshError(preflight.stderr || preflight.stdout)}`,
          });
          return true;
        }

        const launched = await launchVscodeRemoteFile(
          {
            host: host.alias,
            cwd,
            file: file || undefined,
            line: target?.line,
            column: target?.column,
          },
          { spawnProcess: spawn },
        );
        jsonResponse(response, 202, {
          accepted: true,
          host: host.alias,
          cwd,
          file: file || null,
          line: target?.line || null,
          column: target?.column || null,
          command: launched.args,
        });
      } catch (error) {
        jsonResponse(response, 400, {
          error: `打开 VS Code 失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/api/submissions/scan" && _request.method === "POST") {
      try {
        const body = await readJsonBody(_request);
        jsonResponse(response, 202, plugins.invoke("aliyun-dlc", "scan", body));
      } catch (error) {
        jsonResponse(response, error.statusCode || 400, { error: error.message });
      }
      return true;
    }

    if (url.pathname === "/api/history/scan" && _request.method === "POST") {
      try {
        const snapshot = getSnapshot();
        const body = await readJsonBody(_request);
        const requestedHost =
          typeof body.host === "string" && body.host ? body.host : "all";
        const limit = Math.max(25, Math.min(300, Number(body.limit) || 100));
        const requestedOrder = body.order === "oldest" ? "oldest" : "recent";
        const targets = snapshot.hosts.filter(
          (host) =>
            host.reachable &&
            (requestedHost === "all" || host.alias === requestedHost),
        );
        if (!targets.length) {
          jsonResponse(response, 404, {
            error:
              requestedHost === "all"
                ? "当前没有可连接的 SSH 主机"
                : `主机 ${requestedHost} 当前不可连接`,
          });
          return true;
        }

        const scans = await mapLimit(
          targets,
          Math.min(4, targets.length),
          async (host) => {
            const result = await runSshCommand(
              host.alias,
              `python3 - ${limit} ${requestedOrder}`,
              HISTORY_PROBE,
              HISTORY_TIMEOUT_MS,
              8_000_000,
            );
            if (result.code !== 0) {
              return {
                host: host.alias,
                totalFiles: 0,
                truncated: false,
                sessions: [],
                error: cleanSshError(result.stderr || result.stdout),
              };
            }
            try {
              const parsed = JSON.parse(result.stdout.trim());
              const activeSessions = [
                ...host.agents,
                ...appServerManager
                  .sessionRecords()
                  .filter((session) => session.host === host.alias),
              ];
              const sessions = excludeActiveSessions(
                (parsed.sessions || []).map((rollout) =>
                  enrichAgentRelations(host, historicalAgent(host, rollout)),
                ),
                activeSessions,
              );
              for (const agent of sessions) {
                historicalSessions.set(
                  sessionKey(agent.host, agent.rollout.id),
                  agent,
                );
              }
              return {
                host: host.alias,
                totalFiles: Number(parsed.totalFiles) || 0,
                truncated: Boolean(parsed.truncated),
                sessions,
                error: null,
              };
            } catch {
              return {
                host: host.alias,
                totalFiles: 0,
                truncated: false,
                sessions: [],
                error: "远端历史扫描结果无法解析",
              };
            }
          },
        );

        const sessions = scans
          .flatMap((scan) => scan.sessions)
          .sort((a, b) => {
            const difference =
              (b.lastActivityAt || 0) - (a.lastActivityAt || 0);
            return requestedOrder === "recent" ? difference : -difference;
          });
        const scannedAt = new Date().toISOString();
        if (updateHistoryIndex(scans, requestedOrder, scannedAt)) {
          await persistHistoryIndex();
        }
        jsonResponse(response, 200, {
          ok: true,
          scope: requestedHost,
          limit,
          order: requestedOrder,
          scannedAt,
          sessions,
          hosts: scans.map(({ sessions: hostSessions, ...scan }) => ({
            ...scan,
            returned: hostSessions.length,
          })),
        });
      } catch (error) {
        jsonResponse(response, 502, {
          error: `历史 Session 扫描失败：${error.message}`,
        });
      }
      return true;
    }

    if (url.pathname === "/health") {
      const snapshot = getSnapshot();
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ ok: true, scanning: snapshot.scanning }));
      return true;
    }

    return false;
  };
}
