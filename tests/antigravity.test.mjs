import test from "node:test";
import assert from "node:assert/strict";

test("Claude uses auto and passes selected effort and model without global configuration changes", () => {
  const command = cliCommand({ provider: "claude", prompt: "investigate", cwd: "/work", effort: "xhigh", permissionMode: "auto", resumeSessionId: "existing" }, { executable: "claude", preLaunchCommand: "source ~/.proxy.sh", model: "opus" });
  assert.match(command, /--permission-mode 'auto'/);
  assert.match(command, /--effort 'xhigh'/);
  assert.match(command, /--model 'opus'/);
  assert.match(command, /--resume 'existing'/);
  assert.doesNotMatch(command, /bypassPermissions|dangerously-skip/);
});
import { defaultWorkbenchConfig, validateWorkbenchConfig } from "../lib/workbench-config.js";
import { cliCommand, parseCliResult } from "../bridge/providers/cli-command.mjs";

test("AGY auto uses sandbox and explicit effort; plan is separate from permission bypass", () => {
  const task = { provider: "antigravity", prompt: "inspect", cwd: "/tmp/test", effort: "high", permissionMode: "auto" };
  const command = cliCommand(task, defaultWorkbenchConfig().providers.antigravity);
  assert.match(command, /--mode auto --sandbox/);
  assert.match(command, /--effort 'high'/);
  assert.doesNotMatch(command, /dangerously-skip|always-proceed/);
  assert.match(cliCommand({ ...task, permissionMode: "plan" }, defaultWorkbenchConfig().providers.antigravity), /--mode plan/);
});

test("AGY full access explicitly skips permissions and preserves optional proxy, model and history", () => {
  const command = cliCommand({ provider: "antigravity", prompt: "continue", cwd: "/work", permissionMode: "full", effort: "medium", resumeSessionId: "old-session" }, { ...defaultWorkbenchConfig().providers.antigravity, preLaunchCommand: "source ~/.proxy.sh", model: "gemini-2.5-pro-medium" });
  assert.match(command, /^source ~\/\.proxy\.sh\nscope_proxy_status=/);
  assert.match(command, /--dangerously-skip-permissions/);
  assert.match(command, /--conversation 'old-session'/);
  assert.match(command, /--model 'gemini-2.5-pro-medium'/);
  assert.match(command, /--effort 'medium'/);
  assert.doesNotMatch(command, /--mode auto|--sandbox|accept-edits/);
  assert.doesNotMatch(cliCommand({ provider: "antigravity", prompt: "read", cwd: "/work" }, defaultWorkbenchConfig().providers.antigravity), /dangerously-skip-permissions/);
});

test("headless permission denial is not reported as a completed task", () => {
  const fallback = parseCliResult("antigravity", { status: "completed", stderr: "warning: --mode auto is not available for this account; continuing in the default mode.", stdout: '{"status":"SUCCESS","response":"partial","conversation_id":"a"}' });
  assert.equal(fallback.status, "failed");
  assert.equal(fallback.errorCode, "permission_mode_unavailable");
  assert.equal(fallback.text, "partial");
  const result = parseCliResult("antigravity", { status: "completed", code: 0, stdout: JSON.stringify({ status: "SUCCESS", response: "", conversation_id: "a", denied_actions: [{ action: "command", display_name: "RunCommand" }] }) });
  assert.equal(result.status, "failed");
  assert.match(result.error, /RunCommand/);
  assert.equal(result.sessionId, "a");
  assert.equal(parseCliResult("claude", { status: "completed", stdout: JSON.stringify({ type: "result", result: "partial", permission_denials: [{ tool_name: "Bash" }] }) }).status, "failed");
});

test("workspace permission mode is scoped and does not bypass all approvals", () => {
  const command = cliCommand({ provider: "antigravity", prompt: "edit UI", cwd: "/workspace", permissionMode: "workspace" }, defaultWorkbenchConfig().providers.antigravity);
  assert.match(command, /--mode accept-edits --sandbox/);
  assert.match(command, /proceed-in-sandbox/);
  assert.match(command, /"allowNonWorkspaceAccess":false/);
  assert.doesNotMatch(command, /dangerously-skip-permissions/);
});

test("legacy configuration gains a disabled Antigravity provider without mutation", () => {
  const old = defaultWorkbenchConfig();
  delete old.providers.antigravity;
  const migrated = validateWorkbenchConfig(old);
  assert.equal(migrated.providers.antigravity.preLaunchCommand, "");
  assert.equal(migrated.providers.antigravity.enabled, false);
  assert.equal(old.providers.antigravity, undefined);
  assert.doesNotThrow(() => validateWorkbenchConfig(migrated));
});
test("Antigravity startup runs directly when empty and gates optional pre-launch commands", () => {
  const provider = defaultWorkbenchConfig().providers.antigravity;
  const direct = cliCommand({ provider: "antigravity", cwd: "/tmp/space dir", prompt: "a ' quote; $(false)", resumeSessionId: "session-123" }, provider);
  assert.match(direct, /^cd -- '\/tmp\/space dir'/);
  assert.match(direct, /--conversation 'session-123'/);
  assert.match(direct, /--output-format json/);
  assert.ok(direct.includes("'a '\"'\"' quote; $(false)'"));
  const proxied = cliCommand({ provider: "antigravity", cwd: "/work", prompt: "hi" }, { ...provider, preLaunchCommand: "source ~/.proxy.sh" });
  assert.match(proxied, /^source ~\/\.proxy\.sh\nscope_proxy_status=/);
  assert.match(proxied, /exit "\$scope_proxy_status"/);
});
test("Antigravity validates the JSON envelope, recovers the session ID and reports errors", () => {
  const result = parseCliResult("antigravity", { status: "completed", stdout: 'banner\n{"status":"SUCCESS","response":"OK","conversation_id":"abc"}\n' });
  assert.equal(result.text, "OK");
  assert.equal(result.sessionId, "abc");
  assert.equal(result.status, "completed");
  assert.equal(parseCliResult("antigravity", { status: "completed", stdout: '{"status":"ERROR","error":"auth missing"}' }).error, "auth missing");
  assert.equal(parseCliResult("antigravity", { status: "completed", stdout: 'not JSON' }).status, "failed");
});
test("nonzero CLI exits still expose structured API errors and never become success", () => {
  const failure = parseCliResult("claude", { status: "failed", code: 1, stdout: JSON.stringify({ type: "result", is_error: true, result: "API Error: 402 Insufficient balance", session_id: "abc" }) });
  assert.equal(failure.status, "failed");
  assert.equal(failure.error, "API Error: 402 Insufficient balance");
  assert.equal(failure.sessionId, "abc");
  assert.equal(parseCliResult("antigravity", { status: "failed", code: 1, stdout: '{"status":"SUCCESS","response":"partial"}' }).status, "failed");
});
test("Claude prompt is quoted in argv so shell startup cannot consume it as commands", () => {
  const prompt = "This is a test; $(false) ' quote";
  const command = cliCommand({ provider: "claude", prompt, cwd: "/tmp/smoke" }, defaultWorkbenchConfig().providers.claude);
  assert.ok(command.includes("'claude' -p 'This is a test; $(false) '\"'\"' quote'"));
});
