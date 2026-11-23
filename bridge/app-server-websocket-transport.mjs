import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function frame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const mask = randomBytes(4);
  let header;
  if (body.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | body.length;
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  header[0] = 0x80 | opcode;
  const masked = Buffer.alloc(body.length);
  for (let index = 0; index < body.length; index += 1) {
    masked[index] = body[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

export class WebSocketJsonlChild extends EventEmitter {
  constructor(
    child,
    {
      path = "/",
      host = "localhost",
      pingIntervalMs = 25_000,
      setIntervalFn = setInterval,
      clearIntervalFn = clearInterval,
    } = {},
  ) {
    super();
    this.child = child;
    this.stdout = new PassThrough();
    this.stderr = child.stderr;
    this.killed = false;
    this.ready = false;
    this.closed = false;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.pendingWrites = [];
    this.pingIntervalMs = Math.max(0, Number(pingIntervalMs) || 0);
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.pingTimer = null;
    // Lets JsonlAppServerConnection distinguish this disposable SSH/WebSocket
    // bridge from an actual remote app-server process exit.
    this.scopeTransport = "ssh-websocket";
    this.key = randomBytes(16).toString("base64");
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        try {
          const payload = Buffer.from(chunk);
          if (this.ready) this.child.stdin.write(frame(0x1, payload));
          else this.pendingWrites.push(payload);
          callback();
        } catch (error) {
          callback(error);
        }
      },
      final: (callback) => {
        try {
          this.#stopHeartbeat();
          if (!this.child.stdin.destroyed) {
            if (this.ready) this.child.stdin.write(frame(0x8));
            this.child.stdin.end();
          }
          callback();
        } catch (error) {
          callback(error);
        }
      },
    });
    child.stdout.on("data", (chunk) => this.#read(chunk));
    child.once("error", (error) => this.emit("error", error));
    child.once("exit", (code, signal) => {
      this.#stopHeartbeat();
      this.closed = true;
      this.stdout.end();
      this.emit("exit", code, signal);
    });
    child.stdin.on("error", (error) => this.stdin.destroy(error));
    const request = [
      `GET ${path} HTTP/1.1`,
      `Host: ${host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${this.key}`,
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\r\n");
    child.stdin.write(request);
  }

  kill() {
    // Compatibility with ChildProcess consumers. This intentionally closes the
    // proxy stream instead of signalling the durable remote app-server.
    this.killed = true;
    this.#stopHeartbeat();
    this.stdin.end();
  }

  #read(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    if (!this.ready) {
      const marker = this.buffer.indexOf("\r\n\r\n");
      if (marker < 0) return;
      const response = this.buffer.subarray(0, marker + 4).toString("utf8");
      this.buffer = this.buffer.subarray(marker + 4);
      const status = response.split("\r\n", 1)[0] || "";
      const accept = response.match(/\r\nsec-websocket-accept:\s*([^\r\n]+)/i)?.[1]?.trim();
      const expected = createHash("sha1")
        .update(`${this.key}${WEBSOCKET_GUID}`)
        .digest("base64");
      if (!/^HTTP\/1\.[01] 101\b/.test(status) || accept !== expected) {
        this.emit(
          "error",
          new Error(`app-server WebSocket 握手失败：${status || "无响应"}`),
        );
        return;
      }
      this.ready = true;
      this.#startHeartbeat();
      for (const payload of this.pendingWrites.splice(0)) {
        this.child.stdin.write(frame(0x1, payload));
      }
    }
    this.#drainFrames();
  }

  #drainFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const wide = this.buffer.readBigUInt64BE(2);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.emit("error", new Error("app-server WebSocket 帧过大"));
          return;
        }
        length = Number(wide);
        offset = 10;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      const mask = masked
        ? Buffer.from(this.buffer.subarray(maskOffset, maskOffset + 4))
        : null;
      let payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }
      if (opcode === 0x8) {
        this.#stopHeartbeat();
        if (!this.child.stdin.destroyed) this.child.stdin.end(frame(0x8));
        continue;
      }
      if (opcode === 0x9) {
        if (!this.child.stdin.destroyed) this.child.stdin.write(frame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1) this.fragments = [payload];
      else if (opcode === 0x0) this.fragments.push(payload);
      else continue;
      if (fin) {
        this.stdout.write(Buffer.concat(this.fragments));
        this.stdout.write("\n");
        this.fragments = [];
      }
    }
  }

  #startHeartbeat() {
    if (this.pingTimer || !this.ready || this.closed || !this.pingIntervalMs) {
      return;
    }
    this.pingTimer = this.setIntervalFn(() => {
      if (!this.ready || this.closed || this.child.stdin.destroyed) return;
      try {
        this.child.stdin.write(frame(0x9));
      } catch {
        // The child exit/error handlers surface the real disconnect.
      }
    }, this.pingIntervalMs);
    this.pingTimer?.unref?.();
  }

  #stopHeartbeat() {
    if (!this.pingTimer) return;
    this.clearIntervalFn(this.pingTimer);
    this.pingTimer = null;
  }
}
