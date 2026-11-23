import { createHash } from "node:crypto";
import { lstatSync, readFileSync, mkdirSync, writeFileSync, renameSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const idPattern = /^[a-z][a-z0-9-]{1,63}$/;
const reserved = new Set(["aliyun-dlc"]);
const fail = message => { throw new Error(message); };
const hash = value => createHash("sha256").update(value).digest("hex");
export function validatePackageManifest(m) {
  if (!m || m.protocolVersion !== 1) fail("仅支持 SCOPE 插件协议 v1；DSH / Cordis 插件需要适配");
  if (typeof m.id !== "string" || !idPattern.test(m.id) || reserved.has(m.id)) fail("插件 ID 无效或与内置插件冲突");
  for (const field of ["name", "version", "description"]) if (typeof m[field] !== "string" || !m[field].trim() || m[field].length > 1000) fail(`清单缺少有效的 ${field}`);
  for (const field of ["capabilities", "permissions"]) if (!Array.isArray(m[field]) || m[field].some(v => typeof v !== "string" || v.length > 500)) fail(`无效的 ${field}`);
  if (!Array.isArray(m.settings) || !Array.isArray(m.actions)) fail("清单需要 settings 和 actions");
  for (const field of m.settings) {
    if (!field || typeof field.key !== "string" || !/^[a-z][a-zA-Z0-9-]{0,63}$/.test(field.key) || !["text", "ssh-host"].includes(field.type) || typeof field.label !== "string") fail("不支持的插件设置字段");
    if (field.default !== undefined && typeof field.default !== "string") fail("设置默认值必须是字符串");
  }
  if (new Set(m.settings.map(f => f.key)).size !== m.settings.length) fail("设置字段重复");
  for (const a of m.actions) if (!a || typeof a.id !== "string" || !idPattern.test(a.id) || typeof a.label !== "string" || typeof a.result !== "string") fail("无效的插件操作");
  if (new Set(m.actions.map(a => a.id)).size !== m.actions.length) fail("插件操作重复");
  if (m.view) fail("外部插件暂不支持自定义页面；操作结果以 JSON 展示");
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > 100) fail("files 必须明确列出 1–100 个文件");
  for (const file of m.files) {
    if (typeof file !== "string" || !/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*\.(mjs|js|json|md|css|svg)$/.test(file) || file.split("/").some(p => !p || p.endsWith(".") || /^(node_modules|\.git|\.scope)$/i.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)) || /(^|\/)(auth|credentials|secrets?|tokens?|config)\.json$/i.test(file) || /^(scope-plugin|receipt)\.json$/i.test(file)) fail("files 包含不支持的路径或私密配置文件");
  }
  if (new Set(m.files.map(file => file.toLowerCase())).size !== m.files.length) fail("files 不能包含大小写冲突的路径");
  if (!m.files.includes(m.entry) || !m.entry.endsWith(".mjs")) fail("entry 必须是 files 中的 .mjs 文件");
  return m;
}

function regularFile(root, file) {
  let current = root;
  for (const part of file.split("/")) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) fail("插件不能包含符号链接或目录联接");
  }
  const stat = lstatSync(current);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) fail("插件文件必须是小于 2 MB 的普通文件");
  return readFileSync(current);
}

/** Reads declarations and bytes only. Never imports code or runs install scripts. */
export function inspectPackage(directory) {
  const root = path.resolve(directory);
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) fail("请选择普通插件目录");
  const manifest = validatePackageManifest(JSON.parse(regularFile(root, "scope-plugin.json").toString("utf8")));
  if (manifest.files.includes("scope-plugin.json")) fail("清单不需要列入 files");
  const files = new Map(manifest.files.map(file => [file, regularFile(root, file)]));
  const size = [...files.values()].reduce((n, data) => n + data.length, 0);
  if (size > 10 * 1024 * 1024) fail("插件包不能超过 10 MB");
  const digest = hash(JSON.stringify(manifest) + [...files].map(([file, data]) => `${file}:${hash(data)}`).join("\n"));
  return { manifest, files, digest, size };
}

export function installPackage(directory, stateDirectory) {
  const inspected = inspectPackage(directory);
  const root = path.join(stateDirectory, "extensions");
  mkdirSync(root, { recursive: true });
  const destination = path.join(root, inspected.manifest.id);
  if (existsSync(destination)) fail("此插件已安装；请先停用并移除旧版本，再导入");
  const staging = path.join(root, `.install-${inspected.manifest.id}-${Date.now()}`);
  mkdirSync(staging);
  for (const [file, data] of inspected.files) {
    const target = path.join(staging, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data, { mode: 0o600 });
  }
  writeFileSync(path.join(staging, "scope-plugin.json"), JSON.stringify(inspected.manifest, null, 2));
  writeFileSync(path.join(staging, "receipt.json"), JSON.stringify({ digest: inspected.digest, installedAt: new Date().toISOString() }));
  renameSync(staging, destination);
  return { id: inspected.manifest.id, digest: inspected.digest, restartRequired: true };
}

export function installedPackages(stateDirectory) {
  const root = path.join(stateDirectory, "extensions");
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(id => idPattern.test(id)).map(id => {
    try {
      const directory = path.join(root, id);
      const inspected = inspectPackage(directory);
      const receipt = JSON.parse(regularFile(directory, "receipt.json").toString("utf8"));
      if (inspected.manifest.id !== id || receipt.digest !== inspected.digest) fail("插件文件与安装记录不一致，请重新导入");
      return { id, directory, manifest: inspected.manifest, digest: inspected.digest };
    } catch (error) { return { id, error: error.message }; }
  });
}

export function removePackage(id, stateDirectory) {
  if (!idPattern.test(id) || reserved.has(id)) fail("无效的外部插件 ID");
  const source = path.join(stateDirectory, "extensions", id);
  const archive = path.join(stateDirectory, "extensions-removed");
  mkdirSync(archive, { recursive: true });
  renameSync(source, path.join(archive, `${id}-${Date.now()}`));
  return { id, restartRequired: true, configurationPreserved: true };
}
