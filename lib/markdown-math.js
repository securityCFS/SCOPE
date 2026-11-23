const CODE_TOKEN_PREFIX = "\uE000SCOPE_CODE_";
const CODE_TOKEN_SUFFIX = "\uE001";

function protectCode(source) {
  const protectedCode = [];
  const protect = (value) => {
    const index = protectedCode.push(value) - 1;
    return `${CODE_TOKEN_PREFIX}${index}${CODE_TOKEN_SUFFIX}`;
  };

  // Shield fenced blocks first, then inline code spans. LaTeX-looking examples in
  // code must stay literal instead of turning into rendered equations.
  const withoutFences = source.replace(
    /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?\n[ \t]{0,3}\2[ \t]*(?=\n|$)|$)/g,
    protect,
  );
  const withoutCode = withoutFences.replace(/(`+)([\s\S]*?)\1/g, protect);

  return {
    value: withoutCode,
    restore(value) {
      return value.replace(
        new RegExp(`${CODE_TOKEN_PREFIX}(\\d+)${CODE_TOKEN_SUFFIX}`, "g"),
        (_match, index) => protectedCode[Number(index)] ?? "",
      );
    },
  };
}

function normalizeMathEnvironments(value) {
  return value.replace(
    /(?<!\\)\\begin\{(equation\*?|displaymath|align\*?|aligned|gather\*?|gathered|multline\*?|split)\}([\s\S]*?)\\end\{\1\}/g,
    (_match, environment, body) => {
      const content = body.trim();
      let displayContent = content;

      if (/^align\*?$/.test(environment) || environment === "aligned" || environment === "split") {
        displayContent = `\\begin{aligned}\n${content}\n\\end{aligned}`;
      } else if (/^gather\*?$/.test(environment) || environment === "gathered") {
        displayContent = `\\begin{gathered}\n${content}\n\\end{gathered}`;
      } else if (/^multline\*?$/.test(environment)) {
        displayContent = `\\begin{aligned}\n${content}\n\\end{aligned}`;
      }

      return `\n\n$$\n${displayContent}\n$$\n\n`;
    },
  );
}

/**
 * Make the LaTeX delimiters commonly emitted by Codex compatible with
 * remark-math, while leaving fenced and inline code untouched.
 *
 * @param {string} source
 * @returns {string}
 */
export function normalizeLatexDelimiters(source) {
  if (!source || !source.includes("\\")) {
    return source;
  }

  const protectedSource = protectCode(source);
  let normalized = normalizeMathEnvironments(protectedSource.value);

  normalized = normalized.replace(
    /(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g,
    (_match, body) => `\n\n$$\n${body.trim()}\n$$\n\n`,
  );
  normalized = normalized.replace(
    /(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g,
    (_match, body) => `$${body.trim()}$`,
  );

  return protectedSource.restore(normalized);
}
