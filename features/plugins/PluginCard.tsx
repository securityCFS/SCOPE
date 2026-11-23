"use client";
import { useEffect, useState } from "react";
import { Check, Save } from "lucide-react";
import { bridgeUrl } from "@/features/workspace/shared";
import type { Host } from "@/features/workspace/types";
import { LOCAL_HOST } from "@/lib/execution-host";
import type { PluginDescriptor } from "./types";

export function PluginCard({ plugin, hosts }: { plugin: PluginDescriptor; hosts: Host[] }) {
  const [draft, setDraft] = useState(plugin);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const m = draft.manifest;
  useEffect(() => {
    if (draft.status.state !== "loading") return;
    const abort = new AbortController();
    const timer = setInterval(() => {
      void fetch(bridgeUrl(`/api/plugins/${m.id}/config`), { signal: abort.signal, cache: "no-store" }).then(async response => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || "无法读取插件状态");
        if (!abort.signal.aborted) setDraft(value);
      }).catch(cause => { if (!abort.signal.aborted) setError(cause.message); });
    }, 750);
    return () => { clearInterval(timer); abort.abort(); };
  }, [draft.status.state, m.id]);
  const supported = m.protocolVersion === 1 && m.settings.every(f => ["ssh-host", "text"].includes(f.type));
  function update(value: Partial<PluginDescriptor>) { setDraft(v => ({ ...v, ...value })); setSaved(false); }
  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch(bridgeUrl(`/api/plugins/${m.id}/config`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: draft.enabled, config: draft.config, revision: draft.revision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败");
      setDraft(result); setSaved(true);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function runAction(id: string) {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch(bridgeUrl(`/api/plugins/${m.id}/actions/${id}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "操作失败");
      setResult(JSON.stringify(value, null, 2));
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <article className="scope-plugin-card" aria-label={`${m.name}插件`}>
    <header><div><h3>{m.name}<small>{draft.source === "local" ? "本地导入" : "内置"} · {m.version}</small></h3><p>{m.description}</p></div>
      <span className="scope-plugin-state">{{ disabled: "未启用", loading: "加载中", running: "运行中", idle: "已启用", error: "运行异常" }[draft.status.state] || draft.status.state}</span></header>
    <label className="settings-checkbox"><input type="checkbox" checked={draft.enabled} disabled={busy || !supported}
      onChange={e => update({ enabled: e.target.checked })} />启用插件</label>
    {supported ? <div className="center-form-grid">{m.settings.map(field => <label className="span-full" key={field.key}>{field.label}
      <input value={draft.config[field.key] || ""} placeholder={field.placeholder} disabled={busy}
        list={field.type === "ssh-host" ? `${m.id}-${field.key}` : undefined}
        onChange={e => update({ config: { ...draft.config, [field.key]: e.target.value } })} />
      {field.type === "ssh-host" && <datalist id={`${m.id}-${field.key}`}>{hosts.filter(h => h.alias !== LOCAL_HOST).map(h => <option key={h.alias} value={h.alias} />)}</datalist>}
    </label>)}</div> : <p role="alert">当前界面不支持此插件的配置版本，请更新 SCOPE。</p>}
    <p className="scope-plugin-permissions">{m.permissions.join(" · ")}</p>
    {m.view === "submission-tracker/v1" && <p className="settings-hint">结果在「更多 → 提交追踪」查看。保存立即生效；启用后定期扫描，也可在追踪页手动刷新。</p>}
    {draft.source === "local" && <div className="scope-plugin-actions">{m.actions.map(a => <button key={a.id} className="center-secondary" disabled={busy || draft.status.state !== "idle"} onClick={() => void runAction(a.id)}>{a.label}</button>)}</div>}
    {result !== null && <pre className="scope-plugin-result" aria-label="插件操作结果">{result}</pre>}
    {draft.status.error && <p className="settings-error">{draft.status.error}</p>}
    {error && <p className="settings-error" role="alert">{error}</p>}
    <footer className="settings-footer">{saved && <span role="status"><Check size={14} />已保存</span>}
      <button className="center-secondary" type="button" disabled={busy || !supported || (draft.enabled && m.settings.some(f => f.requiredWhenEnabled && !draft.config[f.key]?.trim()))} onClick={() => void save()}>
        <Save size={14} />{busy ? "保存中…" : "保存插件设置"}</button></footer>
  </article>;
}
