"use client";
import { MarkdownBody } from "@/features/workspace/shared";
import type { useNativeHistory } from "./use-native-history";

export function NativeHistoryView({
  value,
}: {
  value: ReturnType<typeof useNativeHistory>;
}) {
  const { history, busy, error, earlier, refresh } = value;
  return (
    <>
      <div className="native-history-actions">
        {history?.nextBefore != null && (
          <button type="button" disabled={busy} onClick={() => void earlier()}>
            加载较早记录
          </button>
        )}
        <button
          type="button"
          disabled={busy || !value.available}
          onClick={() => void refresh()}
        >
          {busy ? "同步历史…" : "刷新历史"}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          历史同步失败：{error}
        </p>
      )}
      {history?.reset && (
        <p className="native-note">远端记录已变化，已重新载入最新历史。</p>
      )}
      {history?.summaryOnly && (
        <div className="native-note native-summary-card">
          <strong>历史摘要</strong>
          <p>{history.summary}</p>
          <small>
            {history.reason || "此会话尚无可读取的文本历史"}
            。继续发送仍沿用原会话。
          </small>
        </div>
      )}
      {history?.limited && (
        <p className="native-note">
          部分记录过长、已被上游截断或尚未写完，当前显示可读取的内容。
        </p>
      )}
      {history?.messages.map((message, index) => (
        <div key={`${message.id || index}:${message.role}`}>
          {message.role === "activity" ? (
            <details className="native-history-activity">
              <summary>{message.title || "工具记录"}</summary>
              <pre>{message.text}</pre>
            </details>
          ) : (
            message.text && (
              <div className={`native-message ${message.role}`}>
                <MarkdownBody value={message.text} />
              </div>
            )
          )}
          {message.activity && (
            <details className="native-history-activity">
              <summary>{message.title || "工具调用"}</summary>
              <pre>{message.activity}</pre>
            </details>
          )}
        </div>
      ))}
    </>
  );
}
