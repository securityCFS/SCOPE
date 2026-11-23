import { CircleAlert, LoaderCircle } from "lucide-react";
import "./session-status.css";

export function SessionStatus({
  status,
  historical,
}: {
  status: string;
  historical: boolean;
}) {
  const state = historical ? "history" : status;
  const label =
    state === "working"
      ? "执行中"
      : state === "attention"
        ? "需要处理"
        : state === "history"
          ? "历史会话"
          : "空闲";
  return (
    <span
      className="project-session-status"
      data-state={state}
      role="img"
      aria-label={label}
      title={label}
    >
      {state === "working" ? (
        <LoaderCircle size={12} />
      ) : state === "attention" ? (
        <CircleAlert size={12} />
      ) : (
        <span />
      )}
    </span>
  );
}
