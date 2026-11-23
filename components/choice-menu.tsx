"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import "./choice-menu.css";

export type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

/** A themed single-choice menu. The native popover layer avoids clipping in dialogs. */
export function ChoiceMenu({
  label,
  value,
  options,
  onChange,
  disabled = false,
  searchable = false,
  searchPlaceholder = "搜索…",
  icon,
  compact = false,
  fieldLabel,
  className = "",
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  icon?: ReactNode;
  compact?: boolean;
  fieldLabel?: string;
  className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const anchor = useRef({ top: 0, left: 0 });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) =>
    `${option.label} ${option.description || ""}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );

  function close(restoreFocus = false) {
    panel.current?.hidePopover();
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  function show() {
    if (disabled || !panel.current || !trigger.current) return;
    if (open) return close();
    setQuery("");
    const rect = trigger.current.getBoundingClientRect();
    anchor.current = { top: rect.top, left: rect.left };
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const menuWidth = Math.min(
      width - 24,
      Math.max(rect.width, searchable ? 300 : 240),
    );
    const above = rect.top - top > height + top - rect.bottom;
    Object.assign(panel.current.style, {
      width: `${menuWidth}px`,
      left: `${Math.max(left + 12, Math.min(rect.right - menuWidth, left + width - menuWidth - 12))}px`,
      top: above ? "auto" : `${rect.bottom + 8}px`,
      bottom: above ? `${window.innerHeight - rect.top + 8}px` : "auto",
      maxHeight: `${Math.max(80, Math.min(380, (above ? rect.top - top : height + top - rect.bottom) - 20))}px`,
    });
    panel.current.showPopover();
    requestAnimationFrame(() => {
      if (searchable) search.current?.focus({ preventScroll: true });
      else
        (
          panel.current?.querySelector(
            '[aria-selected="true"]:not(:disabled)',
          ) as HTMLElement | null
        )?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    if (!open) return;
    const dismiss = () => panel.current?.hidePopover();
    const scroll = (event: Event) => {
      if (panel.current?.contains(event.target as Node)) return;
      const rect = trigger.current?.getBoundingClientRect();
      // A conversation loading history can scroll without moving the composer.
      if (
        !rect ||
        Math.abs(rect.top - anchor.current.top) > 1 ||
        Math.abs(rect.left - anchor.current.left) > 1
      )
        dismiss();
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);

  return (
    <div className={`choice-menu${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}>
      {fieldLabel && <span className="choice-field-label">{fieldLabel}</span>}
      <button
        ref={trigger}
        type="button"
        className="choice-trigger"
        aria-label={label}
        title={selected?.label || value || label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={show}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            show();
          }
        }}
      >
        {icon}
        <span>{selected?.label || value || label}</span>
        <ChevronDown size={13} className="choice-chevron" />
      </button>
      <div
        ref={panel}
        popover="auto"
        className="choice-panel"
        onToggle={(event) =>
          setOpen(event.currentTarget.matches(":popover-open"))
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close(true);
            return;
          }
          if (event.key === "Tab") {
            close(true);
            return;
          }
          const items = Array.from(
            panel.current?.querySelectorAll<HTMLButtonElement>(
              '[role="option"]:not(:disabled)',
            ) || [],
          );
          const current = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          if (event.key === "Enter" && event.target === search.current) {
            event.preventDefault();
            items[0]?.click();
            return;
          }
          let next = current;
          if (event.key === "ArrowDown") next = (current + 1) % items.length;
          else if (event.key === "ArrowUp")
            next = current <= 0 ? items.length - 1 : current - 1;
          else if (event.target !== search.current && event.key === "Home")
            next = 0;
          else if (event.target !== search.current && event.key === "End")
            next = items.length - 1;
          else return;
          event.preventDefault();
          items[next]?.focus();
        }}
      >
        <div className="choice-title">{label}</div>
        {searchable && (
          <div className="choice-search">
            <Search size={14} />
            <input
              ref={search}
              aria-label={`搜索${label}`}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}
        <div
          className="choice-options"
          id={id}
          role="listbox"
          aria-label={label}
        >
          {filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              disabled={option.disabled}
              onClick={() => {
                onChange(option.value);
                close(true);
              }}
            >
              <span>
                <span className="choice-option-label">{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </span>
              {option.value === value ? (
                <Check size={15} />
              ) : (
                <span className="choice-check-space" />
              )}
            </button>
          ))}
          {!filtered.length && <p className="choice-empty">没有匹配的选项</p>}
        </div>
      </div>
    </div>
  );
}
