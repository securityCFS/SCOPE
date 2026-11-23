import { createHash, randomUUID } from "node:crypto";
import {
  CAPACITY_CONTINUE_PROMPT,
  DEFAULT_CAPACITY_RETRY_DELAYS_MS,
  countModelCapacityWarnings,
  hasUnansweredModelCapacityWarning,
} from "./capacity-recovery.mjs";

export function createTmuxDelivery({
  findAgent,
  sessionKey,
  shellQuote,
  runSshCommand,
  cleanSshError,
  notifyClients,
}) {
  const tmuxCapacityRecoveries = new Map();

  function cancelTmuxCapacityRecovery(host, sessionId) {
    const key = sessionKey(host, sessionId);
    const recovery = tmuxCapacityRecoveries.get(key);
    if (recovery?.timer) clearTimeout(recovery.timer);
    tmuxCapacityRecoveries.delete(key);
  }

  function publicTmuxCapacityRecovery(agent) {
    if (!agent?.rollout?.id) return null;
    const recovery = tmuxCapacityRecoveries.get(
      sessionKey(agent.host, agent.rollout.id),
    );
    if (!recovery) return null;
    return {
      status: recovery.status,
      attempt: recovery.attempt,
      maxAttempts: DEFAULT_CAPACITY_RETRY_DELAYS_MS.length,
      nextRetryAt: recovery.nextRetryAt,
      lastError: recovery.lastError,
      lastContinueAt: recovery.lastContinueAt,
    };
  }

  async function sendTmuxText(
    agent,
    text,
    requestedDeliveryId = randomUUID(),
    { preserveCapacityRecovery = false } = {},
  ) {
    if (!agent?.rollout || !agent.pane) {
      throw new Error("该会话未精确匹配 tmux，不能安全注入输入");
    }
    if (!preserveCapacityRecovery) {
      cancelTmuxCapacityRecovery(agent.host, agent.rollout.id);
    }
    const deliveryId = /^[a-zA-Z0-9-]{8,80}$/.test(requestedDeliveryId)
      ? requestedDeliveryId
      : randomUUID();
    const encoded = Buffer.from(String(text), "utf8").toString("base64");
    const target = `${agent.pane.session}:${agent.pane.pane}`;
    const buffer = `scope-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const deliveryOption = `@scope_delivery_${createHash("sha256")
      .update(target)
      .digest("hex")
      .slice(0, 24)}`;
    const pastedState = `pasted:${deliveryId}`;
    const submittedState = `submitted:${deliveryId}`;
    const acknowledge = (status) =>
      `tmux display-message -p -t ${shellQuote(target)} ${shellQuote(
        `SCOPE_ACK|#{pane_current_command}|#{pane_dead}|#{pane_pid}|${status}`,
      )}`;
    const command = [
      `scope_state=$(tmux show-options -gqv ${shellQuote(deliveryOption)} 2>/dev/null || true);`,
      `if [ "$scope_state" = ${shellQuote(submittedState)} ]; then ${acknowledge(
        "deduplicated",
      )}; exit 0; fi;`,
      `if [ "$scope_state" = ${shellQuote(pastedState)} ]; then`,
      `tmux send-keys -t ${shellQuote(target)} C-m`,
      `&& tmux set-option -gq ${shellQuote(deliveryOption)} ${shellQuote(
        submittedState,
      )}`,
      `&& sleep 0.2 && ${acknowledge("recovered")}; exit $?; fi;`,
      `printf %s ${shellQuote(encoded)} | base64 -d`,
      `| tmux load-buffer -b ${shellQuote(buffer)} -`,
      `&& tmux paste-buffer -b ${shellQuote(buffer)} -t ${shellQuote(target)} -d`,
      `&& tmux set-option -gq ${shellQuote(deliveryOption)} ${shellQuote(
        pastedState,
      )}`,
      // Codex enables bracketed paste. Sending Enter in the same instant as the
      // paste can be swallowed, leaving the text visibly parked in the editor.
      `&& sleep 0.35`,
      `&& tmux send-keys -t ${shellQuote(target)} C-m`,
      `&& tmux set-option -gq ${shellQuote(deliveryOption)} ${shellQuote(
        submittedState,
      )}`,
      `&& sleep 0.2`,
      `&& ${acknowledge("submitted")}`,
    ].join(" ");

    let result = await runSshCommand(agent.host, command, "", 15_000);
    let ackLine = result.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("SCOPE_ACK|"));
    if (!ackLine) {
      // Re-running the same delivery id is safe: the remote tmux option either
      // confirms submission or completes a paste whose Enter was interrupted.
      result = await runSshCommand(agent.host, command, "", 15_000);
      ackLine = result.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("SCOPE_ACK|"));
    }
    if (!ackLine) {
      throw new Error(
        `${cleanSshError(result.stderr || result.stdout)}；可直接重试，不会重复发送`,
      );
    }
    const [
      ,
      paneCommand = "",
      paneDead = "0",
      panePid = "0",
      deliveryStatus = "submitted",
    ] = ackLine.split("|");
    if (paneDead === "1") {
      throw new Error("目标 tmux pane 已退出，instruction 未发送");
    }
    return {
      target,
      acknowledged: true,
      deliveryId,
      deliveryStatus,
      deduplicated: deliveryStatus === "deduplicated",
      paneCommand,
      panePid: Number(panePid) || 0,
    };
  }

  function tmuxAccountAllowsAutoContinue() { return false; }

  async function runTmuxCapacityContinuation(key, recovery) {
    if (!tmuxAccountAllowsAutoContinue()) {
      cancelTmuxCapacityRecovery(recovery.host, recovery.sessionId);
      return;
    }
    if (tmuxCapacityRecoveries.get(key) !== recovery) return;
    recovery.timer = null;
    recovery.nextRetryAt = null;
    const agent = findAgent(recovery.host, recovery.sessionId);
    if (
      !agent?.pane ||
      agent.appServerManaged ||
      agent.pane.session !== recovery.paneSession ||
      agent.pane.pane !== recovery.pane
    ) {
      recovery.status = "failed";
      recovery.lastError = "目标 tmux pane 已变化，未自动注入“继续”";
      notifyClients();
      return;
    }

    recovery.status = "sending";
    notifyClients();
    try {
      const digest = createHash("sha256")
        .update(`${key}:${recovery.attempt}`)
        .digest("hex")
        .slice(0, 20);
      await sendTmuxText(
        agent,
        CAPACITY_CONTINUE_PROMPT,
        `capacity-${digest}-${recovery.attempt}`,
        { preserveCapacityRecovery: true },
      );
      if (tmuxCapacityRecoveries.get(key) !== recovery) return;
      recovery.status = "sent";
      recovery.lastContinueAt = new Date().toISOString();
      recovery.lastError = "Selected model is at capacity";
      notifyClients();
    } catch (error) {
      if (tmuxCapacityRecoveries.get(key) !== recovery) return;
      recovery.status = "failed";
      recovery.lastError = error instanceof Error ? error.message : String(error);
      notifyClients();
      scheduleTmuxCapacityContinuation(agent, recovery.warningCount, {
        deliveryRetry: true,
      });
    }
  }

  function scheduleTmuxCapacityContinuation(
    agent,
    warningCount,
    { deliveryRetry = false } = {},
  ) {
    if (!agent?.pane || !agent.rollout?.id || agent.appServerManaged) return;
    // A tmux pane does not expose a verified writer account. Fail closed.
    if (!tmuxAccountAllowsAutoContinue()) return;
    const key = sessionKey(agent.host, agent.rollout.id);
    const current = tmuxCapacityRecoveries.get(key);
    if (!deliveryRetry && current && warningCount <= current.warningCount) return;
    if (current?.timer) clearTimeout(current.timer);
    const attempt = current?.attempt || 0;
    if (attempt >= DEFAULT_CAPACITY_RETRY_DELAYS_MS.length) {
      tmuxCapacityRecoveries.set(key, {
        ...current,
        host: agent.host,
        sessionId: agent.rollout.id,
        status: "exhausted",
        nextRetryAt: null,
        warningCount: Math.max(current?.warningCount || 0, warningCount),
        lastError:
          current?.lastError || "Selected model is at capacity",
        timer: null,
      });
      notifyClients();
      return;
    }

    const delay = DEFAULT_CAPACITY_RETRY_DELAYS_MS[attempt];
    const recovery = {
      host: agent.host,
      sessionId: agent.rollout.id,
      paneSession: agent.pane.session,
      pane: agent.pane.pane,
      warningCount: Math.max(current?.warningCount || 0, warningCount),
      assistantBefore: agent.rollout.lastAssistant || "",
      attempt: attempt + 1,
      status: "scheduled",
      nextRetryAt: new Date(Date.now() + delay).toISOString(),
      lastError: current?.lastError || "Selected model is at capacity",
      lastContinueAt: current?.lastContinueAt || null,
      timer: null,
    };
    recovery.timer = setTimeout(
      () => runTmuxCapacityContinuation(key, recovery),
      delay,
    );
    recovery.timer.unref?.();
    tmuxCapacityRecoveries.set(key, recovery);
    notifyClients();
  }

  function detectTmuxCapacityFailures(hosts) {
    const liveKeys = new Set();
    for (const host of hosts) {
      for (const agent of host.agents || []) {
        if (!agent?.pane || !agent.rollout?.id || agent.appServerManaged) continue;
        const key = sessionKey(agent.host, agent.rollout.id);
        liveKeys.add(key);
        const warningCount = countModelCapacityWarnings(agent.pane.preview);
        const current = tmuxCapacityRecoveries.get(key);
        if (!warningCount) {
          if (current) cancelTmuxCapacityRecovery(agent.host, agent.rollout.id);
          continue;
        }
        const unanswered = hasUnansweredModelCapacityWarning(agent.pane.preview);
        if (
          current?.status === "sent" &&
          agent.rollout.lastAssistant &&
          agent.rollout.lastAssistant !== current.assistantBefore
        ) {
          current.status = "recovered";
          current.lastError = null;
        }
        if (unanswered && (!current || warningCount > current.warningCount)) {
          scheduleTmuxCapacityContinuation(agent, warningCount);
        }
      }
    }
    for (const [key, recovery] of tmuxCapacityRecoveries) {
      if (liveKeys.has(key)) continue;
      if (recovery.timer) clearTimeout(recovery.timer);
      tmuxCapacityRecoveries.delete(key);
    }
  }

  async function sendTmuxSelectionKeys(agent, keys) {
    if (!agent?.pane) throw new Error("目标 Session 没有可控 tmux pane");
    const target = `${agent.pane.session}:${agent.pane.pane}`;
    const allowed = new Set(["Home", "Down", "Enter"]);
    if (!keys.length || keys.some((key) => !allowed.has(key))) {
      throw new Error("内部模型选择按键无效");
    }
    const command = [
      `tmux display-message -p -t ${shellQuote(target)} '#{pane_dead}|#{pane_current_command}'`,
      ...keys.map((key) => `tmux send-keys -t ${shellQuote(target)} ${key}`),
    ].join(" && ");
    const result = await runSshCommand(agent.host, command, "", 15_000, 100_000);
    if (result.code !== 0 || result.stdout.split("|")[0].trim() === "1") {
      throw new Error(cleanSshError(result.stderr || result.stdout));
    }
  }

  function selectionKeys(index) {
    return ["Home", ...Array.from({ length: Math.max(0, index) }, () => "Down"), "Enter"];
  }

  async function selectTmuxModel(
    agent,
    selectedModel,
    models,
    requestedEffort = "",
  ) {
    const prefix = randomUUID();
    const modelName = selectedModel.model || selectedModel.id;
    const efforts = selectedModel.supportedReasoningEfforts || [];
    let effort = efforts.includes(requestedEffort)
      ? requestedEffort
      : efforts.includes(agent.rollout?.reasoningEffort)
        ? agent.rollout.reasoningEffort
        : selectedModel.defaultReasoningEffort;
    if (!efforts.includes(effort)) effort = efforts[0] || "";
    if (
      [selectedModel.id, modelName].includes(agent.rollout?.model) &&
      (!efforts.length || effort === agent.rollout?.reasoningEffort)
    ) {
      const verified = await sendTmuxText(agent, "/status", `${prefix}-status`);
      return {
        target: verified.target,
        model: selectedModel.id,
        effort: agent.rollout?.reasoningEffort || selectedModel.defaultReasoningEffort,
        deliveryIds: [verified.deliveryId],
        verification: "status-requested",
        unchanged: true,
      };
    }
    const opened = await sendTmuxText(agent, "/model", `${prefix}-open`);
    await new Promise((resolve) => setTimeout(resolve, 550));

    const visible = models.filter((model) => model?.id);
    const auto = visible
      .filter((model) => (model.model || model.id).startsWith("codex-auto-"))
      .sort((left, right) => {
        const order = { "codex-auto-fast": 0, "codex-auto-balanced": 1, "codex-auto-thorough": 2 };
        return (order[left.model || left.id] ?? 3) - (order[right.model || right.id] ?? 3);
      });
    const other = visible.filter(
      (model) => !(model.model || model.id).startsWith("codex-auto-"),
    );
    const isAuto = modelName.startsWith("codex-auto-");
    if (auto.length && !isAuto) {
      await sendTmuxSelectionKeys(agent, selectionKeys(auto.length));
      await new Promise((resolve) => setTimeout(resolve, 450));
      const index = other.findIndex((model) => model.id === selectedModel.id);
      if (index < 0) throw new Error("模型不在 TUI 的 All models 列表中");
      await sendTmuxSelectionKeys(agent, selectionKeys(index));
    } else {
      const choices = auto.length ? auto : other;
      const index = choices.findIndex((model) => model.id === selectedModel.id);
      if (index < 0) throw new Error("模型不在 TUI picker 中");
      await sendTmuxSelectionKeys(agent, selectionKeys(index));
    }

    const hasAdvanced = efforts.some((effort) => ["max", "ultra"].includes(effort));
    const reasoningPopupExpected = isAuto ? hasAdvanced : efforts.length > 1;
    if (reasoningPopupExpected) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      const regular = efforts.filter((candidate) => !["max", "ultra"].includes(candidate));
      if (["max", "ultra"].includes(effort)) {
        await sendTmuxSelectionKeys(agent, selectionKeys(regular.length));
        await new Promise((resolve) => setTimeout(resolve, 350));
        const advanced = efforts.filter((candidate) => ["max", "ultra"].includes(candidate));
        await sendTmuxSelectionKeys(agent, selectionKeys(advanced.indexOf(effort)));
      } else {
        const effortIndex = regular.indexOf(effort);
        await sendTmuxSelectionKeys(agent, selectionKeys(Math.max(0, effortIndex)));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 650));
    const verified = await sendTmuxText(agent, "/status", `${prefix}-status`);
    return {
      target: opened.target,
      model: selectedModel.id,
      effort,
      deliveryIds: [opened.deliveryId, verified.deliveryId],
      verification: "status-requested",
    };
  }

  return {
    sendTmuxText,
    publicTmuxCapacityRecovery,
    cancelTmuxCapacityRecovery,
    scheduleTmuxCapacityContinuation,
    runTmuxCapacityContinuation,
    tmuxAccountAllowsAutoContinue,
    detectTmuxCapacityFailures,
    sendTmuxSelectionKeys,
    selectionKeys,
    selectTmuxModel,
  };
}
