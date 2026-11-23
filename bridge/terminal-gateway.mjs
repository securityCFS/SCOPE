import { spawn } from "node:child_process";
import { WebSocket, WebSocketServer } from "ws";
import { normalizeTmuxSessionName } from "./tmux-session-control.mjs";
import { normalizeRemoteAbsolutePath } from "./vscode-opener.mjs";
import {
  buildRemoteTerminalCommand,
  sshTerminalArguments,
  terminalDimension,
} from "./web-terminal.mjs";

export function attachTerminalGateway({
  server,
  host,
  trustedOrigins,
  getSnapshot,
  sshTimeoutMs,
  auditLifecycle,
}) {
  const terminalWebSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 128 * 1024,
  });

  function rejectTerminalUpgrade(socket, statusCode, message) {
    const reason = String(message || "Terminal connection rejected").replace(/[\r\n]+/g, " ");
    socket.write(
      `HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.destroy();
  }

  server.on("upgrade", (request, socket, head) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url || "/", `http://${request.headers.host || host}`);
    } catch {
      rejectTerminalUpgrade(socket, 400, "Bad Request");
      return;
    }
    if (requestUrl.pathname !== "/terminal") {
      rejectTerminalUpgrade(socket, 404, "Not Found");
      return;
    }
    const origin = request.headers.origin;
    if (origin && !trustedOrigins.has(origin)) {
      rejectTerminalUpgrade(socket, 403, "Forbidden");
      return;
    }
    const targetHost = (requestUrl.searchParams.get("host") || "").trim();
    const knownHost = getSnapshot().hosts.find((candidate) => candidate.alias === targetHost);
    if (!knownHost) {
      rejectTerminalUpgrade(socket, 404, "Unknown SSH host");
      return;
    }
    let cwd = "";
    let tmuxSession = "";
    try {
      const requestedCwd = (requestUrl.searchParams.get("cwd") || "").trim();
      cwd = requestedCwd
        ? normalizeRemoteAbsolutePath(requestedCwd, "远端工作目录")
        : "";
      if (requestUrl.searchParams.get("mode") === "tmux") {
        tmuxSession = normalizeTmuxSessionName(
          requestUrl.searchParams.get("tmux") || "",
        );
      }
    } catch (error) {
      rejectTerminalUpgrade(socket, 400, error.message);
      return;
    }
    const cols = terminalDimension(requestUrl.searchParams.get("cols"), 100, 400);
    const rows = terminalDimension(requestUrl.searchParams.get("rows"), 28, 200);
    terminalWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      terminalWebSocketServer.emit("connection", webSocket, request, {
        host: targetHost,
        cwd,
        tmuxSession,
        cols,
        rows,
      });
    });
  });

  terminalWebSocketServer.on("connection", (webSocket, _request, target) => {
    const command = buildRemoteTerminalCommand({
      cwd: target.cwd,
      tmuxSession: target.tmuxSession ? `=${target.tmuxSession}` : "",
      cols: target.cols,
      rows: target.rows,
    });
    const child = spawn(
      (typeof process !== "undefined" && process.platform === "win32" ? "ssh.exe" : "ssh"),
      sshTerminalArguments({
        host: target.host,
        command,
        timeoutSeconds: Math.ceil(sshTimeoutMs / 1_000),
      }),
      {
        windowsHide: true,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      },
    );
    let closed = false;
    const send = (message) => {
      if (webSocket.readyState !== WebSocket.OPEN) return false;
      if (webSocket.bufferedAmount > 2 * 1024 * 1024) {
        webSocket.close(1013, "terminal output exceeded browser buffer");
        return false;
      }
      webSocket.send(JSON.stringify(message));
      return true;
    };
    const stopLocalSsh = () => {
      if (closed) return;
      closed = true;
      if (!child.killed) child.kill();
    };

    auditLifecycle("web-terminal-opened", {
      host: target.host,
      cwd: target.cwd,
      mode: target.tmuxSession ? "tmux" : "shell",
      tmuxSession: target.tmuxSession || null,
      remoteSessionSignalSent: false,
    });
    send({ type: "status", status: "connected" });
    child.stdout.on("data", (chunk) => send({ type: "output", data: chunk.toString("utf8") }));
    child.stderr.on("data", (chunk) => send({ type: "output", data: chunk.toString("utf8") }));
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      send({ type: "error", message: `本机 SSH 启动失败：${error.message}` });
    });
    child.on("close", (code) => {
      send({ type: "exit", code: code ?? 1 });
      if (webSocket.readyState === WebSocket.OPEN) {
        webSocket.close(1000, "ssh process exited");
      }
      closed = true;
      auditLifecycle("web-terminal-closed", {
        host: target.host,
        mode: target.tmuxSession ? "tmux" : "shell",
        code: code ?? 1,
        remoteSessionSignalSent: false,
      });
    });
    webSocket.on("message", (payload, binary) => {
      if (binary || child.stdin.destroyed) return;
      try {
        const message = JSON.parse(payload.toString("utf8"));
        if (message?.type !== "input" || typeof message.data !== "string") return;
        if (Buffer.byteLength(message.data, "utf8") > 64 * 1024) {
          send({ type: "error", message: "单次终端输入超过 64 KiB，已拒绝" });
          return;
        }
        child.stdin.write(message.data);
      } catch {
        send({ type: "error", message: "终端输入协议无效" });
      }
    });
    webSocket.on("close", stopLocalSsh);
    webSocket.on("error", stopLocalSsh);
  });

  process.once("exit", () => {
    for (const client of terminalWebSocketServer.clients) client.close(1001, "Bridge stopping");
    terminalWebSocketServer.close();
  });

  return terminalWebSocketServer;
}
