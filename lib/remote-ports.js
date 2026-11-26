const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/**
 * Extract a loopback HTTP(S) port target from an agent Markdown link
 * (e.g. `http://localhost:6006/scalars` or `http://127.0.0.1:7860`).
 *
 * @param {string | undefined} href
 * @returns {{ port: number, protocol: string, pathAndQuery: string, rawHost: string } | null}
 */
export function remotePortTargetFromMarkdownHref(href) {
  if (!href || typeof href !== "string") return null;
  const trimmed = href.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const hostname = (parsed.hostname || "").toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostname)) return null;
  const portNum = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "https:"
      ? 443
      : 80;
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65_535) {
    return null;
  }
  return {
    port: portNum,
    protocol: parsed.protocol === "https:" ? "https:" : "http:",
    pathAndQuery: `${parsed.pathname || "/"}${parsed.search || ""}${parsed.hash || ""}`,
    rawHost: hostname,
  };
}
