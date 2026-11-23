import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { JSDOM } from "jsdom";

const source = new URL("../components/host-codex-settings.tsx", import.meta.url).href;
const hooks = registerHooks({ load(url, context, next) {
  if (url !== source) return next(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });
const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost:3000" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { HostCodexSettings } = await import(source);
hooks.deregister();
const originalFetch = globalThis.fetch;
const container = document.getElementById("root");
const job = { host: "gpu-box", action: "check", status: "completed", phase: "checking",
  results: [], info: { installed: "0.162.1", latest: "0.162.1", supported: true, executable: "/usr/bin/codex" },
  runningVersions: [{ connectionKey: "account-pro-lite", version: "0.153.4", sessions: 2, status: "connected" }] };

for (const prefix of ["http://127.0.0.1:4815", "/scope-api"]) {
  test("check and poll use the Bridge address " + prefix, async () => {
    const requests = [];
    let posted = false;
    globalThis.fetch = async (url, init) => {
      requests.push([url, init?.method || "GET"]);
      assert.ok(url.startsWith(prefix + "/api/codex/upgrade"));
      if (init?.method === "POST") { posted = true; return Response.json({ ...job, status: "running" }, { status: 202 }); }
      return Response.json(posted ? job : null);
    };
    const root = createRoot(container);
    try {
      await act(async () => root.render(h(HostCodexSettings, { host: "gpu-box", url: (path) => prefix + path })));
      await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "检查更新").click());
      assert.ok(requests.some(([, method]) => method === "POST"));
      assert.match(container.textContent, /已安装：0.162.1/);
      assert.match(container.textContent, /运行版本 0.153.4/);
      assert.match(container.textContent, /版本检查完成/);
    } finally { await act(() => root.unmount()); globalThis.fetch = originalFetch; }
  });
}
test("plain text 404 and invalid JSON surface a readable error for GET and POST", async () => {
  globalThis.fetch = async () => new Response("Not Found", { status: 404 });
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(HostCodexSettings, { host: "gpu-box", url: (path) => "/scope-api" + path })));
    assert.match(container.querySelector("[role=alert]").textContent, /更新接口未找到/);
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "检查更新").click());
    assert.match(container.querySelector("[role=alert]").textContent, /更新接口未找到/);
    assert.doesNotMatch(container.textContent, /Unexpected token/);
    globalThis.fetch = async () => new Response("<html>gateway error</html>", { status: 502 });
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "检查更新").click());
    assert.match(container.querySelector("[role=alert]").textContent, /HTTP 502/);
  } finally { await act(() => root.unmount()); globalThis.fetch = originalFetch; }
});
