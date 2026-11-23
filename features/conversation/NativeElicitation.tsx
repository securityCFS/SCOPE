"use client";
import { useState } from "react";
import { QuestionField } from "./QuestionField";
import { useLocale } from "@/lib/i18n";

export type FormField = { name: string; title: string; description?: string; type: string; required: boolean;
  options?: { label: string; value: string }[]; minimum?: number; maximum?: number; minLength?: number;
  maxLength?: number; minItems?: number; maxItems?: number; default?: unknown; };
export function NativeElicitation({ fields, message, disabled, respond }: { fields: FormField[]; message?: string; disabled: boolean;
  respond: (decision: "allow" | "deny" | "cancel", content?: Record<string, unknown>) => void }) {
  const { tr } = useLocale();
  const [content, setContent] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.filter(f => f.default !== undefined).map(f => [f.name, f.default])));
  function update(name: string, value: unknown) { setContent(previous => {
    const next = { ...previous }; if (value === undefined) delete next[name]; else next[name] = value; return next;
  }); }
  const invalid = fields.some(f => {
    const v = content[f.name];
    if (v === undefined || v === "") return f.required;
    if (typeof v === "string") return v.length < (f.minLength || 0) || v.length > (f.maxLength || 10000);
    if (typeof v === "number") return !Number.isFinite(v) || (f.type === "integer" && !Number.isInteger(v)) || v < (f.minimum ?? -Infinity) || v > (f.maximum ?? Infinity);
    return Array.isArray(v) && (v.length < (f.minItems || 0) || v.length > (f.maxItems || 100));
  });
  return <section className="native-approval" aria-label={tr("Antigravity 需要你的回答", "Antigravity needs your input")}>
    <header><strong>{tr("Antigravity 需要你的回答", "Antigravity needs your input")}</strong><small>{tr("选择后提交", "Select & submit")}</small></header>
    {message && <p>{message}</p>}
    {fields.map(f => <div key={f.name}>
      {f.description && <p>{f.description}</p>}
      {f.options?.length || f.type === "boolean" ? <QuestionField title={`${f.title}${f.required ? " *" : ""}`} disabled={disabled}
        options={f.type === "boolean" ? [{label: tr("是", "Yes"),value:"true"},{label: tr("否", "No"),value:"false"}] : f.options}
        multiple={f.type === "array"} allowOther={false}
        value={{ selected: content[f.name] === undefined ? [] : Array.isArray(content[f.name]) ? content[f.name] as string[] : [String(content[f.name])], other:"" }}
        onChange={value => update(f.name, f.type === "array" ? value.selected : f.type === "boolean" ? value.selected[0] === "true" : value.selected[0])} />
        : <label className="scope-form-field"><span>{f.title}{f.required ? " *" : ""}</span>
          <input disabled={disabled} type={["number","integer"].includes(f.type) ? "number" : "text"}
            value={String(content[f.name] ?? "")} min={f.minimum} max={f.maximum} step={f.type === "integer" ? 1 : "any"}
            minLength={f.minLength} maxLength={f.maxLength || 10000}
            onChange={e => update(f.name, e.target.value === "" ? undefined : ["number","integer"].includes(f.type) ? Number(e.target.value) : e.target.value)} />
        </label>}
    </div>)}
    <footer><button disabled={disabled} onClick={() => respond("cancel")}>{tr("取消", "Cancel")}</button><button disabled={disabled} onClick={() => respond("deny")}>{tr("暂不回答", "Skip")}</button>
      <button disabled={disabled || invalid} onClick={() => respond("allow", content)}>{tr("提交回答", "Submit")}</button></footer>
  </section>;
}
