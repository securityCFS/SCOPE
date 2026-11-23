import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { beginDialogueRefresh, failDialogueRefresh } from "../lib/dialogue-refresh.js";

const sourceUrl = new URL("../components/markdown-body.tsx", import.meta.url).href;
const formulaUrl = new URL("../components/formula-preview.tsx", import.meta.url).href;
const formulaCssUrl = new URL("../components/formula-preview.css", import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === sourceUrl && specifier === "./formula-preview") return { url: formulaUrl, shortCircuit: true };
  return nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  if (url === formulaCssUrl) return { format: "module", shortCircuit: true, source: "" };
  if (url !== sourceUrl && url !== formulaUrl) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
}});
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost:3000" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MarkdownContent } = await import(sourceUrl);
hooks.deregister();
function RemoteFileLink({ children, remotePath }) { return h("button", { "data-path": remotePath }, children); }
const container = document.getElementById("root");

test("quoted paper prose containing TeX macros preserves spaces and stays outside KaTeX", async () => {
  const root = createRoot(container);
  const prose = String.raw`Without training an actor, \method{} achieves the highest success rate on all four visual manipulation datasets, whereas TD-JEPA's trained pixel actor \cite{bagatella2026td} reaches higher scores on DMC-RGB and the visual mazes (\cref{tab:zeroshot-pixels}).`;
  try {
    await act(() => root.render(h(MarkdownContent, { value: `新增：\`${prose}\``, RemoteFileLink })));
    assert.equal(container.querySelector("code").textContent, prose);
    assert.equal(container.querySelector(".katex"), null);
  } finally { await act(() => root.unmount()); }
});

for (const notation of ["![演示](/data/clip.mp4)", "[演示](/data/clip.mp4)"]) {
  test(`${notation}: snapshot refresh, loading and text append preserve the video DOM and playhead`, async () => {
    const root = createRoot(container);
    let state = { key: "gpu-box:session-a", data: { text: notation }, loading: false, error: "" };
    const render = async (extra = {}) => act(() => root.render(h(MarkdownContent, {
      value: state.data?.text || "正在读取", remoteHost: "gpu-box", remoteCwd: "/data/work",
      RemoteFileLink, ...extra,
    })));
    try {
      await render();
      const video = container.querySelector("video");
      assert.ok(video);
      video.currentTime = 12.5;
      video.volume = 0.35;
      video.playbackRate = 1.5;
      const src = video.getAttribute("src");
      for (let tick = 0; tick < 20; tick++) {
        state = beginDialogueRefresh(state, state.key);
        await render({ className: `clock-${tick}` }); // force renders past memo, too
        state = tick % 2 ? failDialogueRefresh(state, state.key, "temporary failure")
          : { ...state, loading: false, data: { text: `${notation}\n\n更新 ${tick}` } };
        await render();
        assert.equal(container.querySelector("video"), video, "polling must not replace the media node");
        assert.equal(video.getAttribute("src"), src);
        assert.equal(video.currentTime, 12.5);
        assert.equal(video.volume, 0.35);
        assert.equal(video.playbackRate, 1.5);
      }
      await act(() => video.dispatchEvent(new window.Event("error")));
      const retry = container.querySelector(".markdown-video-caption button");
      assert.ok(retry);
      await act(() => retry.click());
      assert.notEqual(container.querySelector("video"), video, "explicit retry must still reload the player");
      state = { ...state, data: { text: notation.replace("clip.mp4", "new.mp4") } };
      await render();
      assert.match(container.querySelector("video").getAttribute("src"), /new.mp4/);
    } finally { await act(() => root.unmount()); }
  });
}

test("switching sessions never displays cached content from the previous session", () => {
  const current = { key: "host:a", data: { text: "private old result" } };
  assert.equal(beginDialogueRefresh(current, "host:a").data, current.data);
  assert.equal(beginDialogueRefresh(current, "host:b").data, null);
  assert.equal(failDialogueRefresh(current, "host:b", "failed").data, null);
});


test("formula code previews, source toggle and ordinary code render through the real Markdown component", async () => {
  const root = createRoot(container);
  const formula = String.raw`\hJ(\va)=\frac{1}{2}`;
  const source = ["Inline `\\pi` and code `session_id`.", "", "```latex", formula, "```", "", "```python", String.raw`print("\pi")`, "```"].join("\n");
  try {
    await act(() => root.render(h(MarkdownContent, {value:source, RemoteFileLink})));
    assert.equal(container.querySelectorAll(".katex-display").length, 1);
    assert.equal(container.querySelectorAll(".inline-formula-code .katex").length, 1);
    assert.match(container.querySelector(".formula-note").textContent, /未提供宏定义/);
    assert.equal(container.querySelector("pre code.language-python").textContent.trim(), String.raw`print("\pi")`);
    await act(() => container.querySelector(".formula-toolbar button").click());
    assert.equal(container.querySelector(".formula-code-block pre code").textContent.trim(), formula);
    await act(() => container.querySelector(".formula-toolbar button").click());
    assert.ok(container.querySelector(".formula-code-block .katex-display"));
  } finally { await act(() => root.unmount()); }
});
