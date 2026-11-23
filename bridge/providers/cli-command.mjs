export const shellQuote = (value) =>
  `'${String(value).replaceAll("'", `'"'"'`)}'`;

export function cliCommand(task, provider) {
  const executable = shellQuote(provider.executable);
  const setup = String(provider?.preLaunchCommand || "").trim();
  let command;
  if (task.provider === "claude") {
    command = [
      executable,
      "-p",
      shellQuote(task.prompt),
      "--output-format json",
      `--permission-mode ${shellQuote(task.permissionMode === "workspace" ? "acceptEdits" : task.permissionMode || "auto")}`,
      task.effort ? `--effort ${shellQuote(task.effort)}` : "",
      "--max-turns 30",
      provider.model ? `--model ${shellQuote(provider.model)}` : "",
      task.resumeSessionId
        ? `--resume ${shellQuote(task.resumeSessionId)}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  } else if (task.provider === "antigravity") {
    command = [executable, "-p", shellQuote(task.prompt), "--output-format json",
      task.effort ? `--effort ${shellQuote(task.effort)}` : "",
      task.permissionMode === "auto" ? "--mode auto --sandbox" : task.permissionMode === "plan" ? "--mode plan" : "",
      task.permissionMode === "full" ? "--dangerously-skip-permissions" : "",
      task.permissionMode === "workspace" ? `--mode accept-edits --sandbox --settings ${shellQuote(JSON.stringify({ toolPermission: "proceed-in-sandbox", allowNonWorkspaceAccess: false, artifactReviewPolicy: "always-proceed" }))}` : "",
      provider.model ? `--model ${shellQuote(provider.model)}` : "",
      task.resumeSessionId ? `--conversation ${shellQuote(task.resumeSessionId)}` : "",
    ].filter(Boolean).join(" ");
  } else if (task.provider === "dsh") {
    command = `${executable} --profile headless ${shellQuote(task.prompt)}`;
  } else throw new Error("此 Agent 不使用 CLI 传输");
  // Interactive bash loads the same function/alias setup as a remote terminal.
  // Explicit status check prevents a failed proxy hook from launching the agent.
  const bootstrap = setup
    ? `${setup}\nscope_proxy_status=$?\nif [ "$scope_proxy_status" -ne 0 ]; then exit "$scope_proxy_status"; fi\n`
    : "";
  return `${bootstrap}cd -- ${shellQuote(task.cwd)} || exit 72\n${task.gpuIndices?.length ? `export CUDA_VISIBLE_DEVICES=${shellQuote(task.gpuIndices.join(","))}\n` : ""}exec ${command}`;
}

export function parseCliResult(provider, result) {
  if (result.status === "failed" && provider === "dsh")
    return {
      ...result,
      text: result.stdout || "",
      error:
        result.error ||
        `远端命令退出（${result.code ?? "未知退出码"}），请查看执行日志`,
    };
  if (!["completed", "failed"].includes(result.status)) return result;
  if (provider === "dsh")
    return { ...result, text: result.stdout || "任务已结束，没有文本输出。" };
  const lines = (result.stdout || "").trim().split("\n");
  let value;
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const candidate = JSON.parse(lines[index]);
      if (provider === "antigravity"
        ? ["SUCCESS", "ERROR"].includes(candidate.status)
        : candidate.type === "result") {
        value = candidate;
        break;
      }
    } catch {
      /* shell startup can print banners */
    }
  }
  if (!value)
    return {
      ...result,
      status: "failed",
      error: result.error || (result.status === "failed"
        ? `远端命令退出（${result.code ?? "未知退出码"}），请查看执行日志`
        : `${provider} 没有返回有效结果 JSON；请检查远端输出`),
      text: result.stdout,
    };
  if (provider === "antigravity" && /auto is not available|continuing in the default mode/i.test(result.stderr || "")) return {
    ...result, status: "failed", text: value.response || "", sessionId: value.conversation_id || null,
    errorCode: "permission_mode_unavailable",
    error: "AGY 未按所选 auto 权限执行：当前账号不支持，CLI 已退回默认权限。本轮可能已执行部分操作，请核对结果；选择可用权限后再继续。",
  };
  if (provider === "antigravity") return {
    ...result,
    status: value.status === "SUCCESS" && result.status !== "failed" && !value.denied_actions?.length ? "completed" : "failed",
    error: value.denied_actions?.length ? `部分操作需要权限，尚未执行：${value.denied_actions.map((action) => action.display_name || action.action).join("、")}。可调整下一轮权限后继续；网页当前不支持交互审批。` : value.error || (result.status === "failed" ? `Antigravity 退出（${result.code ?? "未知"}）` : value.status === "SUCCESS" ? null : "Antigravity 执行失败"),
    text: value.response || "",
    errorCode: value.denied_actions?.length ? "permission_required" : null,
    sessionId: value.conversation_id || null,
  };
  return {
    ...result,
    status: value.is_error || result.status === "failed" || value.permission_denials?.length ? "failed" : "completed",
    error: value.permission_denials?.length ? "Claude 的部分操作需要权限，尚未执行；可选择工作区权限继续，或在原终端审批。" : value.is_error
      ? value.result || value.errors?.join("\n") || "Claude 执行失败"
      : result.status === "failed" ? `Claude 退出（${result.code ?? "未知"}）` : null,
    text: value.result || "",
    errorCode: value.permission_denials?.length ? "permission_required" : null,
    sessionId: value.session_id || null,
  };
}
