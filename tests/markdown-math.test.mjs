import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { normalizeLatexDelimiters } from "../lib/markdown-math.js";

function renderMarkdown(source) {
  return renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] },
      normalizeLatexDelimiters(source),
    ),
  );
}

test("renders inline markdown math with KaTeX", () => {
  const html = renderMarkdown("reward $z_t = f(s_t)$ works");

  assert.match(html, /class="katex"/);
  assert.match(html, /z_t/);
});

test("renders Codex-style LaTeX delimiters and multiline display math", () => {
  const source = String.raw`令历史为：

\[
h_t=(o_{\le t},a_{<t}),\qquad z_t=E(h_t)
\]

等价关系为 \(h \sim h'\)：

\[
h \sim h' \iff \forall \mathbf a,\ \forall q\in\mathcal Q,\quad
P(Y_q\mid h,do(\mathbf a)) = P(Y_q\mid h',do(\mathbf a))
\]`;
  const html = renderMarkdown(source);

  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 2);
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /\\\[|\\\]|\\\(|\\\)/);
});

test("renders common equation environments", () => {
  const source = String.raw`\begin{align*}
z_t &= E(h_t) \\
q_t &= Q(z_t)
\end{align*}`;
  const html = renderMarkdown(source);

  assert.match(html, /class="katex-display"/);
  assert.match(html, /mtable/);
});

test("does not normalize LaTeX delimiters inside code", () => {
  const source = [
    "Inline: `\\(x+y\\)`",
    "",
    "```tex",
    "\\[x+y\\]",
    "```",
  ].join("\n");
  const normalized = normalizeLatexDelimiters(source);

  assert.equal(normalized, source);
});
