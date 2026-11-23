import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";

/** Never erase an export destination: an empty/new directory is required. */
export async function prepareExportDirectory(directory, repository = process.cwd()) {
  const root = await realpath(repository);
  const target = path.resolve(directory);
  const relative = path.relative(target, root);
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
