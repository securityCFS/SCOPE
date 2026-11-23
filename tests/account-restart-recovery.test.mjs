import { bridgeSource } from "./helpers/bridge-source.mjs";
import { workspaceSource } from "./helpers/workspace-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";

test("account restart resumes from the current process directory and verifies the TUI", async () => {
  const bridge = await bridgeSource();
  const start = bridge.indexOf("const TAKEOVER_PROBE = String.raw`");
  const end = bridge.indexOf("const NEW_SESSION_PREFLIGHT", start);
  const takeoverProbe = bridge.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(
    takeoverProbe,
    /cwd_prompt = "Choose working directory to resume this session"/,
  );
  assert.match(
    takeoverProbe,
    /\["tmux", "send-keys", "-t", pane_target, "Down", "Enter"\]/,
  );
  assert.match(takeoverProbe, /cwd_choice = "current"/);
  assert.match(takeoverProbe, /and cwd_prompt not in preview/);
  assert.match(takeoverProbe, /"cwdChoice": cwd_choice/);
});

test("account restart only reconnects Bridge-owned app-server sessions", async () => {
  const [bridge, page] = await Promise.all([
    bridgeSource(),
    workspaceSource(),
  ]);
  const start = bridge.indexOf("function startAuthRestart(hostAlias)");
  const end = bridge.indexOf("appServerManager.on(\"change\"", start);
  const restart = bridge.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(restart, /appServerManager\s*\.sessionRecords\(\)/);
  assert.match(restart, /transport: "app-server"/);
  assert.match(restart, /retireProfileAppServerCommand\(writerKey\)/);
  assert.match(restart, /connectionKey: "active"/);
  assert.match(restart, /activeProfileMigrationSessions\.add/);
  assert.match(restart, /await persistAppServerSessions\(\)/);
  assert.match(restart, /const fallbackExecutable = hostCodexExecutable\(host\)/);
  assert.doesNotMatch(restart, /host\.agents\.find\(\(agent\) => agent\.executable\)/);
  assert.match(restart, /startTurn\(hostAlias, resumed\.sessionId, "继续"/);
  assert.match(restart, /appServerAuthRecoveryHosts\.add\(hostAlias\)/);
  assert.doesNotMatch(restart, /transport: "tmux"/);
  assert.doesNotMatch(restart, /resumeAgentInTmux\(/);
  assert.doesNotMatch(restart, /candidate\.agent\.pid/);
  assert.match(bridge, /auth-restart-jobs\.json/);
  assert.match(bridge, /loadAuthRestartJobs\(\)/);
  assert.match(bridge, /restartJob: latestAuthRestartJob/);
  assert.match(page, /恢复到 App Server/);
  assert.match(page, /恢复到 tmux/);
  assert.match(page, /setAuthRestartJob\(result\.restartJob \|\| null\)/);
});

test("a disconnected app-server instruction recovers the managed host before delivery", async () => {
  const bridge = await bridgeSource();
  const start = bridge.indexOf('if (url.pathname === "/api/session/instruct"');
  const end = bridge.indexOf('if (url.pathname === "/api/session/compact"', start);
  const instruct = bridge.slice(start, end);

  assert.match(instruct, /recoverHostAppServerSessions\(body\.host\)/);
  assert.match(instruct, /deliveryMode: "recovered-continue"/);
  assert.match(instruct, /appServerManager\.startTurn\(body\.host, body\.sessionId, "继续"/);
  assert.match(instruct, /replaying the original instruction could submit/);
});

test("external VS Code and CLI sessions cannot be terminated by recovery APIs", async () => {
  const [bridge, page] = await Promise.all([
    bridgeSource(),
    workspaceSource(),
  ]);

  assert.doesNotMatch(bridge, /os\.kill\(pid/);
  assert.doesNotMatch(bridge, /signal\.SIG(?:TERM|KILL)/);
  assert.doesNotMatch(bridge, /tmux kill-session/);
  assert.doesNotMatch(bridge, /\["tmux", "kill-session"/);
  assert.match(
    bridge,
    /安全策略禁止终止或接管活动 CLI\/VS Code Session/g,
  );
  assert.match(bridge, /if \(Number\(pid\) > 0\)/);
  assert.match(
    page,
    /\(!selectedAgent\.historical &&\s*!selectedAgent\.appServerManaged\)/,
  );
  assert.match(page, /外部 VS Code\/CLI Session 只读保护中/);
});

test("tmux recovery is idempotent and never destroys an existing pane", async () => {
  const bridge = await bridgeSource();
  const start = bridge.indexOf("const TAKEOVER_PROBE = String.raw`");
  const end = bridge.indexOf("const NEW_SESSION_PREFLIGHT", start);
  const takeoverProbe = bridge.slice(start, end);

  assert.match(takeoverProbe, /def existing_tmux\(\):/);
  assert.match(takeoverProbe, /"reused": True/);
  assert.match(takeoverProbe, /为保护现有进程，拒绝覆盖或终止/);
  assert.doesNotMatch(takeoverProbe, /cleanup_tmux/);
  assert.doesNotMatch(takeoverProbe, /kill-session/);
  assert.match(bridge, /lifecycle-audit\.jsonl/);
  assert.match(bridge, /remoteSessionSignalSent: false/);
});

test("history recovery never mistakes a cached record for a live process", async () => {
  const [bridge, page] = await Promise.all([
    bridgeSource(),
    workspaceSource(),
  ]);
  const lookupStart = bridge.indexOf("function findLiveAgent(host, sessionId)");
  const lookupEnd = bridge.indexOf("function shellQuote", lookupStart);
  const lookup = bridge.slice(lookupStart, lookupEnd);
  const takeoverStart = bridge.indexOf(
    'if (url.pathname === "/api/session/takeover"',
  );
  const appServerStart = bridge.indexOf(
    'url.pathname === "/api/app-server/connect"',
    takeoverStart,
  );
  const appServerEnd = bridge.indexOf(
    'if (url.pathname === "/api/events"',
    appServerStart,
  );

  assert.notEqual(lookupStart, -1);
  assert.match(lookup, /function findAgent\(host, sessionId\)/);
  assert.match(lookup, /const live = findLiveAgent\(host, sessionId\)/);
  assert.match(lookup, /return historicalSessions\.get\(sessionKey\(host, sessionId\)\)/);
  assert.match(
    bridge.slice(takeoverStart, appServerStart),
    /const activeAgent = findLiveAgent\(body\.host, body\.sessionId\)/,
  );
  assert.match(
    bridge.slice(appServerStart, appServerEnd),
    /const activeAgent = findLiveAgent\(body\.host, body\.sessionId\)/,
  );
  assert.match(
    bridge,
    /async function recoveryAgent\(agent, activeAgent, requestedCwd\)/,
  );
  assert.match(bridge, /历史 Session 必须明确选择新的恢复工作目录/);
  assert.match(bridge, /拒绝恢复到临时目录/);
  assert.match(
    bridge,
    /const resumedAgent = await recoveryAgent\(agent, activeAgent, body\.cwd\)/,
  );
  assert.match(page, /恢复到工作目录/);
  assert.match(page, /relevant\.unshift\(\{ cwd: agent\.cwd/);
  assert.doesNotMatch(page, /activeCwds\.has\(cwd\)/);
  assert.match(
    page,
    /selectedAgent\.historical &&\s*!selectedRecoveryCwd\.trim\(\)/,
  );
});
