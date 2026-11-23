"use client";
import { useState } from "react";
import { Copy, PackagePlus } from "lucide-react";

const example = "npm run plugin -- inspect ./examples/plugins/hello\nnpm run plugin -- add ./examples/plugins/hello";
export function PluginImportGuide() {
  const [message, setMessage] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(example); setMessage("已复制示例命令"); }
    catch { setMessage("无法复制，请手动选择命令"); }
  }
  return <details className="scope-plugin-import">
    <summary><PackagePlus size={15} />导入插件<span>本地插件包</span></summary>
    <div><p>在运行 SCOPE 的电脑上，进入 SCOPE 仓库，检查并导入插件目录：</p>
      <pre>{example}</pre>
      <button className="center-secondary" onClick={() => void copy()}><Copy size={13} />复制示例</button>
      <span role="status">{message}</span>
      <p>重启 SCOPE 后刷新此页，启用已安装的插件。替换示例路径即可导入自己的插件。</p>
      <p className="settings-hint">插件以服务权限运行，请先检查来源和代码。支持 scope-plugin.json + apply(ctx)；DSH / Cordis 插件需要适配。暂不支持网页上传、npm 或 GitHub 一键安装。</p>
    </div>
  </details>;
}
