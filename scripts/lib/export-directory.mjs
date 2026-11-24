import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";

async function canonicalPath(directory) {
  const missing = [];
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    try {
      const resolved = await realpath(current);
      return missing.length ? path.join(resolved, ...missing.reverse()) : resolved;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(directory);
    missing.push(path.basename(current));
  }
}

/** Never erase an export destination: an empty/new directory is required. */
export async function prepareExportDirectory(directory, repository = process.cwd()) {
  const root = await realpath(repository);
  const target = path.resolve(directory);
  const canonicalTarget = await canonicalPath(target);
  const normalize = (value) => (process.platform === "win32" ? value.toLowerCase() : value);
  const relative = path.relative(normalize(canonicalTarget), normalize(root));
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Export destination cannot be the repository or one of its ancestors");
  }
  for (let current = target; ; current = path.dirname(current)) {
    const info = await lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (info?.isSymbolicLink()) throw new Error("Export destination cannot traverse a symlink or junction");
    if (path.dirname(current) === current) break;
  }
  const entries = await readdir(target).catch(error => { if (error.code === "ENOENT") return []; throw error; });
  if (entries.length) throw new Error("Export destination must be empty; existing files will not be deleted");
  await mkdir(target, { recursive: true });
  return target;
}
