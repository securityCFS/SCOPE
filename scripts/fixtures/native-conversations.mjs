/** Native composer fixture: no remote hosts, credentials, or model calls. */
const isEn = process.env.SCOPE_PREVIEW_LOCALE === "en";
const now = Date.now();
const claudeSubagents = [
  {
    id: "agent-sub-lit-1",
    agentId: "agent-sub-lit-1",
    role: "Literature & Baseline Auditor",
    typeName: "Explore",
    model: "claude-sonnet",
    spawnDepth: 1,
    background: true,
    status: "working",
    lastAction: "Grep: tab:zeroshot-pixels",
    hasWorkflow: true,
    updatedAt: now - 4000,
  },
  {
    id: "agent-sub-eval-2",
    agentId: "agent-sub-eval-2",
    role: "Checkpoint Metrics Collector",
    typeName: "general-purpose",
    model: "claude-opus",
    spawnDepth: 1,
    background: true,
    status: "completed",
    lastAction: "SubagentHandback",
    hasWorkflow: true,
    updatedAt: now - 1500,
  },
];

const claudeSubagentWorkflows = {
  "agent-sub-lit-1": {
    found: true,
    provider: "claude",
    subagentId: "agent-sub-lit-1",
    role: "Literature & Baseline Auditor",
    typeName: "Explore",
    model: "claude-sonnet",
    spawnDepth: 1,
    status: "working",
    version: "preview-wf-1",
    truncated: false,
    totalSteps: 4,
    steps: [
      {
        id: "wf1-prompt",
        kind: "prompt",
        text: isEn
          ? "Cross-check all four visual manipulation baselines in `paper/sections/experiments.tex` against `eval_metrics.py` and verify every citation label."
          : "核对 `paper/sections/experiments.tex` 中四组视觉操作基线与 `eval_metrics.py` 的统计口径，并检查所有引用标签。",
        timestamp: new Date(now - 24000).toISOString(),
      },
      {
        id: "wf1-think",
        kind: "thinking",
        durationMs: 1850,
        text: isEn
          ? "First locate `tab:zeroshot-pixels` in the LaTeX source, then compare the reported success rates and VRAM numbers with the evaluation script output."
          : "先在 LaTeX 源码中定位 `tab:zeroshot-pixels`，再逐项比对评测脚本导出的成功率与显存峰值。",
        timestamp: new Date(now - 21000).toISOString(),
      },
      {
        id: "wf1-tool-1",
        kind: "tool",
        toolName: "Grep",
        summary: "tab:zeroshot-pixels",
        inputPreview: JSON.stringify({ pattern: "tab:zeroshot-pixels", path: "paper/sections" }, null, 2),
        output: "paper/sections/experiments.tex:48: \\label{tab:zeroshot-pixels}\npaper/sections/experiments.tex:61: Baseline & 66.2 & 41.8 \\\\\npaper/sections/experiments.tex:63: \\method{} & \\textbf{92.8} & \\textbf{27.6} \\\\",
        status: "completed",
        timestamp: new Date(now - 15000).toISOString(),
      },
      {
        id: "wf1-tool-2",
        kind: "tool",
        toolName: "Read",
        summary: "/workspace/research/eval_metrics.py",
        inputPreview: JSON.stringify({ file_path: "/workspace/research/eval_metrics.py", offset: 18, limit: 30 }, null, 2),
        output: "18: def aggregate_seeds(runs):\n19:     # Mean over all 5 evaluation seeds (0..4)\n20:     return mean(r.success_rate for r in runs)",
        status: "running",
        timestamp: new Date(now - 4000).toISOString(),
      },
    ],
  },
  "agent-sub-eval-2": {
    found: true,
    provider: "claude",
    subagentId: "agent-sub-eval-2",
    role: "Checkpoint Metrics Collector",
    typeName: "general-purpose",
    model: "claude-opus",
    spawnDepth: 1,
    status: "completed",
    version: "preview-wf-2",
    truncated: false,
    totalSteps: 4,
    steps: [
      {
        id: "wf2-prompt",
        kind: "prompt",
        text: isEn
          ? "Run `eval_metrics.py --summary` across the 4× A100 checkpoints and hand back a verified comparison table."
          : "在 4× A100 最新 checkpoint 上运行 `eval_metrics.py --summary` 并回传核对后的对比表格。",
        timestamp: new Date(now - 42000).toISOString(),
      },
      {
        id: "wf2-tool-1",
        kind: "tool",
        toolName: "Bash",
        summary: "python3 eval_metrics.py --summary --seeds 0,1,2,3,4",
        command: "python3 eval_metrics.py --summary --seeds 0,1,2,3,4",
        output: "Loaded 5 seeds from /workspace/research/runs/latest\nBaseline: 66.2% (peak 41.8 GB)\nCosine LR: 79.5% (peak 38.2 GB)\nSCOPE Policy: 92.8% (peak 27.6 GB, -34.0% VRAM)",
        status: "completed",
        timestamp: new Date(now - 26000).toISOString(),
      },
      {
        id: "wf2-handback",
        kind: "tool",
        toolName: "SubagentHandback",
        summary: isEn ? "Verified 5-seed metrics & 34% VRAM reduction" : "已核实 5 个随机种子指标及 34% 显存下降",
        inputPreview: JSON.stringify({
          summary: isEn
            ? "All 5 seeds match [eval_metrics.py](file:///workspace/research/eval_metrics.py#L18-L45):\n\n| Variant | Success (%) | Peak VRAM (GB) |\n| --- | ---: | ---: |\n| Baseline | 66.2 | 41.8 |\n| **SCOPE Policy** | **92.8** | **27.6** |\n\nVerified reduction: $\\Delta_{\\text{VRAM}} = (41.8 - 27.6) / 41.8 = 34.0\\%$."
            : "5 组随机种子结果已与 [eval_metrics.py](file:///workspace/research/eval_metrics.py#L18-L45) 一致：\n\n| 实验方案 | 成功率 (%) | 显存峰值 (GB) |\n| --- | ---: | ---: |\n| Baseline | 66.2 | 41.8 |\n| **SCOPE Policy** | **92.8** | **27.6** |\n\n显存降幅验证：$\\Delta_{\\text{VRAM}} = (41.8 - 27.6) / 41.8 = 34.0\\%$。",
        }),
        status: "completed",
        timestamp: new Date(now - 5000).toISOString(),
      },
    ],
  },
};
const agySubagents = [
  {
    id: "agy-sub-1",
    role: "Ablation Matrix Checker",
    typeName: "research",
    background: true,
    status: "completed",
    lastAction: isEn ? "Done" : "已完成",
    updatedAt: now - 45000,
  },
];

