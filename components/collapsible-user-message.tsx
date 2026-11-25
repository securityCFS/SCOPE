"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { MarkdownBody } from "@/features/workspace/shared";
import { useLocale } from "@/lib/i18n";
import "./collapsible-user-message.css";

const OVERFLOW_THRESHOLD_PX = 216;

function formatCompactCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function CollapsibleUserMessage({
  value,
  remoteHost,
  remoteCwd,
  surface = "panel-2",
}: {
  value: string;
  remoteHost?: string;
  remoteCwd?: string;
  surface?: "panel-2" | "hover";
}) {
  const { tr } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const stats = useMemo(() => {
    const trimmed = (value || "").trim();
    const lines = trimmed ? trimmed.split(/\r?\n/).length : 0;
    const chars = trimmed.length;
    return {
      lines,
      chars,
      likelyOverflow: lines >= 7 || chars >= 320,
    };
  }, [value]);

  const [expanded, setExpanded] = useState(false);
  const [measuredOverflow, setMeasuredOverflow] = useState<boolean | null>(
    null,
  );

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      setMeasuredOverflow(el.scrollHeight > OVERFLOW_THRESHOLD_PX);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  const collapsible = measuredOverflow ?? stats.likelyOverflow;
  const isCollapsed = collapsible && !expanded;

  const metaLabel =
    stats.lines >= 4
      ? tr(`${stats.lines} 行`, `${stats.lines} lines`)
      : tr(
          `${formatCompactCount(stats.chars)} 字`,
          `${formatCompactCount(stats.chars)} chars`,
        );

  const handleToggle = () => {
    if (expanded) {
      const rect = rootRef.current?.getBoundingClientRect();
      setExpanded(false);
      if (rect && rect.top < 80) {
        requestAnimationFrame(() => {
          rootRef.current?.scrollIntoView({ block: "nearest" });
        });
      }
    } else {
      setExpanded(true);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`collapsible-user-msg is-surface-${surface}${isCollapsed ? " is-collapsed" : ""}`}
      data-collapsible={collapsible ? "true" : "false"}
    >
      <div className="collapsible-user-msg-clip">
        <div ref={innerRef} className="collapsible-user-msg-inner">
          <MarkdownBody
            value={value}
            remoteHost={remoteHost}
            remoteCwd={remoteCwd}
          />
        </div>
      </div>
      {collapsible && (
        <div className="collapsible-user-msg-footer">
          <button
            type="button"
            className="collapsible-user-msg-toggle"
            aria-expanded={expanded}
            onClick={handleToggle}
          >
            {expanded ? (
              <>
                <ChevronUp size={13} />
                {tr("收起", "Collapse")}
              </>
            ) : (
              <>
                <ChevronDown size={13} />
                {tr(`展开全部 · ${metaLabel}`, `Expand · ${metaLabel}`)}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
