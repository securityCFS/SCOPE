"use client";
import { useId } from "react";
import { useLocale } from "@/lib/i18n";
import "./question-field.css";

export type QuestionChoice = { label: string; description?: string; value?: string };
export type QuestionValue = { selected: string[]; other: string };
export const emptyQuestion: QuestionValue = { selected: [], other: "" };
export function questionAnswer(value: QuestionValue) {
  return [...value.selected, ...(value.other.trim() ? [value.other.trim()] : [])].join(", ");
}

/** Controlled field: selections survive polling, and never submit on a click. */
export function QuestionField({ title, options = [], multiple = false, disabled = false,
  allowOther = true, secret = false, value, onChange }: {
  title: string; options?: QuestionChoice[]; multiple?: boolean; disabled?: boolean;
  allowOther?: boolean; secret?: boolean; value: QuestionValue; onChange: (value: QuestionValue) => void;
}) {
  const { tr } = useLocale();
  const id = useId();
  return <fieldset className="scope-question" disabled={disabled}>
    <legend>{title}</legend>
    {multiple && <small className="scope-question-hint">{tr("可多选", "Multi-select")}</small>}
    <div className="scope-question-options">
      {options.map((option, index) => {
        const key = option.value ?? option.label;
        return <label className="scope-question-option" key={`${key}:${index}`}>
          <input type={multiple ? "checkbox" : "radio"} name={id} checked={value.selected.includes(key)}
            onChange={() => onChange({ selected: multiple
              ? value.selected.includes(key) ? value.selected.filter(item => item !== key) : [...value.selected, key]
              : [key], other: multiple ? value.other : "" })} />
          <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
        </label>;
      })}
    </div>
    {(allowOther || !options.length) && <label className="scope-question-other">
      <span>{options.length ? tr("其他回答", "Other") : tr("你的回答", "Your answer")}</span>
      <input type={secret ? "password" : "text"} autoComplete="off" aria-label={tr(`${title} · 其他回答`, `${title} · Other`)}
        value={value.other} maxLength={10000} placeholder={multiple ? tr("也可以补充自己的答案", "Or type a custom answer") : tr("输入自己的答案", "Type your answer")}
        onChange={event => onChange({ selected: multiple ? value.selected : [], other: event.target.value })} />
    </label>}
  </fieldset>;
}
