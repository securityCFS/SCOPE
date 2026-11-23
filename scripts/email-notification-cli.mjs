import path from "node:path";
import { createEmailNotifier } from "../bridge/email-notifier.mjs";

const action = process.argv[2] || "status";
const stateDirectory = path.resolve(process.cwd(), ".scope");
const notifier = await createEmailNotifier({
  configPath: path.join(stateDirectory, "email-notifications.json"),
  statePath: path.join(stateDirectory, "email-notification-state.json"),
});

if (action === "status") {
  console.log(JSON.stringify(notifier.publicState(), null, 2));
} else if (action === "verify") {
  console.log(JSON.stringify(await notifier.verify(), null, 2));
} else if (action === "test") {
  const result = await notifier.notify({
    key: `manual-test:${Date.now()}`,
    severity: "test",
    title: "SCOPE 邮件通知测试",
    summary: "邮件通知 hook 已成功连接并可发送重要告警。",
    details: ["这是一封手动触发的测试邮件。"],
    timestamp: new Date().toISOString(),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.sent) process.exitCode = 1;
} else {
  throw new Error("Usage: email-notification-cli.mjs [status|verify|test]");
}
