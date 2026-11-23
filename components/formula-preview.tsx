"use client";
import { useMemo, useState } from "react";
import { renderFormula } from "../lib/formula-preview.js";
import "./formula-preview.css";

export function FormulaCodeBlock({ source }: { source: string }) {
  const [showSource, setShowSource] = useState(false);
  const result = useMemo(() => renderFormula(source, true), [source]);
  return <div className="formula-code-block">
    <div className="formula-toolbar"><span>公式</span>
      {result.html && <button type="button" onClick={() => setShowSource(value => !value)} aria-pressed={showSource}>{showSource ? "显示公式" : "查看源码"}</button>}
    </div>
    {showSource || !result.html ? <pre><code>{source}</code></pre> : <div className="formula-preview" dangerouslySetInnerHTML={{ __html: result.html }} />}
    {result.error && <small className="formula-note">{result.error}</small>}
    {!!result.missing.length && <small className="formula-note">未提供宏定义，保留原名：{result.missing.join("、")}</small>}
  </div>;
}
export function InlineFormulaCode({ source }: { source: string }) {
  const result = useMemo(() => renderFormula(source), [source]);
  if (!result.html) return <code>{source}</code>;
  return <span className="inline-formula-code" title={`${source}${result.missing.length ? `（未定义命令保留原名：${result.missing.join("、")}）` : ""}`} dangerouslySetInnerHTML={{ __html: result.html }} />;
}
