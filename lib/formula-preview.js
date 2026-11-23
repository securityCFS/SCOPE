import katex from "katex";

const OPTIONS = { trust: false, strict: "ignore", maxExpand: 300, maxSize: 20, throwOnError: true };

/** Only formula-like inline code; paths, programs and ordinary identifiers stay code. */
export function isInlineFormula(source) {
  if (!source || source.length > 1500 || /[\n;`]|[A-Za-z]:\\|(?:https?|file):/.test(source)) return false;
  // Paper prose often contains macros and braces too. Neither is evidence of math.
  if (/\\(?:cite\w*|[cCvV]?ref|label|section|subsection|caption|paragraph)\b/.test(source)) return false;
  const outsideText = source.replace(/\\(?:text\w*|operatorname|mathrm)\{[^{}]*\}/g, "").replace(/\\[A-Za-z]+/g, "");
  if (/[A-Za-z]{3,}\s+[A-Za-z]{2,}\b|[\u4e00-\u9fff]{2,}/.test(outsideText)) return false;
  if (/^\\[([]/.test(source)) return true;
  if (/\\[A-Za-z]+/.test(source)) {
    if (/[=^_{}]|\\(?:pi|alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|mu|sigma|Delta|Omega|infty)\b/.test(source)) return true;
  }
  return /^[A-Za-z]\s*=\s*[-+]?\d+(?:\.\d+)?$/.test(source);
}

export function formulaBody(source) {
  let value = source.trim().replace(/^%[^\n]*(?:\n|$)/gm, "").trim();
  for (const [start, end] of [["$$", "$$"], ["\\[", "\\]"], ["\\(", "\\)"], ["$", "$"]]) {
    if (value.startsWith(start) && value.endsWith(end)) { value = value.slice(start.length, -end.length).trim(); break; }
  }
  value = value.replace(/\\begin\{(equation\*?|displaymath)\}([\s\S]*?)\\end\{\1\}/g, "$2");
  return value.replace(/\\(begin|end)\{(?:align\*?|split)\}/g, "\\$1{aligned}").trim();
}

/** Unknown macros remain visibly spelled out, never guessed or shared across messages. */
export function renderFormula(source, displayMode = false) {
  if (source.length > 20000) return { html: "", missing: [], error: "公式过长，请查看源码" };
  const body = formulaBody(source);
  if (!body || /\\(?:documentclass|usepackage|input|include|includegraphics|href|url|html\w*)\b/.test(body)) return { html: "", missing: [], error: "此内容包含文档或非公式命令，请查看源码" };
  const macros = {};
  const missing = [];
  for (let attempt = 0; attempt <= 20; attempt++) {
    try {
      const html = katex.renderToString(body, { ...OPTIONS, displayMode, macros: { ...macros } });
      return { html, missing, error: "" };
    } catch (error) {
      const command = /Undefined control sequence:\s*(\\[A-Za-z]+)/.exec(error.message)?.[1];
      if (!command || missing.includes(command) || attempt === 20) return { html: "", missing, error: "公式语法或命令暂不支持，请查看源码" };
      missing.push(command);
      // Preserve the command's literal spelling; do not invent a mathematical meaning.
      macros[command] = `\\text{\\textbackslash ${command.slice(1)}}`;
    }
  }
  return { html: "", missing, error: "公式暂无法预览" };
}
