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

function basenameFromFileUrl(uri) {
  const withoutHash = uri.split("#", 1)[0].split("?", 1)[0];
  const raw = withoutHash.split("/").filter(Boolean).pop() || uri;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Normalize AGY / HTML-style file:// media and links outside code blocks so
 * react-markdown parses spaces in file:// targets, simple <img>/<video> tags,
 * and bare file:/// links cleanly through SCOPE's sanitized media pipeline.
 *
 * @param {string} source
 * @returns {string}
 */
export function normalizeMarkdownMedia(source) {
  if (
    !source ||
    (!source.includes("file:") && !/<(?:img|video)\b/i.test(source))
  ) {
    return source;
  }

  const protectedSource = protectCode(source);
  let text = protectedSource.value;

  // Convert simple <img src="..."> and <video src="..."> tags into safe Markdown embeds.
  text = text.replace(
    /<(img|video)\b([^>]*?)\/?>\s*(?:<\/video>)?/gi,
    (match, tag, attrs) => {
      const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const src = (srcMatch?.[1] || srcMatch?.[2] || "").trim();
      if (!src) return match;
      const altMatch = attrs.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const label = (altMatch?.[1] || altMatch?.[2] || basenameFromFileUrl(src) || tag).trim();
      return `![${label}](<${src}>)`;
    },
  );

  // Wrap unencoded file:// targets containing spaces inside Markdown links/images
  // as angle-bracketed destinations: ![cap](file:///a/b c.png) -> ![cap](<file:///a/b c.png>)
  text = text.replace(
    /(!?\[[^\]]*\]\()(file:\/\/\/?[^)\r\n<>]*[ \t][^)\r\n<>]*)(\))/gi,
    (_m, open, target, close) => `${open}<${target.trim()}>${close}`,
  );

  // Protect existing Markdown links/images before autolinking bare file:/// URIs.
  const links = [];
  text = text.replace(
    /!?\[[^\]]*\]\((?:<[^>\r\n]+>|[^)\r\n]+)\)/g,
    (match) => `\uE002SCOPE_LINK_${links.push(match) - 1}\uE003`,
  );

  // Autolink bare file:///... URLs (common in Antigravity / agent prose).
  text = text.replace(
    /(^|[\s(>\[（【：:])(file:\/\/\/[^\s<>)"'\]）】]+)/gi,
    (_match, prefix, rawUri) => {
      const trailing = rawUri.match(/[.,;:!?。，；：！？]+$/)?.[0] || "";
      const uri = trailing ? rawUri.slice(0, -trailing.length) : rawUri;
      const label = basenameFromFileUrl(uri);
      const isMedia = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif|mp4|m4v|webm|ogv|mov)(?:[?#]|$)/i.test(uri);
      return `${prefix}${isMedia ? "!" : ""}[${label}](<${uri}>)${trailing}`;
    },
  );

  text = text.replace(
    /\uE002SCOPE_LINK_(\d+)\uE003/g,
    (_match, idx) => links[Number(idx)] ?? "",
  );

  return protectedSource.restore(text);
}
