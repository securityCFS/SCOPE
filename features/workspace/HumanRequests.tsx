"use client";
import { QuestionField } from "@/features/conversation/QuestionField";
import "./human-requests.css";
import { relativeTime } from "@/features/workspace/shared";
import { ExternalLink, LoaderCircle, Send } from "lucide-react";
import type { WorkspaceController } from "./use-workspace-controller";

export function HumanRequests({
  selectedHumanRequests,
  operatorName,
  clockNow,
  planInputDrafts,
  busyAction,
  setPlanInputDrafts,
  respondToHumanRequest,
  elicitationDrafts,
  setElicitationDrafts,
  answerElicitation,
  answerPlanInput,
}: Pick<
  WorkspaceController,
  | "selectedHumanRequests"
  | "operatorName"
  | "clockNow"
  | "planInputDrafts"
  | "busyAction"
  | "setPlanInputDrafts"
  | "respondToHumanRequest"
  | "elicitationDrafts"
  | "setElicitationDrafts"
  | "answerElicitation"
  | "answerPlanInput"
>) {
  return (
    <>
      {selectedHumanRequests.length > 0 && (
        <section className="detail-section plan-input-section">
          <div className="section-title-row">
            <span className="detail-label">Codex 待处理</span>
            <span>{selectedHumanRequests.length} 个请求</span>
          </div>
          <p className="plan-input-intro">
            需要 {operatorName} 确认的请求会显示在这里，按此会话的权限设置执行。答复将直接返回原会话。
          </p>
          <div className="plan-input-list">
            {selectedHumanRequests.map((input) => (
              <article className="plan-input-card" key={input.key}>
                <div className="plan-input-meta">
                  <span>
                    {input.title} · {input.method}
                  </span>
                  <span>
                    {input.expiresAt
                      ? `剩余 ${Math.max(
                          0,
                          Math.ceil(
                            (Date.parse(input.expiresAt) - clockNow) / 1_000,
                          ),
                        )} 秒`
                      : relativeTime(input.receivedAt)}
                  </span>
                </div>
                {input.kind === "user-input" &&
                  input.questions?.map((question) => {
                    const value =
                      planInputDrafts[input.key]?.[question.id] || "";
                    const optionLabels = new Set(
                      question.options?.map((option) => option.label) || [],
                    );
                    const customValue = optionLabels.has(value) ? "" : value;
                    return <QuestionField key={question.id} title={question.question} options={question.options || []}
                      secret={question.isSecret} allowOther={question.isOther || !question.options?.length}
                      disabled={input.status !== "pending" || busyAction === `human-response:${input.key}`}
                      value={{selected: optionLabels.has(value) ? [value] : [], other: customValue}}
                      onChange={answer => setPlanInputDrafts(current => ({ ...current,
                        [input.key]: { ...(current[input.key] || {}), [question.id]: answer.other || answer.selected[0] || "" },
                      }))} />;
                  })}
                {[
                  "command-approval",
                  "file-change-approval",
                  "legacy-command-approval",
                  "legacy-file-change-approval",
                ].includes(input.kind) && (
                  <div className="human-request-body">
                    {input.reason && (
                      <p className="human-request-reason">{input.reason}</p>
                    )}
                    {input.command && (
                      <pre className="human-request-command">
                        {input.command}
                      </pre>
                    )}
                    {(input.cwd || input.grantRoot) && (
                      <dl className="human-request-facts">
                        {input.cwd && (
                          <>
                            <dt>工作目录</dt>
                            <dd>{input.cwd}</dd>
                          </>
                        )}
                        {input.grantRoot && (
                          <>
                            <dt>请求写入根目录</dt>
                            <dd>{input.grantRoot}</dd>
                          </>
                        )}
                      </dl>
                    )}
                    {input.fileChanges?.map((change) => (
                      <details
                        className="human-request-change"
                        key={change.path}
                      >
                        <summary>
                          {change.type} · {change.path}
                        </summary>
                        <pre>{change.preview}</pre>
                      </details>
                    ))}
                    {Boolean(
                      input.additionalPermissions ||
                      input.networkApprovalContext,
                    ) && (
                      <details className="human-request-change">
                        <summary>附加权限详情</summary>
                        <pre>
                          {JSON.stringify(
                            input.additionalPermissions ||
                              input.networkApprovalContext,
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    )}
                    <div className="human-request-actions">
                      {input.decisionOptions?.map((option) => (
                        <button
                          type="button"
                          className={`human-request-action ${option.tone}`}
                          key={option.id}
                          title={option.description}
                          disabled={
                            input.status !== "pending" ||
                            busyAction === `human-response:${input.key}`
                          }
                          onClick={() =>
                            respondToHumanRequest(input, {
                              decision: option.value,
                            })
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {input.kind === "permissions-approval" && (
                  <div className="human-request-body">
                    {input.reason && (
                      <p className="human-request-reason">{input.reason}</p>
                    )}
                    <dl className="human-request-facts">
                      <dt>工作目录</dt>
                      <dd>{input.cwd || "未提供"}</dd>
                      <dt>环境</dt>
                      <dd>{input.environmentId || "默认环境"}</dd>
                    </dl>
                    <pre className="human-request-json">
                      {JSON.stringify(input.permissions, null, 2)}
                    </pre>
                    <div className="human-request-actions">
                      {input.decisionOptions?.map((option) => (
                        <button
                          type="button"
                          className={`human-request-action ${option.tone}`}
                          key={option.id}
                          title={option.description}
                          disabled={
                            input.status !== "pending" ||
                            busyAction === `human-response:${input.key}`
                          }
                          onClick={() =>
                            respondToHumanRequest(input, {
                              choice: option.value,
                            })
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {input.kind === "mcp-elicitation" && (
                  <div className="human-request-body">
                    <p className="human-request-reason">
                      <strong>{input.serverName || "MCP Server"}</strong>
                      {" · "}
                      {input.message || "需要你的输入"}
                    </p>
                    {input.mode === "url" && input.url && (
                      <a
                        className="human-request-url"
                        href={input.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={14} />
                        打开 MCP 授权页面
                      </a>
                    )}
                    {["form", "openai/form"].includes(input.mode || "") &&
                      input.fields?.map((field) => {
                        const draft =
                          elicitationDrafts[input.key]?.[field.name];
                        const value = draft ?? field.default ?? "";
                        if (field.type === "boolean") {
                          return (
                            <label
                              className="human-request-checkbox"
                              key={field.name}
                            >
                              <input
                                type="checkbox"
                                checked={Boolean(value)}
                                disabled={
                                  input.status !== "pending" ||
                                  busyAction === `human-response:${input.key}`
                                }
                                onChange={(event) =>
                                  setElicitationDrafts((current) => ({
                                    ...current,
                                    [input.key]: {
                                      ...(current[input.key] || {}),
                                      [field.name]: event.target.checked,
                                    },
                                  }))
                                }
                              />
                              <span>
                                <strong>{field.title}</strong>
                                <small>{field.description}</small>
                              </span>
                            </label>
                          );
                        }
                        if (field.type === "array" && field.options) {
                          const selected = Array.isArray(value)
                            ? value.map(String)
                            : [];
                          return (
                            <fieldset key={field.name}>
                              <legend>{field.title}</legend>
                              {field.description && <p>{field.description}</p>}
                              {field.options.map((option) => {
                                const optionValue = String(option.value);
                                return (
                                  <label
                                    className="human-request-checkbox"
                                    key={optionValue}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selected.includes(optionValue)}
                                      disabled={
                                        input.status !== "pending" ||
                                        busyAction ===
                                          `human-response:${input.key}`
                                      }
                                      onChange={(event) => {
                                        const next = event.target.checked
                                          ? [...selected, optionValue]
                                          : selected.filter(
                                              (item) => item !== optionValue,
                                            );
                                        setElicitationDrafts((current) => ({
                                          ...current,
                                          [input.key]: {
                                            ...(current[input.key] || {}),
                                            [field.name]: next,
                                          },
                                        }));
                                      }}
                                    />
                                    <span>{option.label}</span>
                                  </label>
                                );
                              })}
                            </fieldset>
                          );
                        }
                        return (
                          <label className="plan-input-custom" key={field.name}>
                            <span>
                              {field.title}
                              {field.required ? " *" : ""}
                            </span>
                            {field.options ? (
                              <select
                                value={String(value)}
                                disabled={
                                  input.status !== "pending" ||
                                  busyAction === `human-response:${input.key}`
                                }
                                onChange={(event) =>
                                  setElicitationDrafts((current) => ({
                                    ...current,
                                    [input.key]: {
                                      ...(current[input.key] || {}),
                                      [field.name]: event.target.value,
                                    },
                                  }))
                                }
                              >
                                <option value="">请选择</option>
                                {field.options.map((option) => (
                                  <option
                                    value={String(option.value)}
                                    key={String(option.value)}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={
                                  field.type === "number" ||
                                  field.type === "integer"
                                    ? "number"
                                    : field.format === "date"
                                      ? "date"
                                      : field.format === "date-time"
                                        ? "datetime-local"
                                        : "text"
                                }
                                value={String(value)}
                                disabled={
                                  input.status !== "pending" ||
                                  busyAction === `human-response:${input.key}`
                                }
                                placeholder={field.description}
                                onChange={(event) =>
                                  setElicitationDrafts((current) => ({
                                    ...current,
                                    [input.key]: {
                                      ...(current[input.key] || {}),
                                      [field.name]: event.target.value,
                                    },
                                  }))
                                }
                              />
                            )}
                          </label>
                        );
                      })}
                    {!input.renderable && (
                      <p className="plan-input-error">
                        当前 CLI 返回了无法安全渲染的表单类型；仍可拒绝或取消，
                        不会让远端 Turn 卡住。
                      </p>
                    )}
                    <div className="human-request-actions">
                      <button
                        type="button"
                        className="human-request-action accept"
                        disabled={
                          !input.renderable ||
                          input.status !== "pending" ||
                          busyAction === `human-response:${input.key}`
                        }
                        onClick={() => answerElicitation(input, "accept")}
                      >
                        接受并提交
                      </button>
                      <button
                        type="button"
                        className="human-request-action danger"
                        disabled={
                          input.status !== "pending" ||
                          busyAction === `human-response:${input.key}`
                        }
                        onClick={() => answerElicitation(input, "decline")}
                      >
                        拒绝
                      </button>
                      <button
                        type="button"
                        className="human-request-action danger"
                        disabled={
                          input.status !== "pending" ||
                          busyAction === `human-response:${input.key}`
                        }
                        onClick={() => answerElicitation(input, "cancel")}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
                {input.error && (
                  <p className="plan-input-error">{input.error}</p>
                )}
                {input.kind === "user-input" && (
                  <button
                    type="button"
                    className="plan-input-submit"
                    disabled={
                      input.status !== "pending" ||
                      busyAction === `human-response:${input.key}`
                    }
                    onClick={() => answerPlanInput(input)}
                  >
                    {busyAction === `human-response:${input.key}` ? (
                      <LoaderCircle size={15} className="is-spinning" />
                    ) : (
                      <Send size={15} />
                    )}
                    {input.status === "disconnected"
                      ? "app-server 已断开"
                      : busyAction === `human-response:${input.key}`
                        ? "正在回传"
                        : "提交并继续 Codex"}
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
