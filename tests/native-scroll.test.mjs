import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { JSDOM } from "jsdom";

const source = new URL(
  "../features/conversation/use-native-scroll.ts",
  import.meta.url,
).href;
const hooks = registerHooks({
  load(url, context, next) {
    if (url !== source) return next(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    };
  },
});
const dom = new JSDOM("<div id='root'></div>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const frames = [];
globalThis.requestAnimationFrame = (callback) => frames.push(callback);
let resize;
globalThis.ResizeObserver = class {
  constructor(callback) {
    resize = callback;
  }
  observe() {}
  disconnect() {}
};
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useNativeScroll } = await import(source);
hooks.deregister();

test("async history opens at latest, upward reading stays put, older pages retain viewport", async () => {
  let api;
  function Harness(props) {
    api = useNativeScroll(props);
    return h(
      "div",
      { ref: api.scroll, onScroll: api.onScroll },
      h("div", { ref: api.content }),
    );
  }
  const root = createRoot(document.getElementById("root"));
  let history = null;
  const render = (extra = {}) =>
    act(() =>
      root.render(
        h(Harness, {
          history,
          ready: history !== null,
          working: false,
          ...extra,
        }),
      ),
    );
  try {
    await render();
    const viewport = document.querySelector("#root > div");
    let height = 300,
      top = 0;
    Object.defineProperties(viewport, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 300 },
      scrollTop: {
        get: () => top,
        set: (value) => {
          top = Math.max(0, Math.min(value, height - 300));
        },
      },
    });
    height = 1800;
    history = { messages: ["delayed Claude history"] };
    await render();
    assert.equal(
      top,
      1500,
      "history arriving after mount must scroll to latest",
    );
    viewport.scrollTop = 400;
    await act(() => viewport.dispatchEvent(new window.Event("scroll")));
    height = 2100;
    history = { messages: ["new reply"] };
    await render();
    resize();
    assert.equal(
      top,
      400,
      "new replies and image layout must not interrupt reading",
    );
    viewport.scrollTop = 1780;
    await act(() => viewport.dispatchEvent(new window.Event("scroll")));
    // Async downward expansion that emits a scroll event before next layout must keep bottom-follow active.
    height = 2250;
    await act(() => viewport.dispatchEvent(new window.Event("scroll")));
    assert.equal(api.atBottom, true);
    height = 2300;
    resize();
    assert.equal(
      top,
      2000,
      "readers near the latest message follow layout changes",
    );
    viewport.scrollTop = 400;
    await act(() => viewport.dispatchEvent(new window.Event("scroll")));
    assert.equal(api.atBottom, false);
    viewport.scrollTop = 0;
    await act(() => viewport.dispatchEvent(new window.Event("scroll")));
    let finish;
    const loading = api.older(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render({ working: true });
    assert.equal(
      top,
      0,
      "unrelated status changes must not consume the older-page anchor",
    );
    height = 3200;
    history = { messages: ["older", "existing"] };
    await render();
    finish();
    await loading;
    frames.splice(0).forEach((callback) => callback());
    assert.equal(
      top,
      900,
      "prepending a page preserves the visible existing message",
    );
    await act(async () => {
      api.toBottom();
    });
    assert.equal(top, 2900, "sending returns to the latest message");
    assert.equal(api.atBottom, true);
  } finally {
    await act(() => root.unmount());
  }
});
