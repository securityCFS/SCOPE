import assert from "node:assert/strict";
import test from "node:test";
import { isInlineFormula, renderFormula, formulaBody } from "../lib/formula-preview.js";

test("formula code renders standard math while keeping unknown paper macros literal", () => {
  const result = renderFormula(String.raw`% Eq. (5)
\hJ(\va) - J^\pi(\va) = e(\va) + (1-\gamma)\gamma^H E_{s,\va}\Delta V(s_H).`, true);
  assert.match(result.html, /katex-display/);
  assert.deepEqual(result.missing, [String.raw`\hJ`, String.raw`\va`]);
  assert.equal(result.error, "");
  assert.match(result.html, /<mtext>\\va<\/mtext>/);
});

test("inline detection preserves programming code, prose and file paths", () => {
  for (const source of ["session_id", "npm run dev", String.raw`C:\new\file.tex`, String.raw`\n`, "const x=1;", "s"]) assert.equal(isInlineFormula(source), false, source);
  for (const source of [String.raw`\pi`, String.raw`e(\va):=\widehat{J}(\va)-J^\beta(\va)`, "H=8"]) assert.equal(isInlineFormula(source), true, source);
});

test("paper sentences with macros remain literal while math text stays renderable", () => {
  for (const source of [String.raw`Without training an actor, \method{} achieves the highest success rate on all four visual manipulation datasets, whereas TD-JEPA's trained pixel actor \cite{bagatella2026td} reaches higher scores on DMC-RGB and the visual mazes (\cref{tab:zeroshot-pixels}).`,
    String.raw`Our \method{} achieves the best score.`, String.raw`use \pi for the new policy`, String.raw`将策略设为 \pi`]) assert.equal(isInlineFormula(source), false, source);
  assert.equal(isInlineFormula(String.raw`\text{Without training an actor} + x^2`), true);
  assert.equal(isInlineFormula(String.raw`e(\va)=\widehat{J}(\va)-J^\beta(\va)`), true);
});

test("delimiters, comments and equation environments are usable in fenced previews", () => {
  assert.equal(formulaBody(String.raw`\[x^2\]`), "x^2");
  assert.equal(formulaBody("% Eq. (6)\n\\eta = 1"), String.raw`\eta = 1`);
  const result = renderFormula(String.raw`\begin{align*}x&=1\\y&=2\end{align*}`, true);
  assert.equal(result.error, "");
  assert.match(result.html, /mtable/);
});

test("explicit macro definitions render but cannot leak into another formula", () => {
  const defined = renderFormula(String.raw`\gdef\va{\mathbf{a}}\va`);
  assert.deepEqual(defined.missing, []);
  assert.deepEqual(renderFormula(String.raw`\va`).missing, [String.raw`\va`]);
});

test("invalid, document and unsafe content stays source rather than becoming HTML", () => {
  for (const source of [String.raw`\frac{a`, String.raw`\documentclass{article}`, String.raw`\href{javascript:alert(1)}{bad}`, String.raw`\includegraphics{https://example.com/a}`, "x".repeat(20001)]) {
    const result = renderFormula(source, true);
    assert.equal(result.html, "");
    assert.ok(result.error);
  }
  const escaped=renderFormula(String.raw`\text{<script>alert(1)</script>}`);
  assert.doesNotMatch(escaped.html, /<script>/);
});
