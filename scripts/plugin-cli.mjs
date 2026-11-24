import path from "node:path";
import { inspectPackage, installPackage, installedPackages, removePackage } from "../bridge/plugins/package.mjs";

const [operation, argument] = process.argv.slice(2);
const stateDirectory = process.env.SCOPE_STATE_DIR
  ? path.resolve(process.env.SCOPE_STATE_DIR)
  : path.resolve(".scope");
try {
  let result;
  if (operation === "inspect" && argument) {
    const { manifest, digest, size } = inspectPackage(argument);
    result = { manifest, digest, bytes: size, trust: "启用后以 SCOPE 服务权限执行 Node.js 代码；不是沙箱。" };
  } else if (operation === "add" && argument) result = installPackage(argument, stateDirectory);
  else if (operation === "remove" && argument) result = removePackage(argument, stateDirectory);
  else if (operation === "list") result = installedPackages(stateDirectory).map(({ id, manifest, digest, error }) => ({ id, manifest, digest, error }));
  else throw new Error("用法：npm run plugin -- inspect|add <本地目录> / list / remove <插件ID>");
  console.log(JSON.stringify(result, null, 2));
  if (result?.restartRequired) console.log("重启 SCOPE 后生效。在设置 → 插件中启停；仅启用你信任的代码。配置会保留。");
} catch (error) { console.error(error.message); process.exitCode = 1; }