const entries = [
  {
    key: JSON.stringify(["lab-gpu", "claude", "preview-claude"]),
    host: "lab-gpu",
    provider: "claude",
    sessionId: "preview-claude",
    cwd: "/workspace/research",
    title: isEn ? "Claude Paper Revision & Audit" : "Claude 论文修改与审稿核对",
    model: "claude-opus",
    updatedAt: now - 12000,
    managed: true,
    activeSubagents: 2,
  },
  {
    key: JSON.stringify(["lab-gpu", "antigravity", "preview-antigravity"]),
    host: "lab-gpu",
    provider: "antigravity",
    sessionId: "preview-antigravity",
    cwd: "/workspace/research",
    title: isEn ? "AGY Multi-GPU Ablation Tracker" : "AGY 多卡消融实验追踪",
    model: "gemini-2.5-pro-high",
    updatedAt: now - 30000,
    managed: true,
    activeSubagents: 0,
  },
];

const states = new Map(
  entries.map((entry) => [
    entry.key,
    {
      ...entry,
      turns: [],
      interactive: true,
      status: "waiting_permission",
      permissionMode: "default",
      controlResults: [],
      subagents: entry.provider === "claude" ? claudeSubagents : agySubagents,
      permissions: [
        entry.provider === "claude"
          ? {
              id: "preview-question",
              tool: "AskUserQuestion",
              input: {
                questions: isEn
                  ? [
                      {
                        question: "Which experimental figures and tables should we finalize first?",
                        multiSelect: true,
                        options: [
                          { label: "Convergence curves", description: "Merge 4-GPU training logs with std shading" },
                          { label: "Ablation summary", description: "Cross-check baseline scores in Table 2" },
                          { label: "VRAM & throughput", description: "Add A100 throughput and peak memory stats" },
                        ],
                      },
                      {
                        question: "Preferred report format?",
                        options: [{ label: "Concise summary" }, { label: "Detailed Markdown report" }],
                      },
                    ]
                  : [
                      {
                        question: "希望优先完善哪些实验图表与结论？",
                        multiSelect: true,
                        options: [
                          { label: "收敛曲线对比", description: "合并 4 卡训练日志并绘制标准差阴影" },
                          { label: "消融实验汇总", description: "核对 Table 2 中各基线指标" },
                          { label: "显存与吞吐统计", description: "补充 A100 训练吞吐与显存峰值" },
                        ],
                      },
                      {
                        question: "希望以什么形式汇报？",
                        options: [{ label: "简短结论" }, { label: "详细 Markdown 报告" }],
                      },
                    ],
              },
            }
          : {
              id: "preview-form",
              kind: "acp-form",
              tool: isEn ? "Question" : "提问",
              input: {},
              description: isEn
                ? "Select which ablation targets to validate in this sweep."
                : "请选择本轮消融评测需要验证的选项。",
              fields: [
                {
                  name: "targets",
                  title: isEn ? "Which modules should be verified?" : "需要验证哪些模块？",
                  type: "array",
                  required: true,
                  minItems: 1,
                  options: isEn
                    ? [
                        { value: "1", label: "Data augmentation pipeline" },
                        { value: "2", label: "Cosine LR schedule" },
                        { value: "3", label: "Distributed gradient sync" },
                      ]
                    : [
                        { value: "1", label: "数据增强流水线" },
                        { value: "2", label: "学习率余弦退火" },
                        { value: "3", label: "分布式梯度同步" },
                      ],
                },
              ],
            },
      ],
    },
  ]),
);

