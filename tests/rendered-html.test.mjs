import { bridgeSource } from "./helpers/bridge-source.mjs";
import { workspaceSource } from "./helpers/workspace-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the SCOPE local control shell without fake hosts", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>SCOPE · 跨项目 Agent 工作台<\/title>/i);
  assert.match(html, /跨项目工作台/);
  assert.match(html, /系统状态/);
  assert.match(html, /SSH Bridge/);
  assert.match(html, /重连中/);
  assert.match(html, /打开设置/);
  assert.match(html, /正在连接工作台/);
  assert.match(html, /等待服务恢复/);
  assert.doesNotMatch(html, /监控与人工请求正常/);
  assert.match(html, />Operator</);
  assert.doesNotMatch(html, new RegExp("Yi" + "fei", "i"));
  assert.match(html, /工作台导航/);
  assert.match(html, /总调度/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("keeps SSH discovery, management state, and write paths explicit", async () => {
  const [
    page,
    bridge,
    appServerClient,
    capacityRecovery,
    layout,
    gitignore,
    readme,
    remoteLinks,
  ] =
    await Promise.all([
      workspaceSource(),
      bridgeSource(),
      readFile(
        new URL("../bridge/app-server-client.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../bridge/capacity-recovery.mjs", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
      readFile(new URL("../.gitignore", import.meta.url), "utf8"),
      readFile(new URL("../README.md", import.meta.url), "utf8"),
      readFile(new URL("../lib/remote-links.js", import.meta.url), "utf8"),
    ]);

  assert.match(page, /http:\/\/127\.0\.0\.1:4815/);
  assert.match(page, /\/scope-api/);
  assert.match(page, /bridgeUrl/);
  assert.match(page, /AI 更新摘要/);
  assert.match(page, /重命名 Session/);
  assert.match(page, /用 Codex 总结/);
  assert.match(page, /扫描 W&B/);
  assert.match(page, /复制调度 Prompt/);
  assert.match(page, /剩余 \$\{Math\.max/);
  assert.match(page, /scope:inspector-width/);
  assert.match(page, /setPointerCapture/);
  assert.match(page, /SSH 终端/);
  assert.match(page, /SshTerminalPanel/);
  assert.match(page, /复制 Context JSON/);
  assert.match(page, /复制原始回复/);
  assert.match(page, /copyLatestAssistantReply/);
  assert.match(bridge, /RAW_CONTEXT_PROBE/);
  assert.match(bridge, /\/api\/session\/raw-context/);
  assert.match(bridge, /\/api\/operator/);
  assert.match(page, /完整 Dialogue \/ Timeline/);
  assert.match(page, /纯对话/);
  assert.match(page, /指令操作/);
  assert.match(page, /思考过程/);
  assert.match(page, /最新在前/);
  assert.match(page, /展开可见/);
  assert.match(page, /Codex 最新回复/);
  assert.match(page, /会话权限/);
  assert.match(page, /启动前命令/);
  assert.match(page, /保存为设备默认/);
  assert.match(page, /YOLO（不审批、完整权限）/);
  assert.match(page, /受控（按需审批、仅工作区可写）/);
  assert.match(page, /resumeInTmuxCommand/);
  assert.match(page, /tmux new-session -A/);
  assert.match(page, /全部工作目录/);
  assert.match(page, /历史 Session 默认不扫描/);
  assert.match(page, /Inactive Session 排序/);
  assert.match(page, /最近执行优先/);
  assert.match(page, /最久未执行优先/);
  assert.match(page, /最后执行 \$\{relativeTime/);
  assert.match(page, /\/api\/history\/scan/);
  assert.match(page, /ReactMarkdown/);
  assert.match(page, /remarkGfm/);
  assert.match(page, /remarkMath/);
  assert.match(page, /rehypeKatex/);
  assert.match(page, /InspectorModule/);
  assert.match(page, /scope:ui-theme/);
  assert.match(page, /scope:host-sidebar-collapsed/);
  assert.match(page, /加载更早 10 条消息/);
  assert.match(page, /limit: 10/);
  assert.match(page, /RemoteWorkdirLink/);
  assert.doesNotMatch(page, /href=\{vscodeRemoteUri/);
  assert.doesNotMatch(remoteLinks, /vscode:\/\/vscode-remote/);
  assert.match(page, /remoteFileTargetFromMarkdownHref/);
  assert.match(page, /remote-markdown-link/);
  assert.match(page, /requestVscodeOpen/);
  assert.match(page, /\/api\/vscode\/open/);
  assert.match(bridge, /launchVscodeRemoteFile/);
  assert.match(page, /takeoverSession/);
  assert.match(page, /inspector-head-actions/);
  assert.match(page, /inspector-transport-switch/);
  assert.match(page, /Session 运行模式/);
  assert.match(page, /new-conversation-advanced/);
  assert.match(page, /App Server/);
  assert.match(page, /tmux TUI/);
  assert.match(page, /inspector-collapsible/);
  assert.match(page, /inspectorSectionOpen/);
  assert.match(page, /onToggle=\{\(event\) =>/);
  assert.match(page, /SESSION_RENDER_BATCH/);
  assert.match(page, /renderedAgents\.map/);
  assert.match(page, /selectedDialogueExpanded/);
  assert.match(page, /renderedDialogueEvents\.map/);
  assert.match(page, /session-reply-composer/);
  assert.match(page, /继续对话/);
  assert.match(page, /高级会话控制/);
  assert.match(page, /Codex 待处理/);
  assert.match(page, /connectAppServer/);
  assert.match(page, /answerPlanInput/);
  assert.match(page, /answerElicitation/);
  assert.match(page, /permissions-approval/);
  assert.match(page, /\/api\/app-server\/respond/);
  assert.match(page, /\/api\/session\/create/);
  assert.match(page, /\/api\/remote\/directories/);
  assert.match(page, /选择目录/);
  assert.match(page, /使用此目录/);
  assert.match(bridge, /REMOTE_DIRECTORY_PROBE/);
  assert.match(await readFile(new URL("../bridge/workbench/directory-probe.mjs", import.meta.url), "utf8"), /os\.path\.isdir\(candidate\)/);
  assert.match(await readFile(new URL("../bridge/workbench/directory-routes.mjs", import.meta.url), "utf8"), /\/api\/remote\/directories/);
  assert.match(page, /\/api\/session\/instruct/);
  assert.match(page, /\/api\/session\/compact/);
  assert.match(page, /\/api\/submissions\/scan/);
  assert.match(page, /实验提交归属/);
  assert.match(page, /打开提交 Session/);
  assert.match(page, /完整 DLC 调用审计/);
  assert.match(page, /邮件通知/);
  assert.match(page, /系统状态/);
  assert.match(page, /查看未计入精确提交尝试的 wrapper、帮助与 dry-run/);
  assert.match(page, /DLC 提交追踪时间范围/);
  assert.match(bridge, /SCOPE_DLC_SSH_HOSTNAME/);
  assert.match(page, /auditedDlcCalls\.confirmed\.map/);
  assert.match(page, /output-only/);
  assert.match(page, /程序化调用/);
  assert.match(page, /打开调用 Session/);
  assert.match(page, /selectAgentAndReveal/);
  assert.match(page, /24h 新会话/);
  assert.match(page, /Session 创建的运行任务/);
  assert.match(page, /同一 SSH 主机上的后台训练 \/ 评测/);
  assert.match(page, /该 Session 提交的远程 DLC 训练/);
  assert.match(page, /workloadConfidenceLabel/);
  assert.match(page, /agent\.localWorkloads/);
  assert.match(page, /agent\.remoteJobs/);
  assert.match(page, /查找会话/);
  assert.match(page, /\/api\/assistant\/query/);
  assert.match(page, /openResearchAssistantCandidate/);
  assert.match(page, /reward regressed goal z/);
  assert.match(page, /按最近占用的 GPU 过滤/);
  assert.match(page, /最近 GPU 占用/);
  assert.match(page, /gpuActivityEpisodes/);
  assert.match(page, /snapshot\.hosts\.length === 0/);
  assert.match(page, /\/api\/history\/cache/);
  assert.match(page, /inactiveAgents\.length === 0/);
  assert.match(page, /excludeActiveSessions\(historyState\.sessions, allAgents\)/);
  assert.match(page, /selectedDialoguePending/);
  assert.match(page, /读取完整 Markdown/);
  assert.match(page, /codexPaneKeys/);
  assert.match(page, /if \(pane\.dead\) return false/);
  assert.match(page, /hasLiveWorkload/);
  assert.match(page, /instructionAttemptRef/);
  assert.match(page, /deliveryId/);
  assert.match(page, /closeDeviceLogin/);
  assert.match(page, /取消验证/);
  assert.match(page, /deleteAuthProfile/);
  assert.match(page, /profile-delete-action/);

  assert.match(bridge, /\/proc\/\$pid\/cwd/);
  assert.match(bridge, /sessionPaths/);
  assert.match(bridge, /mapping:\s*\{/);
  assert.match(bridge, /rollout:\s*matched \? "open-fd" : "unmatched"/);
  assert.match(bridge, /tmux:\s*pane \? "tty" : "unmatched"/);
  assert.match(bridge, /\/api\/summarize/);
  assert.match(bridge, /next\.displayName/);
  assert.match(bridge, /current\.summary\?\.source === "manual"/);
  assert.match(bridge, /\/api\/experiments\/discover/);
  assert.match(bridge, /\/api\/prompt\/sync/);
  assert.match(bridge, /\/api\/dialogue/);
  assert.match(bridge, /page_limit = max\(1, min\(100/);
  assert.match(bridge, /before_byte/);
  assert.match(bridge, /SCOPE_ACK/);
  assert.match(bridge, /SCOPE_ACK\|#\{pane_current_command\}/);
  assert.match(bridge, /scope_delivery_/);
  assert.match(bridge, /deduplicated/);
  assert.doesNotMatch(bridge, /os\.kill\(pid/);
  assert.match(bridge, /安全策略禁止终止活动 CLI\/VS Code Session/);
  assert.match(bridge, /rootProcessCandidates/);
  assert.match(bridge, /candidate\.sessionPaths\?\.length/);
  assert.match(bridge, /sleep 0\.35/);
  assert.match(bridge, /hostFailureStreaks/);
  assert.match(bridge, /hostNextScanAt/);
  assert.match(bridge, /scanDeferred/);
  assert.match(bridge, /snapshot-cache\.json/);
  assert.match(bridge, /history-index\.json/);
  assert.match(bridge, /\/api\/history\/cache/);
  assert.match(bridge, /loadSnapshotCache\(\)/);
  assert.match(bridge, /loadHistoryIndex\(\)/);
  assert.match(bridge, /scanAll\(\{ force: true \}\)/);
  assert.match(bridge, /\/api\/history\/scan/);
  assert.match(bridge, /historicalSessions/);
  assert.match(bridge, /latest_event/);
  assert.match(bridge, /timestamp_epoch/);
  assert.match(bridge, /Date\.parse\(rollout\.lastEventAt/);
  assert.match(bridge, /~\/\.codex\/sessions\/\*\*\/\*\.jsonl/);
  assert.match(bridge, /\/api\/session\/takeover/);
  assert.match(bridge, /resumeAgentInTmux/);
  assert.match(bridge, /switchedFrom/);
  assert.match(bridge, /SCOPE_PROXY_BOOTSTRAP_HOSTS/);
  assert.match(bridge, /wrapBootstrapAppServer/);
  assert.match(bridge, /shutil\.which\("zsh"\)/);
  assert.match(bridge, /create_args\.append\("exec zsh -ic/);
  assert.match(bridge, /create_args\.append\("exec bash -ic/);
  assert.match(bridge, /pane_target = f"\{tmux_name\}:0\.0"/);
  assert.match(bridge, /def existing_tmux/);
  assert.doesNotMatch(bridge, /def fail_after_tmux/);
  assert.doesNotMatch(bridge, /tmux kill-session/);
  assert.match(bridge, /withTakeoverHostQueue/);
  assert.match(bridge, /pane_command in \("codex", "node"\)/);
  assert.match(bridge, /inventoryOperations/);
  assert.doesNotMatch(bridge, /f"=\{tmux_name\}"/);
  assert.match(bridge, /--yolo/);
  assert.match(bridge, /--ask-for-approval on-request --sandbox workspace-write/);
  assert.match(bridge, /\/api\/runtime\/config/);
  assert.match(bridge, /hostRuntimeConfig/);
  assert.match(bridge, /\/api\/app-server\/connect/);
  assert.match(bridge, /VSCODE_OPEN_PREFLIGHT/);
  assert.match(bridge, /normalizeRemoteFileTarget/);
  assert.match(bridge, /line: target\?\.line/);
  assert.match(bridge, /\/api\/app-server\/respond/);
  assert.match(bridge, /\/api\/auth\/profiles\/delete/);
  assert.match(bridge, /PROFILE_DELETE_PROBE/);
  assert.match(bridge, /marker_slug/);
  assert.match(bridge, /APP_SERVER_HANDOFF_PROBE/);
  assert.match(bridge, /SUBMISSION_PROBE/);
  assert.match(bridge, /SUBMITTED\\s\+job=/);
  assert.match(bridge, /programmatic_submit_pattern/);
  assert.match(bridge, /calls_by_rpc/);
  assert.match(bridge, /scanScope/);
  assert.match(bridge, /isSubagent/);
  assert.match(bridge, /\/api\/submissions\/scan/);
  assert.match(bridge, /\/api\/session\/create/);
  assert.match(bridge, /\/api\/session\/instruct/);
  assert.match(bridge, /\/api\/session\/compact/);
  assert.match(bridge, /panePid/);
  assert.match(bridge, /WORKLOAD\\t/);
  assert.match(bridge, /assignWorkloadOwners/);
  assert.match(bridge, /ancestorPids/);
  assert.match(bridge, /ownerSessionId/);
  assert.match(bridge, /enrichAgentRelations/);
  assert.match(bridge, /ASSISTANT_SEARCH_PROBE/);
  assert.match(bridge, /\/api\/assistant\/query/);
  assert.match(bridge, /runLocalCodex/);
  assert.match(bridge, /科研 Session 检索助手/);
  assert.match(bridge, /gpu-usage-history\.json/);
  assert.match(bridge, /updateGpuUsageHistory/);
  assert.match(bridge, /publicGpuUsage/);
  assert.match(bridge, /detectTmuxCapacityFailures/);
  assert.match(bridge, /runTmuxCapacityContinuation/);
  assert.match(bridge, /cancelTmuxCapacityRecovery/);
  assert.match(appServerClient, /scheduleCapacityContinuation/);
  assert.match(appServerClient, /CAPACITY_CONTINUE_PROMPT/);
  assert.match(capacityRecovery, /selected model is/i);
  assert.match(capacityRecovery, /CAPACITY_CONTINUE_PROMPT = "继续"/);
  assert.match(appServerClient, /thread\/compact\/start/);
  assert.match(appServerClient, /thread\/unsubscribe/);
  assert.match(appServerClient, /releaseSession/);
  assert.match(appServerClient, /thread\/start/);
  assert.match(appServerClient, /turn\/start/);
  assert.match(appServerClient, /item\/tool\/requestUserInput/);
  assert.match(appServerClient, /item\/commandExecution\/requestApproval/);
  assert.match(appServerClient, /item\/fileChange\/requestApproval/);
  assert.match(appServerClient, /item\/permissions\/requestApproval/);
  assert.match(appServerClient, /mcpServer\/elicitation\/request/);
  assert.match(appServerClient, /execCommandApproval/);
  assert.match(appServerClient, /applyPatchApproval/);
  assert.match(appServerClient, /scope-client-/);
  assert.match(bridge, /该 Session 已由 PID/);
  assert.match(bridge, /TRUSTED_BROWSER_ORIGINS/);
  assert.doesNotMatch(
    bridge,
    /setHeader\("Access-Control-Allow-Origin",\s*"\*"\)/,
  );
  assert.match(bridge, /hiddenReasoningCount/);
  assert.match(bridge, /MAX_TOOL_EVENTS = 300/);
  assert.match(bridge, /last_agent_message/);
  assert.match(bridge, /"category": category/);
  assert.match(bridge, /127\.0\.0\.1/);

  assert.match(layout, /SCOPE · 跨项目 Agent 工作台/);
  assert.match(gitignore, /\/\.scope\//);
  assert.match(readme, /SCOPE/);
  assert.match(readme, /MIT/);
  assert.match(readme, /deployment\.example\.json/);
  assert.match(readme, /127\.0\.0\.1|localhost/);
});
