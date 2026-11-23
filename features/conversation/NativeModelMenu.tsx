"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import "./native-model-menu.css";

export function NativeModelMenu({ label, effort, disabled, children }: {
  label: string; effort: string; disabled: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="native-model-menu" ref={root}>
    <button type="button" className="native-model-trigger" ref={trigger} aria-label="模型与推理强度" aria-expanded={open && !disabled} aria-haspopup="dialog" title={`${label} · ${effort}`} disabled={disabled} onClick={() => setOpen(value => !value)}>
      <span>{label}</span><small>{effort}</small><ChevronDown size={13} />
    </button>
    {open && !disabled && <section className="native-model-popover" role="dialog" aria-label="模型与推理强度设置">
      <header><strong>模型与推理强度</strong><button type="button" aria-label="关闭模型设置" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={15} /></button></header>
      {children}
      <p>应用于下一轮对话</p>
    </section>}
  </div>;
}
