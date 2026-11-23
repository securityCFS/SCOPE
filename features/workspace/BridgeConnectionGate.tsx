"use client";
import { Check, Copy, LoaderCircle, RefreshCw } from "lucide-react";
import { ScopeLogo } from "@/components/scope-logo";

export function retryBridgeConnection() {
  window.dispatchEvent(new Event("scope:reconnect"));
}

export function BridgeConnectionGate({ theme, copied, onCopy }: {
  theme: "light" | "dark";
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <main className="bridge-gate connection-page" data-ui-theme={theme}>
      <header className="gate-topbar"><div className="scope-wordmark">
        <ScopeLogo size={28} /><strong>SCOPE</strong><em>跨项目工作台</em>
      </div></header>
      <div className="connection-page-body">
        <section className="connection-card" aria-label="连接 SCOPE">
          <div className="connection-symbol"><ScopeLogo size={36} /></div>
          <h1>正在连接工作台</h1>
          <p>暂时无法连接 SCOPE 服务。连接恢复后，项目与会话会自动显示。</p>
          <div className="connection-progress" role="status"><LoaderCircle size={15} className="is-spinning" />正在自动重连</div>
          <button type="button" className="connection-retry" onClick={retryBridgeConnection}><RefreshCw size={15} />立即重试</button>
          <details className="connection-help">
            <summary>服务尚未启动？</summary>
            <p>在运行 SCOPE 的电脑上，进入项目目录后执行：</p>
            <div className="connection-command"><code>npm run scope</code><button type="button" aria-label="复制启动命令" onClick={onCopy}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
            <p>从其他设备访问时，请检查服务地址与网络连接。</p>
          </details>
        </section>
      </div>
    </main>
  );
}

export function BridgeReconnectNotice() {
  return <div className="connection-reconnect-notice" role="status">
    <LoaderCircle size={14} className="is-spinning" />
    <span>连接暂时中断，正在重连 · 当前显示上次同步内容</span>
    <button type="button" onClick={retryBridgeConnection}>立即重试</button>
  </div>;
}
