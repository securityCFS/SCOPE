export const manifest = Object.freeze({
  protocolVersion: 1,
  id: "aliyun-dlc",
  name: "阿里云 DLC",
  version: "1.0.0",
  description: "关联提交记录、实验归属与运行状态。不会提交或停止任务。",
  capabilities: ["ssh:read", "sessions:read", "submissions:read"],
  permissions: ["读取所选 SSH 主机的会话记录", "查询 DLC 任务状态"],
  settings: [{ key: "host", type: "ssh-host", label: "提交主机", placeholder: "SSH 别名或 HostName", requiredWhenEnabled: true }],
  actions: [{ id: "scan", label: "刷新提交记录", result: "submission-tracker/v1" }],
  view: "submission-tracker/v1",
});
