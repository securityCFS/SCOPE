import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { prepareExportDirectory } from "./lib/export-directory.mjs";
import {
  compileDenylistRegex,
  loadDenylistPatterns,
  scanContentForLeaks,
} from "./lib/secret-scanner.mjs";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const outIndex = args.indexOf("--out");
if (outIndex >= 0 && (!args[outIndex + 1] || args[outIndex + 1].startsWith("--"))) {
  throw new Error("--out requires an output directory");
}
const defaultExportDir = path.join(
  ".scope",
  "opensource-export",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const outDir = path.resolve(
  outIndex >= 0 && args[outIndex + 1]
    ? args[outIndex + 1]
    : defaultExportDir,
);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".mp4",
  ".docx",
  ".pdf",
]);

function gitList(gitArgs) {
  return execFileSync("git", gitArgs, { encoding: "utf8" })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const tracked = gitList(["ls-files"]);
const untracked = gitList(["ls-files", "--others", "--exclude-standard"]);
const files = [...new Set([...tracked, ...untracked])];

const denylistPath =
  process.env.SCOPE_EXPORT_DENYLIST || path.join(".scope", "leak-denylist.json");
const customPatterns = await loadDenylistPatterns(denylistPath);
const customDenylistRegex = compileDenylistRegex(customPatterns);

const violations = [];
let scanned = 0;

for (const relativePath of files) {
  if (relativePath === "package-lock.json") continue;
  let info;
  try {
    info = await stat(relativePath);
  } catch {
    continue; // Deleted from working tree prior to commit.
  }
  if (!info.isFile()) continue;
  const extension = path.extname(relativePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) continue;

  const content = await readFile(relativePath, "utf8");
  scanned++;
  violations.push(...scanContentForLeaks(content, relativePath, customDenylistRegex));
}

if (violations.length > 0) {
  console.error(`[scope-export] Found ${violations.length} potential leak(s):`);
  for (const v of violations.slice(0, 50)) {
    console.error(`  ${v.file}:${v.line}: [${v.rule}] ${v.token}`);
  }
  process.exit(1);
}

console.log(
  `[scope-export] Scanned ${scanned} text files` +
    `${customPatterns.length ? ` (+ ${customPatterns.length} local denylist rules)` : ""}` +
    ": no forbidden patterns or secret signatures detected.",
);
console.log("[scope-export] This check does not audit Git history or binary files.");

if (!checkOnly) {
  await prepareExportDirectory(outDir);
  let exported = 0;
  for (const relativePath of files) {
    let info;
    try {
      info = await stat(relativePath);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    const destination = path.join(outDir, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(relativePath, destination, { force: false, errorOnExist: true });
    exported++;
  }
  console.log(`[scope-export] Exported ${exported} files to ${outDir}`);
  console.log("[scope-export] Review the exported files and initialize a new repository there before publishing; no Git history was exported.");
}
