"use client";
import { useState } from "react";
import { QuestionField, emptyQuestion, questionAnswer, type QuestionValue } from "./QuestionField";
import type { FormField } from "./NativeElicitation";
import { useLocale } from "@/lib/i18n";

export type PermissionRequest = { id: string; tool: string; input: Record<string, unknown>;
  description?: string; reason?: unknown; path?: string; kind?: string;
  options?: { optionId: string; name: string; kind: string }[];
  fields?: FormField[];
};
export function NativePermissionRequest({ request, disabled, respond, provider = "Claude" }: {
  request: PermissionRequest; disabled: boolean; provider?: string;
  respond: (decision: "allow" | "deny", answers?: Record<string, string>, optionId?: string) => void;
}) {
  const { tr } = useLocale();
  const [values, setValues] = useState<Record<string, QuestionValue>>({});
  const questions = request.tool === "AskUserQuestion" && Array.isArray(request.input.questions)
    ? request.input.questions as { question: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }[] : [];
  const answers = Object.fromEntries(questions.map(q => [q.question, questionAnswer(values[q.question] || emptyQuestion)]));
  return <section className="native-approval" aria-label={tr(`${provider} 等待审批`, `${provider} awaiting approval`)}>
    <header>
      <strong>{questions.length ? tr(`${provider} 需要你的回答`, `${provider} needs your input`) : tr(`请求使用 ${request.tool}`, `Requesting ${request.tool}`)}</strong>
      <small>{questions.length ? tr("选择后提交", "Select & submit") : tr("等待确认", "Awaiting approval")}</small>
    </header>
    {request.description && <p>{request.description}</p>}
    {request.path && <p>{tr("路径：", "Path: ")}{request.path}</p>}
    {Boolean(request.reason) && <p>{typeof request.reason === "string" ? request.reason : JSON.stringify(request.reason)}</p>}
    {questions.length ? questions.map((q, index) => <QuestionField key={`${q.question}:${index}`} title={q.question} options={q.options}
      multiple={q.multiSelect} value={values[q.question] || emptyQuestion} disabled={disabled}
      onChange={value => setValues(previous => ({ ...previous, [q.question]: value }))} />)
      : <details className="native-approval-details"><summary>{tr("查看操作详情", "Inspect details")}</summary><pre>{JSON.stringify(request.input, null, 2)}</pre></details>}
    <footer>
      {request.options?.length ? <>
        <button type="button" disabled={disabled} onClick={() => respond("deny")}>{tr("取消", "Cancel")}</button>
        {request.options.map(option => <button type="button" key={option.optionId} disabled={disabled}
          onClick={() => respond(option.kind.startsWith("allow") ? "allow" : "deny", undefined, option.optionId)}>
          {option.name}{option.kind.endsWith("always") && <small>{tr(" · 记住此选择", " · Always")}</small>}
        </button>)}
      </> : <>
        <button type="button" disabled={disabled} onClick={() => respond("deny")}>{questions.length ? tr("暂不回答", "Skip") : tr("拒绝这次", "Deny")}</button>
        <button type="button" disabled={disabled || questions.some(q => !answers[q.question]?.trim())}
          onClick={() => respond("allow", questions.length ? answers : undefined)}>{questions.length ? tr("提交回答", "Submit") : tr("允许这次", "Allow")}</button>
      </>}
    </footer>
  </section>;
}
