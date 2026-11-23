"use client";
import { useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { renderFormula } from "../lib/formula-preview.js";
import "./formula-preview.css";

export function FormulaCodeBlock({ source }: { source: string }) {
  const { locale, tr } = useLocale();
  const [showSource, setShowSource] = useState(false);
  const result = useMemo(() => renderFormula(source, true), [source]);
  const sep = locale === "en" ? ", " : "、";
  return <div className="formula-code-block">
    <div className="formula-toolbar"><span>{tr("公式", "Math")}</span>
      {result.html && <button type="button" onClick={() => setShowSource(value => !value)} aria-pressed={showSource}>{showSource ? tr("显示公式", "Preview") : tr("查看源码", "Source")}</button>}
    </div>
    {showSource || !result.html ? <pre><code>{source}</code></pre> : <div className="formula-preview" dangerouslySetInnerHTML={{ __html: result.html }} />}
    {result.error && <small className="formula-note">{result.error}</small>}
    {!!result.missing.length && <small className="formula-note">{tr("未提供宏定义，保留原名：", "Undefined macros kept as-is: ")}{result.missing.join(sep)}</small>}
  </div>;
}
export function InlineFormulaCode({ source }: { source: string }) {
  const { locale, tr } = useLocale();
  const result = useMemo(() => renderFormula(source), [source]);
  if (!result.html) return <code>{source}</code>;
  const sep = locale === "en" ? ", " : "、";
  return <span className="inline-formula-code" title={`${source}${result.missing.length ? tr(`（未定义命令保留原名：${result.missing.join(sep)}）`, ` (undefined macros kept: ${result.missing.join(sep)})`) : ""}`} dangerouslySetInnerHTML={{ __html: result.html }} />;
}
