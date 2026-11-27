const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/**
 * Determine whether the current browser location is accessing SCOPE remotely
 * (for example via Cloudflare Tunnel / Private Gateway on `https://scope.xiaotu.dev`)
 * rather than on a local loopback origin (`http://127.0.0.1:3000`).
 *
 * @param {{ hostname?: string, origin?: string, protocol?: string, host?: string } | null | undefined} [locationLike]
 * @returns {boolean}
 */
export function isRemoteBrowserLocation(locationLike) {
  const loc =
    locationLike !== undefined
      ? locationLike
      : typeof window !== "undefined"
        ? window.location
        : null;
  if (!loc || !loc.hostname) return false;
  const hostname = String(loc.hostname).toLowerCase();
  return !LOOPBACK_HOSTS.has(hostname);
}

/**
 * Resolve the browser URL for opening a forwarded or locally exposed port.
 * - On local loopback (`127.0.0.1` / `localhost` / `::1`), opens `http://127.0.0.1:<port><path>`.
 * - On a remote origin (e.g. `https://scope.xiaotu.dev`), routes through the
 *   authenticated `/scope-port/<port><path>` gateway proxy.
 *
 * @param {number} localPort
 * @param {{ pathAndQuery?: string, protocol?: string, location?: { hostname?: string, origin?: string, protocol?: string, host?: string } | null }} [options]
 * @returns {string}
 */
export function portForwardAccessUrl(
  localPort,
  { pathAndQuery = "/", protocol = "http:", location: locationLike } = {},
) {
  const port = Number(localPort);
  const normalizedPath =
    typeof pathAndQuery === "string" && pathAndQuery.startsWith("/")
      ? pathAndQuery
      : `/${pathAndQuery || ""}`;
  const loc =
    locationLike !== undefined
      ? locationLike
      : typeof window !== "undefined"
        ? window.location
        : null;
  if (loc && isRemoteBrowserLocation(loc)) {
    const origin =
      loc.origin && loc.origin !== "null"
        ? loc.origin.replace(/\/+$/, "")
        : `${loc.protocol || "https:"}//${loc.host}`;
    return `${origin}/scope-port/${port}${normalizedPath}`;
  }
  const safeProto = protocol === "https:" ? "https:" : "http:";
  return `${safeProto}//127.0.0.1:${port}${normalizedPath}`;
}

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
