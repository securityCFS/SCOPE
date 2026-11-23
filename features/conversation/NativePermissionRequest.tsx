"use client";
import { useState } from "react";
import { QuestionField, emptyQuestion, questionAnswer, type QuestionValue } from "./QuestionField";
import type { FormField } from "./NativeElicitation";

export type PermissionRequest = { id: string; tool: string; input: Record<string, unknown>;
  description?: string; reason?: unknown; path?: string; kind?: string;
  options?: { optionId: string; name: string; kind: string }[];
  fields?: FormField[];
};
export function NativePermissionRequest({ request, disabled, respond, provider = "Claude" }: {
  request: PermissionRequest; disabled: boolean; provider?: string;
  respond: (decision: "allow" | "deny", answers?: Record<string, string>, optionId?: string) => void;
}) {
  const [values, setValues] = useState<Record<string, QuestionValue>>({});
  const questions = request.tool === "AskUserQuestion" && Array.isArray(request.input.questions)
    ? request.input.questions as { question: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }[] : [];
  const answers = Object.fromEntries(questions.map(q => [q.question, questionAnswer(values[q.question] || emptyQuestion)]));
  return <section className="native-approval" aria-label={`${provider} 等待审批`}>
    <header><strong>{questions.length ? `${provider} 需要你的回答` : `请求使用 ${request.tool}`}</strong><small>{questions.length ? "选择后提交" : "等待确认"}</small></header>
    {request.description && <p>{request.description}</p>}
    {request.path && <p>路径：{request.path}</p>}
    {Boolean(request.reason) && <p>{typeof request.reason === "string" ? request.reason : JSON.stringify(request.reason)}</p>}
    {questions.length ? questions.map((q, index) => <QuestionField key={`${q.question}:${index}`} title={q.question} options={q.options}
      multiple={q.multiSelect} value={values[q.question] || emptyQuestion} disabled={disabled}
      onChange={value => setValues(previous => ({ ...previous, [q.question]: value }))} />)
      : <details className="native-approval-details"><summary>查看操作详情</summary><pre>{JSON.stringify(request.input, null, 2)}</pre></details>}
    <footer>
      {request.options?.length ? <>
        <button type="button" disabled={disabled} onClick={() => respond("deny")}>取消</button>
        {request.options.map(option => <button type="button" key={option.optionId} disabled={disabled}
          onClick={() => respond(option.kind.startsWith("allow") ? "allow" : "deny", undefined, option.optionId)}>
          {option.name}{option.kind.endsWith("always") && <small> · 记住此选择</small>}
        </button>)}
      </> : <>
        <button type="button" disabled={disabled} onClick={() => respond("deny")}>{questions.length ? "暂不回答" : "拒绝这次"}</button>
        <button type="button" disabled={disabled || questions.some(q => !answers[q.question]?.trim())}
          onClick={() => respond("allow", questions.length ? answers : undefined)}>{questions.length ? "提交回答" : "允许这次"}</button>
      </>}
    </footer>
  </section>;
}
