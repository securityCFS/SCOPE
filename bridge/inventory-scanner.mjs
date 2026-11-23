import path from "node:path";

export function parseSshAliases(source) {
  const aliases = new Set();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*Host\s+(.+?)\s*$/i);
    if (!match) continue;
    for (const value of match[1].split(/\s+/)) {
      if (value && !/[*?!]/.test(value)) aliases.add(value);
    }
  }
  return [...aliases].sort((a, b) => a.localeCompare(b));
}

export function decodeBase64Url(value) {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

export function cleanSshError(stderr) {
  const line = stderr
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("META\t"));
  if (!line) return "SSH 连接失败";
  if (/timed out/i.test(line)) return "连接超时";
  if (/permission denied/i.test(line)) return "认证失败";
  if (/could not resolve/i.test(line)) return "无法解析主机";
  if (/host key verification failed/i.test(line)) return "主机密钥未确认";
  return line.replace(/^ssh:\s*/i, "").slice(0, 160);
}

export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  return results;
}

export function createInventoryScanner({
  REMOTE_PROBE,
  shellQuote,
  guardPersistentCodexHome,
  persistentCodexHomes,
  SSH_TIMEOUT_MS,
  INVENTORY_TIMEOUT_MS,
  inventoryOperations,
  spawn,
  heuristicSummary,
  preserveHostSessions,
}) {
  // Keep plain function declarations in order: inventory-transport tests extract this slice for vm execution.
  function sessionFingerprintPayload(previous) {
    const fingerprints = {};
    for (const session of previous?.sessions || []) {
      if (
        typeof session?.path !== "string" ||
        !Number.isFinite(session?.mtimeMs) ||
        !Number.isFinite(session?.sizeBytes)
      ) {
        continue;
      }
      fingerprints[session.path] = [session.mtimeMs, session.sizeBytes];
    }
    return Buffer.from(JSON.stringify(fingerprints), "utf8").toString("base64url");
  }

  function inventoryProbe(previous) {
    const fingerprints = sessionFingerprintPayload(previous);
    if (!fingerprints) return REMOTE_PROBE;
    return `export SCOPE_SESSION_FINGERPRINTS_B64=${shellQuote(fingerprints)}\n${REMOTE_PROBE}`;
  }

  function runSsh(alias, previous) {
    const operation = new Promise((resolve) => {
      const startedAt = Date.now();
      const child = spawn(
        (typeof process !== "undefined" && process.platform === "win32" ? "ssh.exe" : "ssh"),
        [
          "-T",
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          "ConnectionAttempts=1",
          "-o",
          `ConnectTimeout=${Math.ceil(SSH_TIMEOUT_MS / 1000)}`,
          "-o",
          "ServerAliveInterval=10",
          "-o",
          "ServerAliveCountMax=2",
          "--",
          alias,
          // Keep Windows argv bounded. The growing probe/cache travels on stdin.
          guardPersistentCodexHome("sh -s", persistentCodexHomes[alias]),
        ],
        { windowsHide: true },
      );

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        child.kill();
      }, INVENTORY_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        if (stdout.length < 4_000_000) stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 20_000) stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        stderr += `\n${error.message}`;
      });
      child.stdin.on("error", (error) => {
        // SSH may exit before the whole probe has been written (EPIPE).
        stderr += `\n${error.message}`;
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
          timedOut,
          latencyMs: Date.now() - startedAt,
        });
      });
      child.stdin.end(inventoryProbe(previous));
    }).catch((error) => ({
      code: 1,
      stdout: "",
      stderr: `SSH inventory launch failed: ${error.message}`,
      timedOut: false,
      latencyMs: 0,
    }));
    inventoryOperations.set(alias, operation);
    const cleanup = () => {
      if (inventoryOperations.get(alias) === operation) {
        inventoryOperations.delete(alias);
      }
    };
    // Do not create an unobserved rejected promise with .finally().
    operation.then(cleanup, cleanup);
    return operation;
  }

  function commandSignatures(value) {
    const text = String(value || "");
    const signatures = new Set();
    for (const match of text.matchAll(
      /(?:^|[\s"'=])((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:py|sh|ya?ml|json))(?:\s|$|["'])/gi,
    )) {
      signatures.add(path.posix.basename(match[1]).toLowerCase());
    }
    for (const match of text.matchAll(
      /(?:^|\s)-m\s+([A-Za-z_][A-Za-z0-9_.-]+)/g,
    )) {
      signatures.add(match[1].toLowerCase());
    }
    return signatures;
  }

  function intersectSignatures(left, right) {
    return [...left].filter((value) => right.has(value));
  }

  function assignWorkloadOwners(host) {
    const rootSessions = host.sessions.filter((session) => !session.isSubagent);
    const sessionsById = new Map(rootSessions.map((session) => [session.id, session]));
    for (const subagent of host.sessions.filter((session) => session.isSubagent)) {
      const parent = sessionsById.get(subagent.parentThreadId);
      if (!parent || !subagent.launches?.length) continue;
      parent.launches = [...(parent.launches || []), ...subagent.launches].slice(-120);
    }
    const activeBySession = new Map(
      host.agents
        .filter((agent) => agent.rollout?.id)
        .map((agent) => [agent.rollout.id, agent]),
    );
    const cwdCounts = new Map();
    for (const session of rootSessions) {
      if (!session.cwd) continue;
      cwdCounts.set(session.cwd, (cwdCounts.get(session.cwd) || 0) + 1);
    }
    const now = Date.now();

    for (const workload of host.workloads) {
      const pane =
        host.panes.find((candidate) => candidate.tty === workload.tty) || null;
      workload.pane = pane
        ? {
            session: pane.session,
            pane: pane.pane,
            tty: pane.tty,
            cwd: pane.cwd,
            command: pane.command,
          }
        : null;
      const workloadSignatures = commandSignatures(workload.cmdline);
      const startedAt = now - Math.max(0, workload.elapsedSeconds || 0) * 1_000;
      const candidates = rootSessions.map((session) => {
        const agent = activeBySession.get(session.id);
        let score = 0;
        const evidence = [];
        if (agent && workload.ancestorPids.includes(agent.pid)) {
          score = 100;
          evidence.push(`进程树包含 Codex PID ${agent.pid}`);
        }
        if (
          agent &&
          workload.tty &&
          workload.tty !== "?" &&
          workload.tty === agent.tty
        ) {
          score = Math.max(score, 96);
          evidence.push(`与 Codex 共用 TTY ${agent.tty}`);
        }

        for (const launch of session.launches || []) {
          const launchTime = Date.parse(launch.timestamp || "");
          const launchSignatures = commandSignatures(launch.command);
          const shared = intersectSignatures(
            workloadSignatures,
            launchSignatures,
          );
          const paneNamed =
            pane?.session &&
            new RegExp(
              `(?:^|\\s)(?:-s|-t)\\s+${pane.session.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
            ).test(launch.command);
          if (paneNamed) {
            score = Math.max(score, 94);
            evidence.push(`rollout 启动了 tmux ${pane.session}`);
          }
          if (
            shared.length &&
            Number.isFinite(launchTime) &&
            launchTime <= startedAt + 5 * 60_000 &&
            startedAt - launchTime <= 48 * 60 * 60_000
          ) {
            const sameCwd =
              workload.cwd &&
              session.cwd &&
              (workload.cwd === session.cwd ||
                workload.cwd.startsWith(`${session.cwd}/`));
            score = Math.max(score, sameCwd ? 92 : 86);
            evidence.push(`启动命令匹配 ${shared.slice(0, 3).join(", ")}`);
            if (sameCwd) evidence.push("启动目录一致");
          }
        }

        if (
          workload.cwd &&
          session.cwd &&
          workload.cwd === session.cwd &&
          cwdCounts.get(session.cwd) === 1
        ) {
          score = Math.max(score, 68);
          evidence.push("唯一活跃 Session 的工作目录一致");
        }
        return { session, score, evidence };
      });
      candidates.sort((left, right) => right.score - left.score);
      const best = candidates[0];
      const runnerUp = candidates[1];
      const unambiguous =
        best &&
        (best.score >= 85 ||
          (best.score >= 65 && best.score - (runnerUp?.score || 0) >= 15));
      workload.ownerSessionId = unambiguous ? best.session.id : null;
      workload.ownerConfidence = !unambiguous
        ? "unmatched"
        : best.score >= 95
          ? "exact"
          : best.score >= 85
            ? "strong"
            : "inferred";
      workload.ownerScore = unambiguous ? best.score : best?.score || 0;
      workload.ownerEvidence = unambiguous
        ? [...new Set(best.evidence)].slice(0, 6)
        : best?.score
          ? ["存在候选 Session，但证据不足或归属冲突"]
          : ["没有找到对应的 rollout 启动证据"];
    }
  }

  function parseHost(alias, result, previous) {
    if (result.code !== 0) {
      return {
        alias,
        reachable: false,
        latencyMs: result.latencyMs,
        error: result.timedOut
          ? "资源扫描超时"
          : cleanSshError(result.stderr || result.stdout),
        hostname: null,
        processes: [],
        workloads: [],
        panes: [],
        sessions: [],
        agents: [],
        gpus: [],
      };
    }

    const host = {
      alias,
      reachable: true,
      latencyMs: result.latencyMs,
      error: null,
      inventoryError: null,
      inventoryUpdatedAt: new Date().toISOString(),
      hostname: alias,
      processes: [],
      workloads: [],
      panes: [],
      sessions: [],
      agents: [],
      gpus: [],
    };
    const previousSessions = new Map(
      (previous?.sessions || []).map((session) => [session.path, session]),
    );

    for (const rawLine of result.stdout.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      const fields = line.split("\t");

      if (fields[0] === "META") {
        host.hostname = fields.slice(1).join("\t") || alias;
      } else if (fields[0] === "PROC" && fields.length >= 7) {
        host.processes.push({
          pid: Number(fields[1]),
          elapsedSeconds: Number(fields[2]),
          stat: fields[3],
          tty: fields[4],
          command: fields[5],
          cwd: fields.slice(6).join("\t"),
          cmdline: "",
          sessionPaths: [],
        });
      } else if (fields[0] === "PROCESS_META" && fields[1]) {
        try {
          const metadata = JSON.parse(decodeBase64Url(fields[1]));
          const process = host.processes.find(
            (candidate) => candidate.pid === metadata.pid,
          );
          if (process) {
            process.cmdline = metadata.cmdline || "";
            process.sessionPaths = Array.isArray(metadata.sessionPaths)
              ? metadata.sessionPaths
              : [];
          }
        } catch {
          // Keep this process explicitly unmatched when metadata cannot be decoded.
        }
      } else if (fields[0] === "WORKLOAD" && fields[1]) {
        try {
          host.workloads.push(JSON.parse(decodeBase64Url(fields[1])));
        } catch {
          // Keep scanning when one process record races with process exit.
        }
      } else if (fields[0] === "PANE" && fields.length >= 11) {
        if (fields[1].startsWith("scope-app-server-")) continue;
        host.panes.push({
          session: fields[1],
          pane: fields[2],
          command: fields[3],
          cwd: fields[4],
          tty: fields[5].replace(/^\/dev\//, ""),
          pid: Number(fields[6]),
          activityAt: Number(fields[7]) * 1000 || null,
          dead: fields[8] === "1",
          exitStatus: fields[9] === "" ? null : Number(fields[9]),
          preview: Buffer.from(fields[10] || "", "base64").toString("utf8").trimEnd(),
        });
      } else if (fields[0] === "GPU") {
        const gpuFields = fields.slice(1).join("\t").split(",").map((item) => item.trim());
        const hasUuid = gpuFields.length >= 6;
        host.gpus.push({
          index: Number(gpuFields[0]),
          uuid: hasUuid ? gpuFields[1] || "" : "",
          name: gpuFields[hasUuid ? 2 : 1] || "GPU",
          utilization: Number(gpuFields[hasUuid ? 3 : 2]) || 0,
          memoryUsed: Number(gpuFields[hasUuid ? 4 : 3]) || 0,
          memoryTotal: Number(gpuFields[hasUuid ? 5 : 4]) || 0,
        });
      } else if (fields[0] === "SESSION" && fields[1]) {
        try {
          host.sessions.push(JSON.parse(decodeBase64Url(fields[1])));
        } catch {
          // Ignore a single malformed rollout record.
        }
      } else if (fields[0] === "SESSION_REF" && fields[1]) {
        const cached = previousSessions.get(decodeBase64Url(fields[1]));
        if (cached) host.sessions.push(cached);
      }
    }

    host.sessions = preserveHostSessions(previous, host).sessions;
    host.sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const rootProcessCandidates = host.processes.filter(
      (proc) =>
        (proc.command === "codex" ||
          (proc.command === "node" &&
            /(?:^|\s)(?:\S*\/)?codex(?:\s|$)/.test(proc.cmdline || ""))) &&
        !/(^|\s)app-server(?:\s|$)/.test(proc.cmdline || ""),
    );
    const rootProcesses = rootProcessCandidates.filter((process) => {
      if (process.sessionPaths?.length) return true;
      return !rootProcessCandidates.some(
        (candidate) =>
          candidate.pid !== process.pid &&
          candidate.tty === process.tty &&
          candidate.cwd === process.cwd &&
          candidate.sessionPaths?.length,
      );
    });
    const now = Date.now();

    host.agents = rootProcesses.map((process) => {
      const openPaths = new Set(process.sessionPaths || []);
      const activeSessions = host.sessions.filter((session) =>
        openPaths.has(session.path),
      );
      const rootSessions = activeSessions.filter((session) => !session.isSubagent);
      const matched =
        rootSessions.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ||
        activeSessions.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ||
        null;
      const subagents = activeSessions
        .filter((session) => session.isSubagent)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      const pane = host.panes.find((item) => item.tty === process.tty) || null;
      const lastActivityAt = activeSessions.reduce(
        (latest, session) => Math.max(latest, session.mtimeMs || 0),
        matched?.mtimeMs || 0,
      );
      const activityAgeMs = lastActivityAt ? now - lastActivityAt : Infinity;
      let status = "idle";
      if (activityAgeMs < 30_000) status = "working";
      else if (
        activeSessions.some((session) => session.turnState === "working") &&
        activityAgeMs < 180_000
      )
        status = "working";
      else if (
        activeSessions.some((session) => session.lastError) &&
        activityAgeMs < 300_000
      )
        status = "attention";

      return {
        id: `${alias}:${process.pid}`,
        host: alias,
        hostname: host.hostname,
        pid: process.pid,
        tty: process.tty,
        cwd: process.cwd,
        executable: (process.cmdline || "").split(/\s+/)[0] || "codex",
        elapsedSeconds: process.elapsedSeconds,
        status,
        pane,
        rollout: matched,
        subagents,
        mapping: {
          rollout: matched ? "open-fd" : "unmatched",
          tmux: pane ? "tty" : "unmatched",
        },
        lastActivityAt: lastActivityAt || null,
        suggestedSummary: matched
          ? heuristicSummary(matched, process.cwd)
          : {
              theme: `${path.posix.basename(process.cwd || "") || process.pid} 会话`,
              category: "other",
              objective: "尚未关联 rollout",
              progress: "只能观察进程与 TTY",
              result: "",
              nextStep: "",
              source: "rollout",
              updatedAt: null,
            },
        title:
          matched?.lastUser ||
          (matched
            ? `未命名会话 · ${path.posix.basename(process.cwd || "") || process.pid}`
            : `未关联 rollout · ${path.posix.basename(process.cwd || "") || process.pid}`),
      };
    });
    assignWorkloadOwners(host);

    return host;
  }

  return { runSsh, parseHost };
}
