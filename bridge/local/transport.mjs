import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import WebSocket from "ws";

/** Disposable connection to a durable local writer; closing never kills Codex. */
export class LocalJsonlChild extends EventEmitter {
  constructor(endpoint) {
    super();
    this.scopeTransport = "local-websocket";
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.closed = false;
    this.ready = Promise.resolve()
      .then(endpoint)
      .then(
        ({ url, token }) =>
          new Promise((resolve, reject) => {
            if (this.closed) return reject(new Error("本机连接已关闭"));
            const socket = (this.socket = new WebSocket(url, {
              headers: { Authorization: `Bearer ${token}` },
              handshakeTimeout: 10_000,
            }));
            socket.once("open", () => {
              if (this.closed) {
                socket.close();
                reject(new Error("本机连接已关闭"));
                return;
              }
              this.heartbeat = setInterval(() => socket.ping(), 25_000);
              this.heartbeat.unref();
              resolve(socket);
            });
            socket.on("message", (data) =>
              this.stdout.write(`${data.toString().trimEnd()}\n`),
            );
            socket.on("error", reject);
            socket.once("close", () => {
              clearInterval(this.heartbeat);
              reject(new Error("本机连接已断开"));
              this.stdout.end();
              this.stderr.end();
              this.emit("exit", 0, null);
            });
          }),
      );
    this.ready.catch((error) => this.emit("error", error));
    let buffer = "";
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        buffer += chunk.toString();
        const messages = buffer.split("\n");
        buffer = messages.pop();
        this.ready.then((socket) => {
          for (const message of messages)
            if (message.trim()) socket.send(message);
          callback();
        }, callback);
      },
      final: (callback) => {
        this.kill();
        callback();
      },
    });
  }
  kill() {
    this.closed = true;
    clearInterval(this.heartbeat);
    this.socket?.close();
  }
}
