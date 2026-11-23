import { existsSync, statSync } from "node:fs";
import path from "node:path";

function npmBinaries(directory, arch) {
  const target = { x64: "x86_64", arm64: "aarch64" }[arch];
  if (!target) return [];
  const triple = `${target}-pc-windows-msvc`;
  const packageRoot = path.join(directory, "node_modules", "@openai");
  return [
    path.join(packageRoot, "codex", "node_modules", "@openai", `codex-win32-${arch}`, "vendor", triple, "bin", "codex.exe"),
    path.join(packageRoot, `codex-win32-${arch}`, "vendor", triple, "bin", "codex.exe"),
    path.join(packageRoot, "codex", "vendor", triple, "bin", "codex.exe"),
  ];
}

// Resolve the native binary, never execute a .cmd/.ps1 shim through a shell.
export function resolveCodexExecutable(env = process.env, platform = process.platform, arch = process.arch) {
  const explicit = env.SCOPE_LOCAL_CODEX;
  const directories = (env.PATH || env.Path || "").split(platform === "win32" ? ";" : ":")
    .map(dir => dir.replace(/^"|"$/g, "")).filter(dir => path.isAbsolute(dir));
  if (platform === "win32" && env.APPDATA) directories.push(path.join(env.APPDATA, "npm"));
  const candidates = explicit
    ? [explicit, ...(platform === "win32" && /[\\/]codex\.(cmd|ps1|bat)$/i.test(explicit) ? npmBinaries(path.dirname(explicit), arch) : [])]
    : directories.flatMap(dir => [path.join(dir, platform === "win32" ? "codex.exe" : "codex"), ...(platform === "win32" ? npmBinaries(dir, arch) : [])]);
  return candidates.find(file => {
    try { return path.isAbsolute(file) && !/\.(cmd|bat|ps1)$/i.test(file) && existsSync(file) && statSync(file).isFile(); }
    catch { return false; }
  }) || null;
}
