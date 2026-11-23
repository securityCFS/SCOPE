/**
 * Return concrete SSH aliases whose own Host block points at a hostname.
 * Wildcard blocks are intentionally ignored: DLC ownership is scoped to the
 * explicitly configured submission host, not every reachable host.
 *
 * @param {string} source OpenSSH config text
 * @param {string} expectedHostname configured HostName value
 */
export function sshAliasesForHostname(source, expectedHostname) {
  const aliases = new Set();
  let current = [];
  for (const line of source.split(/\r?\n/)) {
    const hostMatch = line.match(/^\s*Host\s+(.+?)\s*$/i);
    if (hostMatch) {
      current = hostMatch[1]
        .split(/\s+/)
        .filter((value) => value && !/[*?!]/.test(value));
      continue;
    }
    const hostnameMatch = line.match(/^\s*HostName\s+(.+?)\s*$/i);
    if (!hostnameMatch || hostnameMatch[1] !== expectedHostname) continue;
    for (const alias of current) aliases.add(alias);
  }
  aliases.add(expectedHostname);
  return aliases;
}
