export const LOCAL_HOST = "@local";
export const hostLabel = (host) => (host === LOCAL_HOST ? "本机" : host);

export function workingDirectory(host, value) {
  const cwd = typeof value === "string" ? value.trim() : "";
  if (!cwd || cwd.length > 4000 || /[\x00-\x1f\x7f]/.test(cwd))
    throw new Error("请输入有效的工作目录");
  if (host === LOCAL_HOST) {
    if (!/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+|\/)/.test(cwd))
      throw new Error("请输入本机绝对目录，例如 C:/projects 或 /workspace");
    const normalized = cwd
      .replaceAll("\\", "/")
      .replace(/^([a-z]):/, (_, drive) => `${drive.toUpperCase()}:`);
    return (
      normalized.replace(/\/+$/, "") +
        (/^[A-Z]:\/$/.test(normalized) ? "/" : "") || "/"
    );
  }
  if (!cwd.startsWith("/")) throw new Error("请输入远端 Linux 绝对目录");
  return cwd.replace(/\/+$/, "") || "/";
}
