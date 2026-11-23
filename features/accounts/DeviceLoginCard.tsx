"use client";
import { Check, Copy, ExternalLink, LoaderCircle, X } from "lucide-react";
import type { WorkspaceController } from "../workspace/use-workspace-controller";
export function DeviceLoginCard({
  deviceLoginJob,
  busyAction,
  closeDeviceLogin,
  copy,
  copied,
}: Pick<
  WorkspaceController,
  "deviceLoginJob" | "busyAction" | "closeDeviceLogin" | "copy" | "copied"
>) {
  if (!deviceLoginJob) return null;
  return (
    <div className={`device-auth-card ${deviceLoginJob.status}`}>
      <div className="device-auth-head">
        <div>
          <span>{deviceLoginJob.profile.name}</span>
          <strong>
            {deviceLoginJob.status === "waiting"
              ? "等待你在浏览器完成登录"
              : deviceLoginJob.status === "completed"
                ? "登录成功，Profile 已保存"
                : deviceLoginJob.status === "failed"
                  ? "登录失败"
                  : deviceLoginJob.status === "cancelled"
                    ? "已取消"
                    : "正在请求一次性代码"}
          </strong>
        </div>
        <button
          type="button"
          className="device-auth-dismiss"
          disabled={busyAction === "profile-device-cancel"}
          onClick={closeDeviceLogin}
        >
          {busyAction === "profile-device-cancel" ? (
            <LoaderCircle size={14} className="is-spinning" />
          ) : (
            <X size={14} />
          )}
          {["starting", "waiting"].includes(deviceLoginJob.status)
            ? "取消验证"
            : "关闭"}
        </button>
      </div>
      {deviceLoginJob.userCode && (
        <div className="device-code-row">
          <code>{deviceLoginJob.userCode}</code>
          <button
            type="button"
            onClick={() => copy(deviceLoginJob.userCode, "device-auth-code")}
          >
            {copied === "device-auth-code" ? (
              <Check size={14} />
            ) : (
              <Copy size={14} />
            )}
            复制代码
          </button>
          <a
            href={deviceLoginJob.verificationUrl}
            target="_blank"
            rel="noreferrer"
          >
            打开登录页 <ExternalLink size={13} />
          </a>
        </div>
      )}
      {deviceLoginJob.error && <p>{deviceLoginJob.error}</p>}
    </div>
  );
}
