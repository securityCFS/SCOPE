import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { WebSocketJsonlChild } from "../bridge/app-server-websocket-transport.mjs";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

class FakeProxy extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.request = Buffer.alloc(0);
    this.frames = [];
    this.stdin.on("data", (chunk) => this.#read(chunk));
  }

  #read(chunk) {
    this.request = Buffer.concat([this.request, Buffer.from(chunk)]);
    const marker = this.request.indexOf("\r\n\r\n");
    if (marker < 0) return;
    const headers = this.request.subarray(0, marker + 4).toString("utf8");
    const key = headers.match(/Sec-WebSocket-Key:\s*([^\r\n]+)/i)?.[1]?.trim();
    this.request = this.request.subarray(marker + 4);
    const accept = createHash("sha1").update(`${key}${GUID}`).digest("base64");
    this.stdout.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    this.#frames();
    this.stdin.removeAllListeners("data");
    this.stdin.on("data", (next) => {
      this.request = Buffer.concat([this.request, Buffer.from(next)]);
      this.#frames();
    });
  }

  #frames() {
    while (this.request.length >= 6) {
      const length = this.request[1] & 0x7f;
      if (length >= 126 || this.request.length < 6 + length) return;
      const opcode = this.request[0] & 0x0f;
      const mask = this.request.subarray(2, 6);
      const payload = Buffer.from(this.request.subarray(6, 6 + length));
      this.request = this.request.subarray(6 + length);
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
      this.frames.push({ opcode, payload: payload.toString("utf8") });
    }
  }

  sendText(text) {
    const payload = Buffer.from(text);
    this.stdout.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
  }
}

test("adapts WebSocket app-server frames to the existing JSONL interface", async () => {
  const proxy = new FakeProxy();
  const child = new WebSocketJsonlChild(proxy);
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });

  child.stdin.write('{"id":1,"method":"initialize"}\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(proxy.frames[0].payload, /"initialize"/);
  assert.equal(proxy.frames[0].opcode, 1);

  proxy.sendText('{"id":1,"result":{"ok":true}}');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(output, '{"id":1,"result":{"ok":true}}\n');

  child.stdin.end();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(proxy.frames.at(-1).opcode, 8);
  assert.equal(proxy.killed, undefined);
});

test("keeps an idle proxy alive with WebSocket ping and clears it on close", async () => {
  const proxy = new FakeProxy();
  const intervals = [];
  const child = new WebSocketJsonlChild(proxy, {
    pingIntervalMs: 25,
    setIntervalFn(callback, delay) {
      const timer = { callback, delay, cleared: false, unref() {} };
      intervals.push(timer);
      return timer;
    },
    clearIntervalFn(timer) {
      timer.cleared = true;
    },
  });

  child.stdin.write('{"id":1,"method":"initialize"}\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(child.scopeTransport, "ssh-websocket");
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 25);

  intervals[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(proxy.frames.at(-1).opcode, 9);

  child.stdin.end();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(intervals[0].cleared, true);
});

