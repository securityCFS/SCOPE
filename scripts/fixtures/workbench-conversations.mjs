/** Representative chat data, deliberately isolated from real hosts and agents. */
export function createConversationFixture(snapshot, notify) {
  const isEn = process.env.SCOPE_PREVIEW_LOCALE === "en";
  const chats = new Map();
  const timers = new Map();
  function add(id, host, cwd, title, messages) {
    const events = messages.map(([kind, text], index) => ({
      id: `${id}-${index}`,
      kind,
      text,
      title: kind === "tool" ? (isEn ? "Inspect project layout" : "检查项目结构") : "",
      category: kind === "tool" ? "operations" : "dialogue",
      timestamp: new Date(
        Date.now() - (messages.length - index) * 60000,
      ).toISOString(),
    }));
    const rollout = {
      id,
      cwd,
      path: `/preview/${id}.jsonl`,
      model: "gpt-5-codex",
      reasoningEffort: "high",
      firstUser: title,
      lastUser: events.findLast((e) => e.kind === "user")?.text || "",
      lastAssistant: events.findLast((e) => e.kind === "assistant")?.text || "",
      userMessages: [],
      assistantMessages: [],
      turnState: "idle",
      lastEventAt: events.at(-1).timestamp,
      mtimeMs: Date.now(),
      account: null,
      tokenUsage: null,
    };
    const agent = {
      id: `app-server:${host}:${id}`,
      host,
      hostname: host,
      cwd,
      title,
      status: "idle",
      pid: 0,
      tty: "",
      executable: "codex",
      elapsedSeconds: 300,
      pane: null,
      rollout,
      subagents: [],
      mapping: { rollout: "exact", tmux: "none" },
      appServerManaged: true,
      suggestedSummary: {
        theme: title,
        category: "engineering",
        objective: "",
        progress: "",
        result: "",
        nextStep: "",
        source: "rollout",
        updatedAt: null,
      },
      lastActivityAt: Date.now(),
    };
    const session = {
      host,
      sessionId: id,
      cwd,
      path: rollout.path,
      status: "idle",
      model: rollout.model,
      effort: "high",
      connectionKey: "active",
      yolo: false,
    };
    snapshot.hosts.find((h) => h.alias === host).agents.push(agent);
    snapshot.appServer.sessions.push(session);
    chats.set(`${host}:${id}`, { events, agent, session });
  }
  if (isEn) {
    add("vision-plan", "lab-gpu", "/workspace/vision", "Vision model experiment roadmap", [
      ["user", "Help me organize the experiment roadmap for this project, starting with dataset splits and evaluation metrics."],
      [
        "intermediate",
        "Inspecting repository layout and existing configs before breaking down executable milestones.",
      ],
      [
        "tool",
        "Read README, dataset manifest, and evaluation entrypoints.\n\nSynthetic tool log from isolated preview mode.",
      ],
      ["tool", "Verified alignment between training and evaluation configs."],
      [
        "assistant",
        "Let's lock down three foundations first:\n\n1. **Freeze dataset splits**: share one manifest across train, val, and test.\n2. **Establish a compact baseline**: run a small model end-to-end to confirm reproducibility.\n3. **Unify evaluation metrics**: log accuracy, latency, and peak VRAM for apples-to-apples comparisons.\n\nI recommend finalizing the dataset config before reserving multi-GPU nodes.",
      ],
      ["user", "Sounds good—start with the dataset config and keep every milestone logged in this session."],
      [
        "assistant",
        "Got it. This session will serve as the persistent experiment log.\n\nI'll verify the dataset paths and split manifests first, and surface any confirmation prompts inline. Expand \"Used tools\" anytime to inspect commands and raw outputs.\n\n*Isolated UI preview — no remote agents or credentials connected.*",
      ],
    ]);
    add("vision-eval", "lab-gpu", "/workspace/vision", "Benchmark scripts & metric logs", [
      ["user", "Aggregate evaluation metrics across runs so they are easy to compare."],
      [
        "assistant",
        "We can index runs by model, dataset revision, metric score, and wall-clock time. This session tracks all evaluation runs.\n\nSynthetic conversation from isolated preview mode.",
      ],
    ]);
    add("scope-ui", "build-node", "/workspace/scope", "Project-native conversation workspace", [
      ["user", "Organize sessions by project on the left so I can resume any run in one click."],
      [
        "assistant",
        "Each session preserves its full message feed with a sticky composer below. Filters, GPU telemetry, and diagnostics stay tucked away until needed.\n\nSynthetic conversation from isolated preview mode.",
      ],
    ]);
    add("math-preview", "lab-gpu", "/workspace/research", "LaTeX & equation rendering check", [
      ["user", "Verify math preview while preserving custom paper macros."],
      ["assistant", [
        "Inline math: `\\pi`, `H=8`, `e(a)=\\widehat{J}(a)-J^\\beta(a)`.",
        "",
        "```latex",
        "% Eq. (5)",
        "\\widehat{J}(a)-J^\\pi(a)=e(a)+(1-\\gamma)\\gamma^H E_{s,a}\\Delta V(s_H).",
        "```",
        "",
        "Undefined paper macros stay intact:",
        "```tex",
        "\\hJ(\\va)-J^\\pi(\\va)=e(\\va).",
        "```",
        "",
        "Code identifiers remain code: `session_id`.",
      ].join("\n")],
    ]);
  } else {
    add("vision-plan", "lab-gpu", "/workspace/vision", "整理视觉模型的实验计划", [
      ["user", "帮我整理一下这个项目的实验计划，先把数据和评估方法确定下来。"],
      [
        "intermediate",
        "我先看一下项目结构和已有配置，再把下一步拆成可以直接执行的任务。",
      ],
      [
        "tool",
        "读取 README、数据配置和评估入口。\n\n这是隔离预览中的示例执行记录。",
      ],
      ["tool", "检查训练与评估配置的对应关系。"],
      [
        "assistant",
        "可以先完成三件事：\n\n1. **固定数据划分**：让训练、验证和测试使用同一份清单。\n2. **建立基线**：先跑一个较小模型，确认整个流程能够复现。\n3. **统一评估入口**：记录准确率、耗时和显存，方便比较后续实验。\n\n建议先处理数据配置，完成后再申请训练资源。",
      ],
      ["user", "好，先从数据配置开始。每一步的结果都留在这个会话里。"],
      [
        "assistant",
        "好，这个会话就作为实验工作的持续记录。\n\n我会先核对数据目录和划分清单，把需要你确认的内容直接放在对话中。具体命令和输出可以展开“执行过程”查看。\n\n*当前是界面演示，尚未连接真实的远端 Agent。*",
      ],
    ]);
    add("vision-eval", "lab-gpu", "/workspace/vision", "评估脚本与结果记录", [
      ["user", "把各轮评估结果放在一起，便于比较。"],
      [
        "assistant",
        "可以按模型、数据版本、指标和运行时间来记录。这个会话专门处理评估。\n\n这是隔离预览中的示例对话。",
      ],
    ]);
    add("scope-ui", "build-node", "/workspace/scope", "让项目会话真正成为聊天", [
      ["user", "左侧按项目组织，点开会话后就能直接继续聊。"],
      [
        "assistant",
        "会话会保留完整消息流，输入框固定在底部。筛选、资源和运行详情放在需要时才打开的工具中。\n\n这是隔离预览中的示例对话。",
      ],
    ]);
    add("math-preview", "lab-gpu", "/workspace/research", "公式显示验证", [
      ["user", "查看公式预览，保留论文未定义的宏名称。"],
      ["assistant", [
        "行内公式：`\\pi`，`H=8`，`e(a)=\\widehat{J}(a)-J^\\beta(a)`。",
        "",
        "```latex",
        "% Eq. (5)",
        "\\widehat{J}(a)-J^\\pi(a)=e(a)+(1-\\gamma)\\gamma^H E_{s,a}\\Delta V(s_H).",
        "```",
        "",
        "未定义的论文宏保持原名：",
        "```tex",
        "\\hJ(\\va)-J^\\pi(\\va)=e(\\va).",
        "```",
        "",
        "程序代码仍然是源码：`session_id`。",
      ].join("\n")],
    ]);
  }
  snapshot.appServer.connections = snapshot.hosts.map((h) => ({
    host: h.alias,
    status: "connected",
    connectionKey: "active",
    sessionIds: h.agents.map((a) => a.rollout.id),
  }));
  const evaluation = chats.get("lab-gpu:vision-eval");
  evaluation.events.unshift(
    ...Array.from({ length: 36 }, (_, index) => ({
      id: `earlier-${index}`,
      kind: index % 2 ? "assistant" : "user",
      text:
        index % 2
          ? `第 ${Math.ceil(index / 2)} 轮的示例评估记录已整理。这里保留数据版本、指标和复现步骤，便于之后核对。`
          : `整理第 ${index / 2 + 1} 轮评估结果。`,
      title: "",
      category: "dialogue",
      timestamp: new Date(Date.now() - (40 - index) * 60000).toISOString(),
    })),
  );
  snapshot.summary.codex = chats.size;
  const event = (chat, kind, text) => {
    const timestamp = new Date().toISOString();
    chat.events.push({
      id: crypto.randomUUID(),
      kind,
      text,
      title: "",
      category: "dialogue",
      timestamp,
    });
    chat.agent.rollout.lastEventAt = timestamp;
    if (kind === "assistant") chat.agent.rollout.lastAssistant = text;
    if (kind === "user") chat.agent.rollout.lastUser = text;
  };
  return async (request, response, url, json, readBody) => {
    if (url.pathname === "/api/session/create") {
      const body = await readBody(request);
      const id = crypto.randomUUID();
      add(id, body.host, body.cwd, body.prompt, [
        ["user", body.prompt],
        ["assistant", "预览会话已创建，没有调用远端 Agent。"],
      ]);
      const chat = chats.get(`${body.host}:${id}`);
      Object.assign(chat.session, {
        model: body.model || "gpt-5-codex",
        effort: body.effort || "high",
        yolo: body.yolo,
      });
      snapshot.appServer.connections
        .find((c) => c.host === body.host)
        .sessionIds.push(id);
      notify();
      json(response, 200, { transport: "app-server", session: chat.session });
      return true;
    }
    if (url.pathname === "/api/session/model") {
      const body = await readBody(request);
      const chat = chats.get(`${body.host}:${body.sessionId}`);
      if (!chat) {
        json(response, 404, { error: "找不到预览会话" });
        return true;
      }
      Object.assign(chat.session, {
        model: body.model,
        effort: body.effort,
        yolo: body.yolo,
      });
      Object.assign(chat.agent.rollout, {
        model: body.model,
        reasoningEffort: body.effort,
      });
      notify();
      json(response, 200, {
        transport: "app-server",
        model: body.model,
        yolo: body.yolo,
      });
      return true;
    }
    if (url.pathname === "/api/dialogue") {
      const input =
        request.method === "POST"
          ? await readBody(request)
          : Object.fromEntries(url.searchParams);
      const chat = chats.get(`${input.host}:${input.sessionId}`);
      if (!chat) {
        json(response, 404, { error: "找不到预览会话" });
        return true;
      }
      const end =
        input.before == null ? chat.events.length : Number(input.before);
      const start = Math.max(0, end - (Number(input.limit) || 30));
      const events = chat.events.slice(start, end);
      json(response, 200, {
        host: chat.agent.host,
        sessionId: chat.agent.rollout.id,
        path: chat.agent.rollout.path,
        events,
        loadedAt: new Date().toISOString(),
        totalLines: chat.events.length,
        totalBytes: 0,
        scannedBytes: 0,
        counts: Object.fromEntries(
          ["user", "assistant", "intermediate", "tool", "system"].map(
            (kind) => [kind, events.filter((e) => e.kind === kind).length],
          ),
        ),
        toolEventCount: 2,
        omittedToolEvents: 0,
        hiddenReasoningCount: 0,
        pageSize: 30,
        hasMore: start > 0,
        nextBefore: start > 0 ? start : null,
      });
      return true;
    }
    if (
      !["/api/session/instruct", "/api/session/interrupt"].includes(
        url.pathname,
      )
    )
      return false;
    const body = await readBody(request);
    const key = `${body.host}:${body.sessionId}`;
    const chat = chats.get(key);
    if (!chat) {
      json(response, 404, { error: "找不到预览会话" });
      return true;
    }
    if (url.pathname.endsWith("/interrupt")) {
      clearTimeout(timers.get(key));
      timers.delete(key);
      event(chat, "system", "已停止生成。");
      chat.agent.status = chat.session.status = "idle";
      notify();
      json(response, 200, { interrupted: true, sessionId: body.sessionId });
      return true;
    }
    if (timers.has(key)) {
      json(response, 409, { error: "当前回复尚未结束" });
      return true;
    }
    event(chat, "user", body.prompt);
    chat.agent.status = chat.session.status = "working";
    notify();
    json(response, 200, {
      transport: "app-server",
      acknowledged: true,
      deliveryId: body.deliveryId,
    });
    timers.set(
      key,
      setTimeout(() => {
        event(
          chat,
          "assistant",
          `收到。这条消息已接在当前会话里，切换到其他项目后也能继续回来查看。\n\n这是隔离预览的模拟回复，没有调用远端模型。`,
        );
        chat.agent.status = chat.session.status = "idle";
        timers.delete(key);
        notify();
      }, 6000),
    );
    return true;
  };
}
