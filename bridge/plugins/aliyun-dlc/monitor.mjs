import path from "node:path";
import { SUBMISSION_PROBE } from "./probe.mjs";

/** Read-only Aliyun scanner; all host access is injected by the trusted host. */
export function createSubmissionMonitor({ settings, context, notify, onScanComplete, defaultWindowDays }) {
  let submissionScanPromise = null;
  const empty = () => ({ scannedAt: null, scanning: false, windowDays: defaultWindowDays,
    targetHostname: settings().enabled ? settings().host : "", items: [], calls: [], launches: [], alerts: [], hosts: [], error: null });
  let submissionTracker = empty();
async function scan(
  limit = 100,
  windowDays = defaultWindowDays,
) {
  const DLC_SSH_HOSTNAME = settings().enabled ? settings().host : "";
  const { readSshConfig, sshAliasesForHostname, getSnapshot, runSshCommand, cleanSshError, mapLimit, findAgent, getManagement, sessionKey, heuristicSummary } = context();
  if (!DLC_SSH_HOSTNAME) return submissionTracker;
  if (submissionScanPromise) return submissionScanPromise;
  submissionScanPromise = (async () => {
    submissionTracker = {
      ...submissionTracker,
      scanning: true,
      error: null,
    };
    notify();
    let dlcAliases = new Set([DLC_SSH_HOSTNAME]);
    try {
      dlcAliases = sshAliasesForHostname(
        await readSshConfig(),
        DLC_SSH_HOSTNAME,
      );
    } catch {
      // The inventory already reports a config read failure. Keep the literal
      // DLC host as a conservative fallback instead of scanning unrelated hosts.
    }
    const normalizedWindowDays = Math.max(
      0,
      Math.min(3650, Number(windowDays) || 0),
    );
    const targets = getSnapshot().hosts.filter(
      (host) => host.reachable && dlcAliases.has(host.alias),
    );
    if (!targets.length) {
      submissionTracker = {
        ...submissionTracker,
        scanning: false,
        targetHostname: DLC_SSH_HOSTNAME,
        error: `当前没有指向 ${DLC_SSH_HOSTNAME} 的可连接 SSH 主机`,
      };
      notify();
      return submissionTracker;
    }
    const scans = await mapLimit(
      targets,
      Math.min(4, targets.length),
      async (host) => {
        const result = await runSshCommand(
          host.alias,
          `python3 - ${Math.max(20, Math.min(500, limit))} ${normalizedWindowDays}`,
          SUBMISSION_PROBE,
          75_000,
          12_000_000,
        );
        if (result.code !== 0) {
          return {
            host: host.alias,
            filesScanned: 0,
            totalFiles: 0,
            submissions: [],
            calls: [],
            launches: [],
            error: cleanSshError(result.stderr || result.stdout),
          };
        }
        try {
          return {
            host: host.alias,
            ...JSON.parse(result.stdout.trim()),
            error: null,
          };
        } catch {
          return {
            host: host.alias,
            filesScanned: 0,
            totalFiles: 0,
            submissions: [],
            calls: [],
            launches: [],
            error: "提交追踪结果无法解析",
          };
        }
      },
    );
    const evidenceOwner = (hostAlias, evidence) => {
      const host = getSnapshot().hosts.find(
        (candidate) => candidate.alias === hostAlias,
      );
      const directAgent = findAgent(hostAlias, evidence.sessionId);
      const parentAgent = host?.agents.find((agent) =>
        (agent.subagents || []).some(
          (subagent) => subagent.id === evidence.sessionId,
        ),
      );
      const activeAgent = directAgent || parentAgent || null;
      const rollout = host?.sessions.find(
        (session) => session.id === evidence.sessionId,
      );
      const managed =
        getManagement().sessions[sessionKey(hostAlias, evidence.sessionId)] ||
        (evidence.parentThreadId
          ? getManagement().sessions[
              sessionKey(hostAlias, evidence.parentThreadId)
            ] || {}
          : {});
      const theme =
        managed.displayName ||
        managed.summary?.theme ||
        (rollout ? heuristicSummary(rollout, evidence.cwd).theme : "") ||
        evidence.sessionObjective ||
        `${path.posix.basename(evidence.cwd || "") || "未命名"} Session`;
      return {
        active: Boolean(activeAgent),
        sessionTheme: evidence.isSubagent ? `${theme} · subagent` : theme,
      };
    };
    const items = scans
      .flatMap((scan) =>
        scan.submissions.map((item) => {
          return {
            ...item,
            host: scan.host,
            ...evidenceOwner(scan.host, item),
          };
        }),
      )
      .sort(
        (a, b) =>
          Date.parse(b.submittedAt || "") - Date.parse(a.submittedAt || ""),
      );
    const calls = scans
      .flatMap((scan) =>
        (scan.calls || []).map((call) => ({
          ...call,
          host: scan.host,
          ...evidenceOwner(scan.host, call),
        })),
      )
      .sort(
        (a, b) =>
          Date.parse(b.timestamp || "") - Date.parse(a.timestamp || ""),
      );
    const launches = scans
      .flatMap((scan) =>
        scan.launches.map((launch) => ({ ...launch, host: scan.host })),
      )
      .sort(
        (a, b) =>
          Date.parse(b.timestamp || "") - Date.parse(a.timestamp || ""),
      );
    const grouped = new Map();
    for (const item of items) {
      if (item.ownershipSource !== "tool-call") continue;
      const key = `${item.host}:${item.sessionId}`;
      const group = grouped.get(key) || {
        host: item.host,
        sessionId: item.sessionId,
        sessionTheme: item.sessionTheme,
        cwd: item.cwd,
        total: 0,
        failed: 0,
        queued: 0,
        running: 0,
      };
      group.total += 1;
      if (/fail|fault|stopp|cancel|kill/i.test(item.status || "")) {
        group.failed += 1;
      }
      if (/queu|enqueued|pending/i.test(item.status || "")) group.queued += 1;
      if (/running/i.test(item.status || "")) group.running += 1;
      grouped.set(key, group);
    }
    const alerts = Array.from(grouped.values())
      .filter(
        (group) =>
          (group.failed >= 2 && group.queued > 0) ||
          (group.total >= 4 && group.failed / group.total >= 0.75),
      )
      .sort((a, b) => b.failed - a.failed);
    submissionTracker = {
      scannedAt: new Date().toISOString(),
      scanning: false,
      windowDays: normalizedWindowDays,
      targetHostname: DLC_SSH_HOSTNAME,
      items,
      calls,
      launches,
      alerts,
      hosts: scans.map(
        ({
          submissions,
          calls: hostCalls = [],
          launches: hostLaunches,
          ...scan
        }) => ({
            ...scan,
            submissions: submissions.length,
            calls: hostCalls.length,
            launches: hostLaunches.length,
          }),
      ),
      error:
        scans.every((scan) => scan.error) && scans.length
          ? "所有在线主机的提交扫描都失败"
          : null,
    };
    await onScanComplete(submissionTracker);
    notify();
    return submissionTracker;
  })()
    .catch((error) => {
      submissionTracker = {
        ...submissionTracker,
        scanning: false,
        error: error.message,
      };
      notify();
      return submissionTracker;
    })
    .finally(() => {
      submissionScanPromise = null;
    });
  return submissionScanPromise;
}

  return { scan, busy: () => Boolean(submissionScanPromise), snapshot: () => submissionTracker,
    reset() { if (submissionScanPromise) throw new Error("等待扫描结束后修改配置"); submissionTracker = empty(); } };
}