export function nativeConversationFixture(request, response, url, json) {
  if (url.pathname === "/api/session-catalog") {
    json(response, 200, { entries, scans: [], scanning: false });
    return true;
  }
  if (url.pathname === "/api/cli-conversations") {
    const entry = entries.find((item) => item.key === url.searchParams.get("key"));
    json(response, 200, entry ? states.get(entry.key) : { entries: [...states.values()] });
    return true;
  }
  if (
    url.pathname === "/api/cli-conversations/commands" ||
    url.pathname === "/api/session/commands"
  ) {
    json(response, 200, {
      commands: [
        { name: "compact", description: "压缩当前会话上下文" },
        { name: "review", description: "检查项目中的代码变更" },
        { name: "project:check", description: "运行当前项目的校验技能" },
      ],
    });
    return true;
  }
  if (url.pathname === "/api/cli-conversations/control") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const input = JSON.parse(body);
      const state = states.get(input.key);
      state.controlResults.push({ id: input.id, status: "accepted" });
      state.permissions = [];
      state.status = "completed";
      state.turns = [
        {
          id: "preview-reply",
          prompt: "提交回答",
          status: "completed",
          text: `已收到确认：${JSON.stringify(input.answers || input.content || input.decision)}`,
        },
      ];
      json(response, 202, { status: "queued", controlId: input.id });
    });
    return true;
  }
  if (url.pathname === "/api/cli-conversations/models") {
    const agy = url.searchParams.get("provider") === "antigravity";
    json(response, 200, {
      models: agy
        ? ["low", "medium", "high"].map((level) => ({
            id: `gemini-2.5-pro-${level}`,
            label: `Gemini 2.5 Pro (${level})`,
            currentEffort: level,
            efforts: ["low", "medium", "high"],
            effortModels: {
              low: "gemini-2.5-pro-low",
              medium: "gemini-2.5-pro-medium",
              high: "gemini-2.5-pro-high",
            },
            supportsAutoMode: false,
          }))
        : [
            { id: "default", label: isEn ? "Host default" : "主机默认", efforts: ["low", "high"], supportsAutoMode: true },
            { id: "opus", label: "Opus", efforts: ["low", "high"], supportsAutoMode: true },
          ],
    });
    return true;
  }
  if (url.pathname === "/api/session-catalog/subagent-workflow") {
    const subId = url.searchParams.get("subagentId") || "";
    const workflow =
      claudeSubagentWorkflows[subId] || Object.values(claudeSubagentWorkflows)[0];
    if (!workflow) {
      json(response, 404, { error: "Subagent workflow not found" });
      return true;
    }
    json(response, 200, workflow);
    return true;
  }
  if (url.pathname === "/api/session-catalog/dialogue") {
    const isClaude = (url.searchParams.get("key") || "").includes('"claude"');
    const isAgy = (url.searchParams.get("key") || "").includes('"antigravity"');
    const messages = isAgy
      ? isEn
        ? [
            {
              id: "1",
              role: "user",
              text: "Summarize the 4-GPU ablation matrix with a comparison table, convergence plot, rollout video preview, and clickable script links.",
            },
            {
              id: "2",
              role: "assistant",
              text: [
                "Completed the 4× A100 ablation sweep (see [eval_metrics.py](file:///workspace/research/eval_metrics.py#L42-L68)).",
                "",
                "| Variant | Success (%) | Peak VRAM (GB) | Throughput (steps/s) |",
                "| --- | ---: | ---: | ---: |",
                "| Baseline | 66.2 | 41.8 | 11.4 |",
                "| Cosine LR | 79.5 | 38.2 | 13.1 |",
                "| **Ours (SCOPE Policy)** | **92.8** | **27.6** | **16.9** |",
                "",
                "Advantage objective: $$\\mathcal{L}(\\theta) = \\mathbb{E}_{(s,a)}\\!\\left[\\big(\\widehat{J}_\\theta(s,a) - J^\\beta(s,a)\\big)^2\\right]$$",
                "",
                "![Benchmark Convergence Curve](file:///workspace/research/plots/convergence.png)",
                "",
                "![Policy Rollout Video Preview](file:///workspace/research/videos/rollout_demo.mp4)",
              ].join("\n"),
            },
          ]
        : [
            {
              id: "1",
              role: "user",
              text: "汇总 4 卡消融实验结果，用标准表格对比指标，附上收敛曲线图、策略仿真视频预览和脚本跳转链接。",
            },
            {
              id: "2",
              role: "assistant",
              text: [
                "已完成 4× A100 消融评测汇总（详见 [eval_metrics.py](file:///workspace/research/eval_metrics.py#L42-L68)）：",
                "",
                "| 实验方案 | 成功率 (%) | 显存峰值 (GB) | 吞吐 (steps/s) |",
                "| --- | ---: | ---: | ---: |",
                "| Baseline | 66.2 | 41.8 | 11.4 |",
                "| Cosine LR | 79.5 | 38.2 | 13.1 |",
                "| **Ours (SCOPE Policy)** | **92.8** | **27.6** | **16.9** |",
                "",
                "核心目标函数：$$\\mathcal{L}(\\theta) = \\mathbb{E}_{(s,a)}\\!\\left[\\big(\\widehat{J}_\\theta(s,a) - J^\\beta(s,a)\\big)^2\\right]$$",
                "",
                "![实验收敛曲线预览](file:///workspace/research/plots/convergence.png)",
                "",
                "![策略仿真视频预览](file:///workspace/research/videos/rollout_demo.mp4)",
              ].join("\n"),
            },
          ]
      : isEn
        ? [
            {
              id: "1",
              role: "user",
              text: "Audit the four visual baseline benchmarks, preserve formulas and citations, and spawn background subagents to verify the latest checkpoints.",
            },
            {
              id: "2",
              role: "assistant",
              text: "Updated the results narrative and delegated **2 background subagents** to audit baselines and eval scripts in parallel (see [eval_metrics.py](file:///workspace/research/eval_metrics.py#L18-L45)).\n\n**Proposed wording**:\n\n`Without training an actor, \\method{} achieves the highest success rate across all four visual manipulation benchmarks, while reducing GPU memory footprint by 34% (\\cref{tab:zeroshot-pixels}).`\n\n**Key equation**: `e(\\va)=\\widehat{J}(\\va)-J^\\beta(\\va)`\n\nPlease confirm below which charts you'd like prioritized first.",
            },
          ]
        : [
            {
              id: "1",
              role: "user",
              text: "核对四组视觉基线评测指标，保留公式和原始引用，并并行启动后台子代理检查最新 checkpoint。",
            },
            {
              id: "2",
              role: "assistant",
              text: "已整理实验描述，并委派 **2 个后台子代理** 同步核查基线与评测脚本（详见 [eval_metrics.py](file:///workspace/research/eval_metrics.py#L18-L45)）。\n\n**新增表述**：\n\n`Without training an actor, \\method{} achieves the highest success rate across all four visual manipulation benchmarks, while reducing GPU memory footprint by 34% (\\cref{tab:zeroshot-pixels}).`\n\n**关键公式**：`e(\\va)=\\widehat{J}(\\va)-J^\\beta(\\va)`\n\n等待下方确认你希望优先汇总的图表项。",
            },
          ];
    json(response, 200, {
      version: "preview-v1",
      subagents: isClaude ? claudeSubagents : agySubagents,
      messages,
      summaryOnly: false,
      limited: false,
      nextBefore: null,
    });
    return true;
  }
  return false;
}
