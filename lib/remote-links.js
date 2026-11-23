const FILE_URL_PREFIX = /^file:\/\//i;
const EXTERNAL_SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:/i;

function decodeRemotePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePosixAbsolutePath(value) {
  const segments = [];
  for (const segment of value.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function splitLineAndColumn(value) {
  const withColumn = value.match(/^(.*):(\d+):(\d+)$/);
  if (withColumn?.[1]) {
    return {
      path: withColumn[1],
      line: Number(withColumn[2]),
      column: Number(withColumn[3]),
    };
  }
  const withLine = value.match(/^(.*):(\d+)$/);
  if (!withLine?.[1]) return { path: value, line: null, column: null };
  return {
    path: withLine[1],
    line: Number(withLine[2]),
    column: null,
  };
}
/**
 * Resolve an absolute or relative Markdown href into a remote file target.
 * Supports Codex's common `file.md:line[:column]` and `file.md#Lline` forms.
 *
 * @param {string | undefined} href
 * @param {string | undefined} cwd
 * @returns {{ path: string, line: number | null, column: number | null } | null}
 */
export function remoteFileTargetFromMarkdownHref(href, cwd = "") {
  if (!href) return null;

  const candidate = href.trim();
  let pathname = "";
  let fragment = "";

  if (FILE_URL_PREFIX.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "file:") return null;
      // The session host supplies the filesystem; never silently drop a URI authority.
      if (parsed.hostname && parsed.hostname !== "localhost") return null;
      pathname = parsed.pathname;
      fragment = parsed.hash.slice(1);
    } catch {
      return null;
    }
  } else {
    const hashIndex = candidate.indexOf("#");
    const withoutHash = hashIndex >= 0 ? candidate.slice(0, hashIndex) : candidate;
    fragment = hashIndex >= 0 ? candidate.slice(hashIndex + 1) : "";
    pathname = withoutHash.split("?", 1)[0];
    if (!pathname || pathname.startsWith("//")) return null;
    const windowsAbsolute = /^[a-z]:[\\/]/i.test(pathname);
    if (!pathname.startsWith("/") && !windowsAbsolute && EXTERNAL_SCHEME_PREFIX.test(pathname)) {
      return null;
    }
    if (!pathname.startsWith("/") && !windowsAbsolute) {
      if (!cwd.startsWith("/") && !/^[a-z]:[\\/]/i.test(cwd)) return null;
      pathname = `${cwd.replace(/\/+$/, "")}/${pathname}`;
    }
  }

  const positioned = splitLineAndColumn(decodeRemotePath(pathname));
  if (/[\u0000-\u001f\u007f]/.test(positioned.path)) return null;
  const normalizedPath = normalizePosixAbsolutePath(positioned.path);
  const fragmentMatch = fragment.match(/^L(\d+)(?:C(\d+))?$/i);
  return {
    path: /^\/[a-z]:\//i.test(normalizedPath) ? normalizedPath.slice(1) : normalizedPath,
    line: fragmentMatch ? Number(fragmentMatch[1]) : positioned.line,
    column: fragmentMatch?.[2]
      ? Number(fragmentMatch[2])
      : positioned.column,
  };
}
