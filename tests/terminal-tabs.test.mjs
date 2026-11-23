import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { JSDOM } from "jsdom";

const source = new URL("../app/components/ssh-terminal.tsx", import.meta.url).href;
const child = new URL("../app/components/ssh-terminal-session.tsx", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "./ssh-terminal-session") return { url: child, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === child) return { format: "module", shortCircuit: true, source: `
      import { useEffect, createElement } from 'react';
      export const lifecycle = [];
      export function SshTerminalSession({ target, active }) {
        useEffect(() => { lifecycle.push(['open', target.host]); return () => { lifecycle.push(['close', target.host]); }; }, []);
        return createElement('span', null, target.host);
      }` };
    if (url !== source) return next(url, context);
    return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
  },
});
const dom = new JSDOM("<div id='root'></div>");
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SshTerminalPanel } = await import(source);
const { lifecycle } = await import(child);
hooks.deregister();

test("terminal tabs preserve connections when switching, changing theme, and opening another project", async () => {
  const container = document.getElementById("root"); const root = createRoot(container);
  const target = { host: "lab", cwd: "/work", tmuxSession: "" };
  let closed = 0;
  const render = (t = target, uiTheme = "light") => root.render(h(SshTerminalPanel, { target: t, uiTheme, onClose: () => closed++ }));
  const click = async (label) => act(() => container.querySelector(`[aria-label='${label}']`).click());
  try {
    await act(() => render());
    await click("新建终端");
    await act(() => container.querySelector("[role=tab]").click());
    await act(() => render(target, "dark"));
    assert.equal(container.querySelectorAll("[role=tab]").length, 2);
    assert.deepEqual(lifecycle, [["open", "lab"], ["open", "lab"]]);
    const second = { host: "other", cwd: "/elsewhere", tmuxSession: "" };
    await act(() => render(second));
    assert.equal(container.querySelectorAll("[role=tab]").length, 3);
    assert.deepEqual(lifecycle.at(-1), ["open", "other"]);
    await click("关闭终端 2");
    assert.match(container.querySelector('[role=tab][aria-selected="true"]').textContent, /3/);
    await click("关闭终端 3");
    assert.match(container.querySelector('[role=tab][aria-selected="true"]').textContent, /1/);
    assert.equal(lifecycle.filter(([v]) => v === "close").length, 2);
    await click("关闭终端 1");
    assert.equal(closed, 1);
  } finally { await act(() => root.unmount()); }
  assert.equal(lifecycle.filter(([v]) => v === "close").length, 3);
});
