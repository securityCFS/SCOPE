import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { JSDOM } from "jsdom";

const source = new URL("../features/workspace/hooks/snapshot-connection.ts", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/features/workspace/shared") return { shortCircuit: true, url: 'data:text/javascript,export const bridgeUrl = p => p;' };
    if (specifier.startsWith("@/lib/")) return { shortCircuit: true, url: new URL("../lib/" + specifier.slice(6) + ".js", import.meta.url).href };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== source) return next(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
  },
});
const dom = new JSDOM("<div id='root'></div>");
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useSnapshotConnection } = await import(source);
hooks.deregister();

test("reconnecting preserves the previous snapshot and manual retry does not reload the page", async () => {
  let source, state, snapshot;
  const setSource = (instance) => { source = instance; };
  globalThis.EventSource = class {
    constructor() { setSource(this); }
    close() { this.closed = true; }
  };
  const originalFetch = globalThis.fetch;
  let fail = false, revision = 1, requests = 0;
  globalThis.fetch = async () => {
    requests++;
    if (fail) throw new Error("connection interrupted");
    return Response.json({ protocol: 1, epoch: "test", revision, reset: true,
      overview: { generatedAt: `revision-${revision}`, hosts: [] }, gpuUsage: {}, submissionTracker: {} });
  };
  function Harness() {
    const [value, setSnapshot] = useState(null);
    const [connection, setBridgeState] = useState("connecting");
    useSnapshotConnection({ setSnapshot, setBridgeState });
    snapshot = value; state = connection;
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(h(Harness)));
    assert.equal(state, "connected");
    fail = true;
    await act(async () => { source.onerror(); window.dispatchEvent(new dom.window.Event("scope:reconnect")); });
    assert.equal(state, "offline");
    assert.equal(snapshot.generatedAt, "revision-1");
    fail = false; revision = 2;
    await act(async () => window.dispatchEvent(new dom.window.Event("scope:reconnect")));
    assert.equal(state, "connected");
    assert.equal(snapshot.generatedAt, "revision-2");
    revision = 3;
    await act(async () => source.onopen());
    assert.equal(snapshot.generatedAt, "revision-3");
  } finally { await act(() => root.unmount()); globalThis.fetch = originalFetch; }
  const count = requests;
  window.dispatchEvent(new dom.window.Event("scope:reconnect"));
  assert.equal(requests, count);
  assert.equal(source.closed, true);
});
