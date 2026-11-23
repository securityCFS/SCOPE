import { LOCAL_HOST } from "../../lib/execution-host.js";
export function validateDirectoryTarget({ parent, name }) {
  if (
    typeof parent !== "string" ||
    !parent.startsWith("/") ||
    parent.length > 4000 ||
    /[\x00-\x1f\x7f]/.test(parent)
  )
    throw new Error("工作目录必须是远端绝对路径");
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name !== name.trim() ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    /[/\\\x00-\x1f\x7f]/.test(name)
  )
    throw new Error("请输入单个文件夹名称，不包含路径或控制字符");
  return { parent, name };
}

export const CREATE_DIRECTORY = String.raw`
import base64, json, os, sys
target = json.loads(base64.b64decode(sys.argv[1]))
parent = os.path.realpath(target["parent"])
name = target["name"]
if not name or name in (".", "..") or any(c in name for c in ("/", "\\", "\x00")):
    raise SystemExit("文件夹名称无效")
if not os.path.isdir(parent):
    raise SystemExit("上级目录不存在")
cwd = os.path.join(parent, name)
try:
    os.mkdir(cwd)
except FileExistsError:
    raise SystemExit("同名文件或目录已存在，请选择已有目录或更换名称")
except OSError as error:
    raise SystemExit("创建目录失败：" + str(error))
print(json.dumps({"cwd": cwd}, ensure_ascii=False))
`;

export function directoryRoutes({
  local,
  getHost,
  run,
  readJsonBody,
  jsonResponse,
  listScript,
  shellQuote,
  cleanError,
}) {
  return async (request, response, url) => {
    if (url.pathname !== "/api/remote/directories") return false;
    if (!["GET", "POST"].includes(request.method)) {
      jsonResponse(response, 405, { error: "不支持的请求方法" });
      return true;
    }
    try {
      const input =
        request.method === "POST"
          ? await readJsonBody(request)
          : Object.fromEntries(url.searchParams);
      const host = getHost(input.host);
      if (!host?.reachable) {
        jsonResponse(response, 404, { error: "所选 SSH 主机当前不可连接" });
        return true;
      }
      const creating = request.method === "POST";
      if (host.alias === LOCAL_HOST && local) {
        jsonResponse(response, 200, { host: host.alias, ...await local(input, creating) });
        return true;
      }
      const argument = creating
        ? Buffer.from(JSON.stringify(validateDirectoryTarget(input))).toString(
            "base64",
          )
        : (input.path || "/").trim().slice(0, 4000);
      const result = await run(
        host.alias,
        `python3 - ${shellQuote(argument)}`,
        creating ? CREATE_DIRECTORY : listScript,
        20000,
        2000000,
      );
      if (result.code !== 0) {
        jsonResponse(response, 400, {
          error: cleanError(result.stderr || result.stdout),
        });
        return true;
      }
      const listing = JSON.parse(result.stdout.trim());
      jsonResponse(
        response,
        200,
        creating
          ? { host: host.alias, cwd: listing.cwd }
          : {
              host: host.alias,
              cwd: listing.cwd,
              parent: listing.parent || null,
              directories: Array.isArray(listing.directories)
                ? listing.directories
                : [],
              truncated: Boolean(listing.truncated),
            },
      );
    } catch (error) {
      jsonResponse(response, 400, { error: error.message });
    }
    return true;
  };
}
