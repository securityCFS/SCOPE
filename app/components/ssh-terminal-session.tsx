"use client";

import "@xterm/xterm/css/xterm.css";
import { RefreshCw, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Terminal as XtermTerminal } from "@xterm/xterm";

import type { SshTerminalTarget } from "./ssh-terminal";
import type { FitAddon } from "@xterm/addon-fit";

function terminalTheme(theme: "dark" | "light") {
  return theme === "light"
    ? { background: "#ffffff", foreground: "#303030", cursor: "#555555", selectionBackground: "#d8e3ec" }
    : { background: "#202020", foreground: "#ececea", cursor: "#ececea", selectionBackground: "#454545" };
}

function terminalSocketUrl(
  target: SshTerminalTarget,
  mode: "shell" | "tmux",
  cols: number,
  rows: number,
) {
  const parameters = new URLSearchParams({
    host: target.host,
    cwd: target.cwd,
    mode,
    cols: String(cols),
    rows: String(rows),
  });
  if (mode === "tmux" && target.tmuxSession) {
    parameters.set("tmux", target.tmuxSession);
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(
    window.location.hostname,
  );
  if (local) return `ws://127.0.0.1:4815/terminal?${parameters}`;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/scope-api/terminal?${parameters}`;
}

export function SshTerminalSession({
  target,
  uiTheme,
  active,
  mode,
}: {
  target: SshTerminalTarget;
  uiTheme: "dark" | "light";
  active: boolean;
  mode: "shell" | "tmux";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const themeRef = useRef(uiTheme);
  const activeRef = useRef(active);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<
    "connecting" | "connected" | "closed" | "error"
  >("connecting");

  const targetHost = target.host;
  const targetCwd = target.cwd;
  const targetTmuxSession = target.tmuxSession;
  const activeMode = mode === "tmux" && targetTmuxSession ? "tmux" : "shell";

  useEffect(() => {
    themeRef.current = uiTheme;
    if (terminalRef.current) terminalRef.current.options.theme = terminalTheme(uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    activeRef.current = active;
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let inputDisposable: { dispose(): void } | null = null;
    let resizeFrame = 0;
    const container = containerRef.current;
    if (!container) return;

    async function connect() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !containerRef.current) return;
      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        convertEol: false,
        fontFamily:
          '"Cascadia Code", "JetBrains Mono", "SFMono-Regular", Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 10_000,
        allowProposedApi: false,
        theme: terminalTheme(themeRef.current),
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(containerRef.current);
      fitRef.current = fit;
      if (activeRef.current) { fit.fit(); terminal.focus(); }
      terminalRef.current = terminal;
      terminal.writeln(
        `\x1b[38;5;110mSCOPE\x1b[0m connecting to ${targetHost}…`,
      );

      const socket = new WebSocket(
        terminalSocketUrl(
          {
            host: targetHost,
            cwd: targetCwd,
            tmuxSession: targetTmuxSession,
          },
          activeMode,
          terminal.cols,
          terminal.rows,
        ),
      );
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (disposed) return;
        setStatus("connected");
        inputDisposable = terminal.onData((data) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "input", data }));
          }
        });
      });
      socket.addEventListener("message", (event) => {
        if (disposed || typeof event.data !== "string") return;
        try {
          const message = JSON.parse(event.data) as {
            type?: string;
            data?: string;
            message?: string;
            code?: number;
          };
          if (message.type === "output" && message.data) {
            terminal.write(message.data);
          } else if (message.type === "error") {
            setStatus("error");
            terminal.writeln(`\r\n\x1b[31m${message.message || "SSH terminal error"}\x1b[0m`);
          } else if (message.type === "exit") {
            setStatus(message.code === 0 ? "closed" : "error");
            terminal.writeln(
              `\r\n\x1b[38;5;244mSSH connection closed (code ${message.code ?? "?"})\x1b[0m`,
            );
          }
        } catch {
          terminal.write(event.data);
        }
      });
      socket.addEventListener("close", () => {
        if (!disposed) setStatus((current) => (current === "error" ? current : "closed"));
      });
      socket.addEventListener("error", () => {
        if (!disposed) setStatus("error");
      });

      resizeObserver = new ResizeObserver(() => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          if (disposed || !activeRef.current || !container?.clientWidth || !container?.clientHeight) return;
          try {
            fit.fit();
          } catch {
            // The panel can briefly have zero dimensions while closing.
          }
        });
      });
      resizeObserver.observe(containerRef.current);
    }

    setStatus("connecting");
    void connect().catch((error) => {
      if (disposed) return;
      setStatus("error");
      terminalRef.current?.writeln(
        `\r\n\x1b[31m无法初始化网页终端：${String(error)}\x1b[0m`,
      );
    });
    return () => {
      disposed = true;
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      inputDisposable?.dispose();
      socketRef.current?.close(1000, "terminal panel closed");
      socketRef.current = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      container.replaceChildren();
    };
  }, [
    activeMode,
    revision,
    targetCwd,
    targetHost,
    targetTmuxSession,
  ]);

  return (
    <section
      className="ssh-terminal-session"
      hidden={!active}
    >
      <header>
        <div className="ssh-terminal-title">
          <SquareTerminal size={15} />
          <strong>{target.host}</strong>
          <span title={target.cwd}>{target.cwd || "~"}</span>
          <i className={`terminal-status is-${status}`}>
            {status === "connecting"
              ? "连接中"
              : status === "connected"
                ? "已连接"
                : status === "error"
                  ? "连接错误"
                  : "已断开"}
          </i>
        </div>
        <div className="ssh-terminal-actions">
          <button
            type="button"
            aria-label="重新连接 SSH 终端"
            title="重新连接"
            onClick={() => setRevision((current) => current + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>
      <div className="ssh-terminal-canvas" ref={containerRef} />
    </section>
  );
}
