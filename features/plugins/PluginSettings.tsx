"use client";
import { useEffect, useState } from "react";
import { Plug, RefreshCw } from "lucide-react";
import type { Host } from "@/features/workspace/types";
import { bridgeUrl } from "@/features/workspace/shared";
import { PluginCard } from "./PluginCard";
import { PluginImportGuide } from "./PluginImportGuide";
import type { PluginDescriptor } from "./types";
import "./plugins.css";

export function PluginSettings({ hosts }: { hosts: Host[] }) {
  const [plugins, setPlugins] = useState<PluginDescriptor[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loadErrors, setLoadErrors] = useState<{ id: string; error: string }[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(bridgeUrl("/api/plugins"), { signal: abort.signal, cache: "no-store" }).then(async r => {
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "无法读取插件");
      if (result.protocolVersion !== 1) throw new Error("插件接口版本不兼容，请更新 SCOPE");
      if (!abort.signal.aborted) { setPlugins(result.plugins); setLoadErrors(result.loadErrors || []); setError(""); }
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [revision]);
  return <section className="settings-section scope-plugin-settings" aria-label="插件设置">
    <header className="scope-plugin-heading"><div><h2><Plug size={18} /> 插件</h2><p>按需启用外部服务，独立管理连接与权限。</p></div>
      <button className="center-secondary" onClick={() => setRevision(v => v + 1)} title="重新载入插件设置"><RefreshCw size={14} />刷新</button></header>
    <PluginImportGuide />
    {error && <p className="settings-error" role="alert">{error}</p>}
    {loadErrors.map(item => <p className="settings-error" role="alert" key={item.id}>{item.id}：{item.error}</p>)}
    {!plugins && !error && <p role="status">正在读取插件…</p>}
    {plugins?.length === 0 && <p>暂未安装插件。</p>}
    {plugins?.map(plugin => <PluginCard key={`${plugin.manifest.id}:${revision}:${plugin.revision}`} plugin={plugin} hosts={hosts} />)}
  </section>;
}
