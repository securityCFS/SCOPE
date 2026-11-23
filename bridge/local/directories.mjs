import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { LOCAL_HOST, workingDirectory } from "../../lib/execution-host.js";
import { validateDirectoryTarget } from "../workbench/directory-routes.mjs";

export async function localDirectory(value) {
  workingDirectory(LOCAL_HOST, value);
  const cwd = await realpath(value);
  if (!(await stat(cwd)).isDirectory()) throw new Error("工作目录不是文件夹");
  return cwd;
}
export async function localDirectories(input, creating, defaultCwd) {
  if (creating) {
    const parent = await localDirectory(input.parent);
    validateDirectoryTarget({ parent: "/", name: input.name });
    if (
      process.platform === "win32" &&
      /[<>:"|?*]|[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(
        input.name,
      )
    )
      throw new Error("文件夹名称包含 Windows 不支持的字符或保留名称");
    const cwd = path.join(parent, input.name);
    await mkdir(cwd); // Never overwrite or recursively create an unreviewed parent.
    return { cwd };
  }
  const cwd = await localDirectory(input.path || defaultCwd);
  const entries = (await readdir(cwd, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(cwd);
  return {
    cwd,
    parent: parent === cwd ? null : parent,
    directories: entries
      .slice(0, 500)
      .map((e) => ({ name: e.name, path: path.join(cwd, e.name) })),
    truncated: entries.length > 500,
  };
}
