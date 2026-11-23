"use client";

import { Children, isValidElement, memo, useMemo, useState, type ComponentType, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { FormulaCodeBlock, InlineFormulaCode } from "./formula-preview";
import { isInlineFormula } from "../lib/formula-preview.js";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { isVideoSource } from "../lib/markdown-images.js";
import { markdownUrlTransform } from "../lib/markdown-url.js";
import { normalizeLatexDelimiters } from "../lib/markdown-math.js";
import { remoteFileTargetFromMarkdownHref } from "../lib/remote-links.js";

type RemoteLinkProps = {
  host: string; cwd: string; remotePath: string;
  line: number | null; column: number | null;
  className?: string; children: ReactNode;
};

export function MarkdownVideo({ src, label }: { src: string; label?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  return <span className="markdown-video">
    <video key={retry} src={src} controls preload="none" playsInline onError={() => setFailed(true)} aria-label="视频预览" />
    <span className="markdown-video-caption"><a href={src} target="_blank" rel="noreferrer">{label || "打开视频"}</a>
      {failed && <button type="button" onClick={() => { setFailed(false); setRetry((count) => count + 1); }}>加载失败或编码不受支持 · 重试</button>}
    </span>
  </span>;
}

function MarkdownImage({ src, alt, title }: { src: string; alt?: string; title?: string }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const remotePath = src.startsWith("/scope-image-api?") ? new URLSearchParams(src.split("?")[1]).get("path") : src;
  const imageSrc = retry && src.startsWith("/scope-image-api?") ? `${src}&retry=${retry}` : src;
  if (!src || failed) return (
    <span className="markdown-image-error">
      <span>{alt || "图片"}：图片无法加载</span>
      {remotePath && <code>{remotePath}</code>}
      {src && <button type="button" onClick={() => { setFailed(false); setRetry(Date.now()); }}>重试</button>}
    </span>
  );
  return <img className="markdown-image" src={imageSrc} alt={alt || "Codex 引用的图片"} title={title || alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export const MarkdownContent = memo(function MarkdownContent({
  value, className = "", remoteHost, remoteCwd, RemoteFileLink,
}: {
  value: string; className?: string; remoteHost?: string; remoteCwd?: string;
  RemoteFileLink: ComponentType<RemoteLinkProps>;
}) {
  // ReactMarkdown treats these callbacks as component TYPES. Recreating them
  // on snapshot/clock updates unmounts <video>, resetting playback and requests.
  // Keep types stable even when the text grows during a streamed reply.
  const components = useMemo<Components>(() => ({
    pre: ({ children, node: _node, ...props }) => {
      const child = Children.toArray(children)[0];
      if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
        const source = String(child.props.children ?? "");
        if (/^language-(?:tex|latex|math|katex)$/.test(child.props.className || "")) return <FormulaCodeBlock source={source} />;
        // Code blocks never pass through the inline formula heuristic.
        return <pre {...props}><code className={child.props.className}>{child.props.children}</code></pre>;
      }
      return <pre {...props}>{children}</pre>;
    },
    code: ({ children, node: _node, ...props }) => {
      const source = String(children ?? "");
      return !props.className && isInlineFormula(source) ? <InlineFormulaCode source={source} /> : <code {...props}>{children}</code>;
    },
    img: ({ src, alt, title }) => isVideoSource(src)
      ? <MarkdownVideo key={String(src)} src={String(src)} label={alt} />
      : <MarkdownImage key={String(src)} src={typeof src === "string" ? src : ""} alt={alt} title={title} />,
    a: ({ href, children, node: _node, className: linkClassName, ...props }) => {
      if (href && isVideoSource(href)) return <MarkdownVideo key={href} src={href} label={children} />;
      const target = remoteFileTargetFromMarkdownHref(href, remoteCwd);
      if (remoteHost && target) {
        const parent = target.path.slice(0, target.path.lastIndexOf("/")) || "/";
        return <RemoteFileLink className={linkClassName} host={remoteHost} cwd={remoteCwd || parent} remotePath={target.path} line={target.line} column={target.column}>{children}</RemoteFileLink>;
      }
      return <a {...props} className={linkClassName} href={href}>{children}</a>;
    },
  }), [remoteHost, remoteCwd, RemoteFileLink]);
  const urlTransform = useMemo(() => (url: string, key: string) =>
    markdownUrlTransform(url, key, remoteHost, remoteCwd), [remoteHost, remoteCwd]);
  return <div className={`markdown-body ${className}`.trim()}>
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} urlTransform={urlTransform} components={components}>
      {normalizeLatexDelimiters(value)}
    </ReactMarkdown>
  </div>;
});
