import { readFileSync, readdirSync } from "node:fs";

/** Legacy source-contract checks span the modules extracted from the old route. */
export function workspaceSource() {
  function read(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      return entry.isDirectory()
        ? read(url)
        : /\.tsx?$/.test(entry.name)
          ? [readFileSync(url, "utf8")]
          : [];
    });
  }
  const sources = [
    readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8"),
    ...read(new URL("../../features/workspace/", import.meta.url)),
    ...read(new URL("../../features/accounts/", import.meta.url)),
    ...read(new URL("../../features/settings/", import.meta.url)),
    ...read(new URL("../../features/command-center/", import.meta.url)),
    ...read(new URL("../../components/", import.meta.url)),
    ...read(new URL("../../features/conversation/", import.meta.url)),
  ].join("\n");
  return sources;
}
