import { archiveThread, isArchiving } from "./archive/thread-lifecycle.mjs";
import { LOCAL_HOST, workingDirectory } from "../lib/execution-host.js";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import {
  CAPACITY_CONTINUE_PROMPT,
  DEFAULT_CAPACITY_RETRY_DELAYS_MS,
  errorText,
  isModelCapacityError,
  isTransientCodexBackendError,
} from "./capacity-recovery.mjs";
import { runtimePolicy } from "../lib/runtime-config.js";
import { normalizeAccountQuota } from "../lib/account-quota.js";
import { appServerTurnInput } from "./session-attachments.mjs";

const USER_INPUT_METHOD = "item/tool/requestUserInput";
const HUMAN_REQUEST_METHODS = new Map([
  [USER_INPUT_METHOD, "user-input"],
  ["item/commandExecution/requestApproval", "command-approval"],
  ["item/fileChange/requestApproval", "file-change-approval"],
  ["item/permissions/requestApproval", "permissions-approval"],
  ["mcpServer/elicitation/request", "mcp-elicitation"],
  ["execCommandApproval", "legacy-command-approval"],
  ["applyPatchApproval", "legacy-file-change-approval"],
]);
const MACHINE_REQUEST_METHODS = new Set([
  "item/tool/call",
  "account/chatgptAuthTokens/refresh",
  "attestation/generate",
]);
const CURRENT_TIME_METHOD = "currentTime/read";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_ANSWER_LENGTH = 20_000;

function rpcIdKey(value) {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function cleanString(value, limit = 20_000) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}
function sessionDirectory(host, cwd) {
  return host === LOCAL_HOST && cwd ? workingDirectory(host, cwd) : cwd;
}

function publicConnectionError(value) {
  return cleanString(value instanceof Error ? value.message : String(value), 800);
}

export function isAuthenticationRefreshError(value) {
  const text = errorText(value).toLowerCase();
  if (!text) return false;
  return (
    text.includes("access token could not be refreshed") ||
    text.includes("logged out or signed in to another account") ||
    (text.includes("unauthorized") && text.includes("sign in again"))
  );
}

function normalizedConnectionKey(value) {
  const key = cleanString(value, 100).trim();
  return key || "active";
}

function connectionMapKey(host, connectionKey = "active") {
  return JSON.stringify([host, normalizedConnectionKey(connectionKey)]);
}

function connectionMapParts(value) {
  try {
    const [host, connectionKey] = JSON.parse(value);
    return { host, connectionKey: normalizedConnectionKey(connectionKey) };
  } catch {
    return { host: "", connectionKey: "active" };
  }
}

function requestScopeHost(host, connectionKey = "active") {
  const key = normalizedConnectionKey(connectionKey);
  return key === "active" ? host : `${host}#${key}`;
}

function safeHttpUrl(value) {
  const text = cleanString(value, 8_000);
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function inputRequestKey(host, requestId) {
  return Buffer.from(JSON.stringify([host, requestId]), "utf8").toString(
    "base64url",
  );
}

export const humanRequestKey = inputRequestKey;

function baseHumanRequest(host, message, kind, receivedAt) {
  const params = message.params || {};
  return {
    key: humanRequestKey(host, message.id),
    kind,
    method: message.method,
    host,
    requestId: message.id,
    threadId: cleanString(params.threadId || params.conversationId, 200),
    turnId: cleanString(params.turnId, 200) || null,
    itemId: cleanString(params.itemId || params.callId, 200) || null,
    receivedAt: new Date(receivedAt).toISOString(),
    expiresAt: null,
    status: "pending",
    error: null,
  };
}

function decisionName(decision) {
  if (typeof decision === "string") return decision;
  if (decision && typeof decision === "object") {
    return Object.keys(decision)[0] || "custom";
  }
  return "";
}

function decisionOption(decision) {
  const name = decisionName(decision);
  const labels = {
    accept: ["允许一次", "仅允许这一次操作"],
    acceptForSession: ["本 Session 允许", "当前 Session 后续同类操作不再询问"],
    acceptWithExecpolicyAmendment: [
      "允许并记住命令规则",
      "应用 Codex 建议的 exec policy 规则",
    ],
    applyNetworkPolicyAmendment: [
      "允许并记住网络规则",
      "应用 Codex 建议的网络访问规则",
    ],
    decline: ["拒绝", "不执行该操作，Codex 可继续调整方案"],
    cancel: ["取消 Turn", "取消当前操作或 Turn"],
    approved: ["允许一次", "仅允许这一次操作"],
    approved_for_session: [
      "本 Session 允许",
      "当前 Session 后续同类操作不再询问",
    ],
    denied: ["拒绝", "不执行该操作，Codex 可继续调整方案"],
    abort: ["中止", "中止当前操作"],
  };
  const [label, description] = labels[name] || [
    name || "自定义决策",
    "使用 Codex 提供的原始决策",
  ];
  return {
    id: Buffer.from(JSON.stringify(decision), "utf8").toString("base64url"),
    label,
    description,
    value: decision,
    tone: ["decline", "denied", "cancel", "abort"].includes(name)
      ? "danger"
      : name.includes("Session") || name.includes("session")
        ? "persistent"
        : "accept",
  };
}

function normalizedDecisionOptions(raw, fallback) {
  const decisions = Array.isArray(raw) && raw.length ? raw : fallback;
  return decisions
    .slice(0, 12)
    .filter(
      (decision) =>
        typeof decision === "string" ||
        (decision && typeof decision === "object" && !Array.isArray(decision)),
    )
    .map(decisionOption);
}

function normalizePermissionProfile(profile) {
  const result = {};
  if (profile?.network && typeof profile.network === "object") {
    result.network = {
      enabled:
        typeof profile.network.enabled === "boolean"
          ? profile.network.enabled
          : null,
    };
  }
  if (profile?.fileSystem && typeof profile.fileSystem === "object") {
    const fileSystem = profile.fileSystem;
    result.fileSystem = {
      read: Array.isArray(fileSystem.read)
        ? fileSystem.read.map((value) => cleanString(value, 2_000)).slice(0, 200)
        : null,
      write: Array.isArray(fileSystem.write)
        ? fileSystem.write.map((value) => cleanString(value, 2_000)).slice(0, 200)
        : null,
    };
    if (Number.isFinite(fileSystem.globScanMaxDepth)) {
      result.fileSystem.globScanMaxDepth = Number(fileSystem.globScanMaxDepth);
    }
    if (Array.isArray(fileSystem.entries)) {
      result.fileSystem.entries = fileSystem.entries.slice(0, 200);
    }
  }
  return result;
}

function normalizeElicitationFields(schema) {
  if (!schema || typeof schema !== "object") return null;
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : null;
  if (!properties) return null;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(properties)
    .slice(0, 100)
    .map(([name, raw]) => {
      if (!raw || typeof raw !== "object") return null;
      let options = null;
      if (Array.isArray(raw.enum)) {
        options = raw.enum.map((value, index) => ({
          value,
          label: cleanString(raw.enumNames?.[index], 300) || String(value),
        }));
      } else if (Array.isArray(raw.oneOf)) {
        options = raw.oneOf.map((option) => ({
          value: option?.const,
          label: cleanString(option?.title, 300) || String(option?.const ?? ""),
        }));
      } else if (Array.isArray(raw.items?.enum)) {
        options = raw.items.enum.map((value) => ({
          value,
          label: String(value),
        }));
      } else if (Array.isArray(raw.items?.anyOf)) {
        options = raw.items.anyOf.map((option) => ({
          value: option?.const,
          label: cleanString(option?.title, 300) || String(option?.const ?? ""),
        }));
      }
      return {
        name: cleanString(name, 200),
        title: cleanString(raw.title, 500) || cleanString(name, 200),
        description: cleanString(raw.description, 2_000),
        type: ["string", "number", "integer", "boolean", "array"].includes(
          raw.type,
        )
          ? raw.type
          : "unsupported",
        format: cleanString(raw.format, 100) || null,
        required: required.has(name),
        default: raw.default ?? null,
        minimum: Number.isFinite(raw.minimum) ? Number(raw.minimum) : null,
        maximum: Number.isFinite(raw.maximum) ? Number(raw.maximum) : null,
        minLength: Number.isFinite(raw.minLength) ? Number(raw.minLength) : null,
        maxLength: Number.isFinite(raw.maxLength) ? Number(raw.maxLength) : null,
        minItems: Number.isFinite(raw.minItems) ? Number(raw.minItems) : null,
        maxItems: Number.isFinite(raw.maxItems) ? Number(raw.maxItems) : null,
        options,
      };
    })
    .filter((field) => field?.name);
}

export function parseUserInputRequest(host, message, receivedAt = Date.now()) {
  if (
    !message ||
    message.method !== USER_INPUT_METHOD ||
    !["string", "number"].includes(typeof message.id) ||
    !message.params ||
    typeof message.params !== "object"
  ) {
    return null;
  }

  const rawQuestions = Array.isArray(message.params.questions)
    ? message.params.questions
    : [];
  if (!rawQuestions.length || rawQuestions.length > 3) return null;

  const ids = new Set();
  const questions = [];
  for (const raw of rawQuestions) {
    const id = cleanString(raw?.id, 120).trim();
    const header = cleanString(raw?.header, 120).trim();
    const question = cleanString(raw?.question, 4_000).trim();
    if (!id || !header || !question || ids.has(id)) return null;
    ids.add(id);

    let options = null;
    if (Array.isArray(raw.options)) {
      options = raw.options
        .slice(0, 20)
        .map((option) => ({
          label: cleanString(option?.label, 300).trim(),
          description: cleanString(option?.description, 1_000).trim(),
        }))
        .filter((option) => option.label && option.description);
      if (!options.length) options = null;
    }

    questions.push({
      id,
      header,
      question,
      isOther: Boolean(raw.isOther),
      isSecret: Boolean(raw.isSecret),
      options,
    });
  }

  const autoResolutionMs = Number.isFinite(message.params.autoResolutionMs)
    ? Math.max(0, Number(message.params.autoResolutionMs))
    : null;
  const threadId = cleanString(message.params.threadId, 200);
  const turnId = cleanString(message.params.turnId, 200);
  const itemId = cleanString(message.params.itemId, 200);
  if (!threadId || !turnId || !itemId) return null;

  return {
    ...baseHumanRequest(host, message, "user-input", receivedAt),
    title: "Codex 需要你的回答",
    threadId,
    turnId,
    itemId,
    questions,
    autoResolutionMs,
    expiresAt:
      autoResolutionMs === null
        ? null
        : new Date(receivedAt + autoResolutionMs).toISOString(),
  };
}

export function parseHumanRequest(host, message, receivedAt = Date.now()) {
  if (
    !message ||
    !HUMAN_REQUEST_METHODS.has(message.method) ||
    !["string", "number"].includes(typeof message.id) ||
    !message.params ||
    typeof message.params !== "object"
  ) {
    return null;
  }
  if (message.method === USER_INPUT_METHOD) {
    return parseUserInputRequest(host, message, receivedAt);
  }

  const params = message.params;
  const kind = HUMAN_REQUEST_METHODS.get(message.method);
  const base = baseHumanRequest(host, message, kind, receivedAt);
  if (!base.threadId) return null;

  if (kind === "command-approval") {
    if (!base.turnId || !base.itemId) return null;
    return {
      ...base,
      title: "命令执行审批",
      reason: cleanString(params.reason, 4_000) || null,
      command: cleanString(params.command, 20_000) || null,
      cwd: cleanString(params.cwd, 4_000) || null,
      networkApprovalContext: params.networkApprovalContext || null,
      commandActions: Array.isArray(params.commandActions)
        ? params.commandActions.slice(0, 100)
        : [],
      additionalPermissions: normalizePermissionProfile(
        params.additionalPermissions,
      ),
      decisionOptions: normalizedDecisionOptions(params.availableDecisions, [
        "accept",
        "acceptForSession",
        ...(params.proposedExecpolicyAmendment
          ? [
              {
                acceptWithExecpolicyAmendment: {
                  execpolicy_amendment: params.proposedExecpolicyAmendment,
                },
              },
            ]
          : []),
        ...(Array.isArray(params.proposedNetworkPolicyAmendments)
          ? params.proposedNetworkPolicyAmendments.map((amendment) => ({
              applyNetworkPolicyAmendment: {
                network_policy_amendment: amendment,
              },
            }))
          : []),
        "decline",
        "cancel",
      ]),
    };
  }

  if (kind === "file-change-approval") {
    if (!base.turnId || !base.itemId) return null;
    return {
      ...base,
      title: "文件修改审批",
      reason: cleanString(params.reason, 4_000) || null,
      grantRoot: cleanString(params.grantRoot, 4_000) || null,
      decisionOptions: normalizedDecisionOptions(null, [
        "accept",
        "acceptForSession",
        "decline",
        "cancel",
      ]),
    };
  }

  if (kind === "permissions-approval") {
    if (!base.turnId || !base.itemId) return null;
    return {
      ...base,
      title: "额外权限申请",
      reason: cleanString(params.reason, 4_000) || null,
      cwd: cleanString(params.cwd, 4_000),
      environmentId: cleanString(params.environmentId, 500) || null,
      permissions: normalizePermissionProfile(params.permissions),
      decisionOptions: [
        {
          id: "grant-turn",
          label: "仅本轮授权",
          description: "授予本次请求中的全部权限，Turn 结束后失效",
          value: "grant-turn",
          tone: "accept",
        },
        {
          id: "grant-session",
          label: "本 Session 授权",
          description: "授予本次请求中的全部权限，并在当前 Session 保持",
          value: "grant-session",
          tone: "persistent",
        },
        {
          id: "decline",
          label: "拒绝",
          description: "返回空权限集合；Codex 会把未授予部分视为拒绝",
          value: "decline",
          tone: "danger",
        },
      ],
    };
  }

  if (kind === "mcp-elicitation") {
    const mode = cleanString(params.mode, 100);
    const fields = ["form", "openai/form"].includes(mode)
      ? normalizeElicitationFields(params.requestedSchema)
      : null;
    const url = mode === "url" ? safeHttpUrl(params.url) : null;
    const persist = params?._meta?.persist;
    const meta =
      params?._meta?.codex_approval_kind === "mcp_tool_call"
        ? {
            codexApprovalKind: "mcp_tool_call",
            persist:
              typeof persist === "string"
                ? persist
                : Array.isArray(persist)
                  ? persist.filter((value) => typeof value === "string")
                  : null,
          }
        : null;
    return {
      ...base,
      title:
        params?._meta?.codex_approval_kind === "mcp_tool_call"
          ? "MCP 工具审批"
          : "MCP Server 需要输入",
      mode,
      serverName: cleanString(params.serverName, 500),
      message: cleanString(params.message, 8_000),
      url,
      elicitationId:
        mode === "url" ? cleanString(params.elicitationId, 500) : null,
      fields,
      renderable:
        (mode === "url" && Boolean(url)) ||
        (["form", "openai/form"].includes(mode) && fields !== null),
      meta,
    };
  }

  if (kind === "legacy-command-approval") {
    if (!base.itemId) return null;
    return {
      ...base,
      title: "旧版命令执行审批",
      reason: cleanString(params.reason, 4_000) || null,
      command: Array.isArray(params.command)
        ? params.command.map((value) => cleanString(value, 4_000)).join(" ")
        : cleanString(params.command, 20_000),
      cwd: cleanString(params.cwd, 4_000) || null,
      commandActions: Array.isArray(params.parsedCmd)
        ? params.parsedCmd.slice(0, 100)
        : [],
      decisionOptions: normalizedDecisionOptions(null, [
        "approved",
        "approved_for_session",
        "denied",
        "abort",
      ]),
    };
  }

  if (kind === "legacy-file-change-approval") {
    if (!base.itemId) return null;
    const fileChanges =
      params.fileChanges && typeof params.fileChanges === "object"
        ? Object.entries(params.fileChanges)
            .slice(0, 100)
            .map(([path, change]) => ({
              path: cleanString(path, 4_000),
              type: cleanString(change?.type, 100),
              preview: cleanString(
                change?.unified_diff || change?.content,
                12_000,
              ),
              movePath: cleanString(change?.move_path, 4_000) || null,
            }))
        : [];
    return {
      ...base,
      title: "旧版补丁审批",
      reason: cleanString(params.reason, 4_000) || null,
      grantRoot: cleanString(params.grantRoot, 4_000) || null,
      fileChanges,
      decisionOptions: normalizedDecisionOptions(null, [
        "approved",
        "approved_for_session",
        "denied",
        "abort",
      ]),
    };
  }

  return null;
}

export function normalizeUserInputAnswers(input, rawAnswers) {
  if (!input || input.status !== "pending") {
    throw new Error("该问题已经失效或已回答");
  }
  if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) {
    throw new Error("answers 必须是按问题 ID 索引的对象");
  }

  const expectedIds = new Set(input.questions.map((question) => question.id));
  for (const answerId of Object.keys(rawAnswers)) {
    if (!expectedIds.has(answerId)) {
      throw new Error(`未知的问题 ID：${answerId}`);
    }
  }

  const normalized = {};
  for (const question of input.questions) {
    const raw = rawAnswers[question.id];
    const values = Array.isArray(raw?.answers) ? raw.answers : [];
    if (!values.length || values.length > 20) {
      throw new Error(`问题“${question.header}”需要至少一个答案`);
    }
    const answers = values.map((value) => {
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`问题“${question.header}”的答案不能为空`);
      }
      if (value.length > MAX_ANSWER_LENGTH) {
        throw new Error(`问题“${question.header}”的答案过长`);
      }
      return value.trim();
    });
    normalized[question.id] = { answers };
  }
  return { answers: normalized };
}

function sameDecision(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeDecisionResponse(request, rawResponse) {
  const decision = rawResponse?.decision;
  if (
    !request.decisionOptions?.some((option) =>
      sameDecision(option.value, decision),
    )
  ) {
    throw new Error("该审批决策不在 Codex 提供的可选范围内");
  }
  return { decision };
}

function normalizeElicitationContent(request, rawContent) {
  if (!request.fields) {
    throw new Error("当前客户端无法安全渲染这个 MCP 表单，请选择拒绝或取消");
  }
  if (!rawContent || typeof rawContent !== "object" || Array.isArray(rawContent)) {
    throw new Error("MCP 表单内容必须是对象");
  }
  const content = {};
  const knownFields = new Set(request.fields.map((field) => field.name));
  for (const name of Object.keys(rawContent)) {
    if (!knownFields.has(name)) throw new Error(`未知的 MCP 表单字段：${name}`);
  }
  for (const field of request.fields) {
    let value = rawContent[field.name];
    const missing =
      value === undefined || value === null || (value === "" && field.required);
    if (missing) {
      if (field.required) throw new Error(`请填写“${field.title}”`);
      continue;
    }
    if (field.type === "string") {
      if (typeof value !== "string") throw new Error(`“${field.title}”必须是文本`);
      if (field.minLength !== null && value.length < field.minLength) {
        throw new Error(`“${field.title}”长度不能少于 ${field.minLength}`);
      }
      if (field.maxLength !== null && value.length > field.maxLength) {
        throw new Error(`“${field.title}”长度不能超过 ${field.maxLength}`);
      }
    } else if (field.type === "number" || field.type === "integer") {
      if (typeof value === "string" && value.trim()) value = Number(value);
      if (
        !Number.isFinite(value) ||
        (field.type === "integer" && !Number.isInteger(value))
      ) {
        throw new Error(`“${field.title}”必须是有效数字`);
      }
      if (field.minimum !== null && value < field.minimum) {
        throw new Error(`“${field.title}”不能小于 ${field.minimum}`);
      }
      if (field.maximum !== null && value > field.maximum) {
        throw new Error(`“${field.title}”不能大于 ${field.maximum}`);
      }
    } else if (field.type === "boolean") {
      if (typeof value !== "boolean") {
        throw new Error(`“${field.title}”必须是布尔值`);
      }
    } else if (field.type === "array") {
      if (!Array.isArray(value)) throw new Error(`“${field.title}”必须是多选值`);
      if (field.minItems !== null && value.length < field.minItems) {
        throw new Error(`“${field.title}”至少选择 ${field.minItems} 项`);
      }
      if (field.maxItems !== null && value.length > field.maxItems) {
        throw new Error(`“${field.title}”最多选择 ${field.maxItems} 项`);
      }
    } else {
      throw new Error(`暂不支持 MCP 字段“${field.title}”的类型`);
    }
    if (
      field.options &&
      field.type !== "array" &&
      !field.options.some((option) => sameDecision(option.value, value))
    ) {
      throw new Error(`“${field.title}”不是有效选项`);
    }
    if (
      field.options &&
      field.type === "array" &&
      value.some(
        (entry) =>
          !field.options.some((option) => sameDecision(option.value, entry)),
      )
    ) {
      throw new Error(`“${field.title}”包含无效选项`);
    }
    content[field.name] = value;
  }
  return content;
}

export function normalizeHumanResponse(request, rawResponse) {
  if (!request || request.status !== "pending") {
    throw new Error("该请求已经失效或已回答");
  }
  if (request.kind === "user-input") {
    return normalizeUserInputAnswers(
      request,
      rawResponse?.answers || rawResponse,
    );
  }
  if (
    [
      "command-approval",
      "file-change-approval",
      "legacy-command-approval",
      "legacy-file-change-approval",
    ].includes(request.kind)
  ) {
    return normalizeDecisionResponse(request, rawResponse);
  }
  if (request.kind === "permissions-approval") {
    const choice = rawResponse?.choice;
    if (!["grant-turn", "grant-session", "decline"].includes(choice)) {
      throw new Error("请选择权限申请的处理方式");
    }
    return {
      permissions: choice === "decline" ? {} : request.permissions,
      scope: choice === "grant-session" ? "session" : "turn",
      ...(rawResponse?.strictAutoReview === true
        ? { strictAutoReview: true }
        : {}),
    };
  }
  if (request.kind === "mcp-elicitation") {
    const action = rawResponse?.action;
    if (!["accept", "decline", "cancel"].includes(action)) {
      throw new Error("请选择接受、拒绝或取消");
    }
    if (action === "accept") {
      if (!request.renderable) {
        throw new Error("当前 MCP 请求无法安全渲染，只能拒绝或取消");
      }
      return {
        action,
        content:
          request.mode === "form"
            ? normalizeElicitationContent(request, rawResponse.content)
            : null,
        _meta:
          rawResponse._meta &&
          typeof rawResponse._meta === "object" &&
          !Array.isArray(rawResponse._meta)
            ? rawResponse._meta
            : null,
      };
    }
    return { action, content: null, _meta: null };
  }
  throw new Error(`不支持的人工请求类型：${request.kind}`);
}

export class JsonlAppServerConnection extends EventEmitter {
  constructor({
    host,
    child,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    now = () => Date.now(),
  }) {
    super();
    this.host = host;
    this.child = child;
    this.requestTimeoutMs = requestTimeoutMs;
    this.now = now;
    this.status = "connecting";
    this.error = null;
    this.serverInfo = null;
    this.sequence = 0;
    this.pendingRequests = new Map();
    this.stderr = "";
    this.closed = false;
    this.lineReader = null;
  }

  async start() {
    if (this.closed) throw new Error("app-server transport 已关闭");
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.lineReader = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    this.lineReader.on("line", (line) => this.#handleLine(line));
    this.child.stdin.on("error", (error) => this.#handleClose(error));
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-20_000);
    });
    this.child.once("error", (error) => this.#handleClose(error));
    this.child.once("exit", (code, signal) => {
      const suffix = this.stderr.trim().split(/\r?\n/).at(-1);
      const viaProxy = ["ssh-websocket", "local-websocket"].includes(this.child?.scopeTransport);
      this.#handleClose(
        new Error(
          `${viaProxy ? "app-server 连接已断开" : "app-server 已退出"}（${signal || `code ${code ?? "unknown"}`}）${
            suffix ? `：${suffix}` : ""
          }`,
        ),
      );
    });

    try {
      this.serverInfo = await this.request("initialize", {
        clientInfo: {
          name: "scope-ssh-monitor",
          title: "SCOPE SSH Codex Monitor",
          version: "0.2.0",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      });
      this.notify("initialized");
      this.status = "connected";
      this.error = null;
      this.emit("change");
      return this.serverInfo;
    } catch (error) {
      this.#handleClose(error);
      throw error;
    }
  }

  request(method, params) {
    if (this.closed) {
      return Promise.reject(new Error("app-server transport 已关闭"));
    }
    const id = `scope-client-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(rpcIdKey(id));
        reject(new Error(`app-server 请求超时：${method}`));
      }, this.requestTimeoutMs);
      this.pendingRequests.set(rpcIdKey(id), { resolve, reject, timer, method });
      try {
        this.#write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(rpcIdKey(id));
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.#write(params === undefined ? { method } : { method, params });
  }

  respond(requestId, result) {
    this.#write({ id: requestId, result });
  }

  respondError(requestId, code, message) {
    this.#write({
      id: requestId,
      error: { code, message: cleanString(message, 2_000) },
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.lineReader?.close();
    // Never signal the SSH/app-server child as a side effect of closing the
    // Bridge. Ending stdin lets an idle stdio proxy finish gracefully while a
    // durable remote app-server remains independent from this process.
    if (!this.child.stdin.destroyed) this.child.stdin.end();
    this.#rejectPending(new Error("app-server transport 已关闭"));
  }

  publicState(sessionIds = []) {
    return {
      host: this.host,
      status: this.status,
      error: this.error,
      serverInfo: this.serverInfo,
      sessionIds,
      automaticContinuationAllowed: Array.isArray(this.capacityRetryDelaysMs) ? this.capacityRetryDelaysMs.length > 0 : null,
      capacityRetryLimit: this.capacityRetryDelaysMs?.length ?? null,
    };
  }

  #write(message) {
    if (this.closed || !this.child.stdin.writable) {
      throw new Error("app-server stdin 不可写");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      this.emit("protocol-error", new Error("app-server 返回了非 JSONL 数据"));
      return;
    }

    if (
      Object.hasOwn(message, "id") &&
      !message.method &&
      (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))
    ) {
      const pending = this.pendingRequests.get(rpcIdKey(message.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(rpcIdKey(message.id));
      if (message.error) {
        pending.reject(
          new Error(
            cleanString(message.error.message, 2_000) ||
              `app-server ${pending.method} 请求失败`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (
      HUMAN_REQUEST_METHODS.has(message.method) &&
      Object.hasOwn(message, "id")
    ) {
      const request = parseHumanRequest(this.host, message, this.now());
      if (!request) {
        this.emit(
          "protocol-error",
          new Error(`收到无法验证的人工请求：${message.method}`),
        );
        this.respondError(message.id, -32602, "Invalid human request payload");
        return;
      }
      this.emit("human-request", request);
      if (request.kind === "user-input") this.emit("user-input", request);
      return;
    }

    if (Object.hasOwn(message, "id") && message.method) {
      if (message.method === CURRENT_TIME_METHOD) {
        this.respond(message.id, {
          currentTimeAt: Math.floor(this.now() / 1_000),
        });
        return;
      }
      const knownMachineRequest = MACHINE_REQUEST_METHODS.has(message.method);
      this.respondError(
        message.id,
        -32601,
        knownMachineRequest
          ? `SCOPE does not provide the machine capability required by ${message.method}`
          : `Unsupported app-server request: ${message.method}`,
      );
      this.emit("machine-request", {
        method: message.method,
        known: knownMachineRequest,
      });
      return;
    }

    if (message.method) this.emit("notification", message);
  }

  #rejectPending(error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  #handleClose(error) {
    if (this.closed && this.status === "offline") return;
    this.closed = true;
    this.status = "offline";
    this.error = publicConnectionError(error);
    this.#rejectPending(error instanceof Error ? error : new Error(String(error)));
    this.emit("close", error);
    this.emit("change");
  }
}

export class AppServerManager extends EventEmitter {
  constructor({
    spawnConnection,
    requestTimeoutMs,
    now = () => Date.now(),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
    capacityRetryDelaysMs = DEFAULT_CAPACITY_RETRY_DELAYS_MS,
    resolveCapacityRetryDelays = null,
    validateResume = async () => {},
    transientRetryDelaysMs = [15_000, 45_000, 120_000],
  }) {
    super();
    this.spawnConnection = spawnConnection;
    this.requestTimeoutMs = requestTimeoutMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.capacityRetryDelaysMs = [...capacityRetryDelaysMs];
    this.resolveCapacityRetryDelays = resolveCapacityRetryDelays;
    this.validateResume = validateResume;
    this.transientRetryDelaysMs = [...transientRetryDelaysMs];
    this.connections = new Map();
    this.connecting = new Map();
    this.sessions = new Map();
    this.items = new Map();
    this.requests = new Map();
    this.capacityRecoveries = new Map();
    // Compatibility alias for callers that still inspect the original Plan-only map.
    this.inputs = this.requests;
  }

  async prepareHost(host, executable = "codex", connectionKey = "active") {
    const selectedConnectionKey = normalizedConnectionKey(connectionKey);
    const mapKey = connectionMapKey(host, selectedConnectionKey);
    const current = this.connections.get(mapKey);
    if (current?.status === "connected" && !current.closed) return current;
    const inFlight = this.connecting.get(mapKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const child = this.spawnConnection(
        host,
        executable,
        selectedConnectionKey,
      );
      const connection = new JsonlAppServerConnection({
        host,
        child,
        requestTimeoutMs: this.requestTimeoutMs,
        now: this.now,
      });
      connection.connectionKey = selectedConnectionKey;
      this.connections.set(mapKey, connection);
      connection.on("human-request", (request) => {
        request.connectionKey = selectedConnectionKey;
        request.key = humanRequestKey(
          requestScopeHost(host, selectedConnectionKey),
          request.requestId,
        );
        const item = request.itemId
          ? this.items.get(`${host}:${request.threadId}:${request.itemId}`)
          : null;
        if (
          item?.type === "fileChange" &&
          ["file-change-approval", "legacy-file-change-approval"].includes(
            request.kind,
          )
        ) {
          request.fileChanges = Array.isArray(item.changes)
            ? item.changes.slice(0, 100).map((change) => ({
                path: cleanString(change?.path, 4_000),
                type: cleanString(change?.kind, 100) || "update",
                preview: cleanString(change?.diff, 12_000),
                movePath: null,
              }))
            : request.fileChanges || [];
        }
        this.requests.set(request.key, request);
        this.emit("change");
      });
      connection.on("notification", (message) =>
        this.#handleNotification(host, selectedConnectionKey, message),
      );
      connection.on("protocol-error", (error) => {
        connection.error = publicConnectionError(error);
        this.emit("change");
      });
      connection.on("change", () => this.emit("change"));
      connection.on("close", () => {
        if (this.connections.get(mapKey) !== connection) return;
        for (const session of this.sessions.values()) {
          if (
            session.host === host &&
            normalizedConnectionKey(session.connectionKey) ===
              selectedConnectionKey
          ) {
            this.#cancelCapacityRecovery(host, session.sessionId);
          }
        }
        for (const request of this.requests.values()) {
          if (
            request.host === host &&
            normalizedConnectionKey(request.connectionKey) ===
              selectedConnectionKey &&
            request.status === "pending"
          ) {
            request.status = "disconnected";
            request.error = connection.error;
          }
        }
        for (const session of this.sessions.values()) {
          if (
            session.host === host &&
            normalizedConnectionKey(session.connectionKey) ===
              selectedConnectionKey
          ) {
            session.status = "offline";
          }
        }
        this.emit("change");
      });
      await connection.start();
      if (this.resolveCapacityRetryDelays) {
        connection.capacityRetryDelaysMs = [];
        try {
          const delays = await this.resolveCapacityRetryDelays(host, connection);
          if (Array.isArray(delays) && delays.length <= 100 &&
              delays.every((delay) => Number.isFinite(delay) && delay >= 0)) {
            connection.capacityRetryDelaysMs = [...delays];
          }
        } catch {
          // An unavailable profile probe must not prevent connecting or broaden retries.
        }
      }
      return connection;
    })().finally(() => this.connecting.delete(mapKey));
    this.connecting.set(mapKey, promise);
    return promise;
  }

  async resumeSession({
    host,
    sessionId,
    path,
    cwd,
    model = null,
    effort = null,
    yolo = true,
    executable = "codex",
    resumeOnRecovery = null,
    connectionKey = "active",
    allowProfileHandoff = false,
    readOnly = false,
  }) {
    this.#cancelCapacityRecovery(host, sessionId);
    if (isArchiving(this, host, sessionId)) throw new Error("会话正在归档，请稍后重试");
    const previous = this.sessions.get(`${host}:${sessionId}`);
    if (previous?.idleReleasing) throw new Error("会话正在释放空闲资源，请稍后恢复");
    if (previous?.profileHandoff && !allowProfileHandoff) throw new Error("正在等待旧账号释放 writer；请等待切换完成或取消交接");
    const selectedConnectionKey = normalizedConnectionKey(connectionKey);
    await this.validateResume({ host, sessionId, path, connectionKey: selectedConnectionKey });
    const connection = await this.prepareHost(
      host,
      executable,
      selectedConnectionKey,
    );
    if (this.sessions.get(`${host}:${sessionId}`)?.profileHandoff && !allowProfileHandoff) throw new Error("正在交接账号，暂不恢复旧 writer");
    if (isArchiving(this, host, sessionId)) throw new Error("会话正在归档，请稍后重试");
    const policy = readOnly || previous?.readOnly ? { yolo: false, approvalPolicy: "never", sandbox: "read-only" } : runtimePolicy(yolo);
    if (this.sessions.get(`${host}:${sessionId}`)?.idleReleasing) throw new Error("会话正在释放空闲资源，请稍后恢复");
    const result = await connection.request("thread/resume", {
      threadId: sessionId,
      path: path || null,
      cwd: cwd || null,
      model: model || null,
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
      excludeTurns: true,
    });
    const thread = result?.thread || {};
    const record = {
      host,
      sessionId: thread.id || sessionId,
      path: thread.path || path || null,
      cwd: sessionDirectory(host, result?.cwd || thread.cwd || cwd || ""),
      model: model || result?.model || "",
      effort: cleanString(effort, 40),
      yolo: policy.yolo,
      readOnly: readOnly || Boolean(previous?.readOnly),
      executable,
      connectionKey: selectedConnectionKey,
      status: this.#statusName(thread.status),
      resumeOnRecovery:
        this.#statusName(thread.status) === "working"
          ? true
          : typeof resumeOnRecovery === "boolean"
            ? resumeOnRecovery
            : Boolean(previous?.resumeOnRecovery),
      connectedAt: new Date(this.now()).toISOString(),
      lastEventAt: new Date(this.now()).toISOString(),
    };
    this.sessions.set(`${host}:${record.sessionId}`, record);
    this.emit("change");
    return record;
  }

  async createSession({
    host,
    cwd,
    prompt,
    attachments = [],
    model = null,
    effort = null,
    yolo = true,
    executable = "codex",
    connectionKey = "active",
    readOnly = false,
  }) {
    const selectedConnectionKey = normalizedConnectionKey(connectionKey);
    const connection = await this.prepareHost(host, executable, selectedConnectionKey);
    const policy = readOnly ? { yolo: false, approvalPolicy: "never", sandbox: "read-only" } : runtimePolicy(yolo);
    const result = await connection.request("thread/start", {
      cwd,
      model: model || null,
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
      ephemeral: false,
    });
    const thread = result?.thread || {};
    const sessionId = thread.id;
    if (!sessionId) {
      throw new Error("app-server 未返回新 Session ID");
    }
    const now = new Date(this.now()).toISOString();
    const record = {
      host,
      sessionId,
      path: thread.path || null,
      cwd: sessionDirectory(host, result?.cwd || thread.cwd || cwd),
      model: result?.model || model || "",
      effort: cleanString(effort, 40),
      yolo: policy.yolo,
      readOnly,
      executable,
      connectionKey: selectedConnectionKey,
      status: "idle",
      resumeOnRecovery: false,
      connectedAt: now,
      lastEventAt: now,
    };
    this.sessions.set(`${host}:${sessionId}`, record);
    if (prompt?.trim() || attachments.length) {
      await this.startTurn(host, sessionId, prompt || "", {
        effort,
        ...(attachments.length ? { attachments } : {}),
      });
    }
    this.emit("change");
    return { ...record };
  }

  async createDetachedSession({
    host,
    cwd,
    model = null,
    effort = null,
    yolo = true,
    executable = "codex",
  }) {
    const child = this.spawnConnection(host, executable);
    const connection = new JsonlAppServerConnection({
      host,
      child,
      requestTimeoutMs: this.requestTimeoutMs,
      now: this.now,
    });
    try {
      await connection.start();
      const policy = runtimePolicy(yolo);
      const result = await connection.request("thread/start", {
        cwd,
        model: model || null,
        approvalPolicy: policy.approvalPolicy,
        sandbox: policy.sandbox,
        ephemeral: false,
      });
      const thread = result?.thread || {};
      if (!thread.id) throw new Error("app-server 未返回新 Session ID");
      const now = new Date(this.now()).toISOString();
      const record = {
        host,
        sessionId: thread.id,
        path: thread.path || null,
        cwd: sessionDirectory(host, result?.cwd || thread.cwd || cwd),
        model: result?.model || model || "",
        effort: cleanString(effort, 40),
        yolo: policy.yolo,
        status: "idle",
        resumeOnRecovery: false,
        connectedAt: now,
        lastEventAt: now,
      };
      // A zero-turn thread can have an id before its rollout exists on disk.
      // Persist an empty, non-visible item so the CLI can immediately resume
      // this thread after the isolated app-server transport closes.
      await connection.request("thread/inject_items", {
        threadId: record.sessionId,
        items: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "" }],
          },
        ],
      });
      await connection.request("thread/unsubscribe", {
        threadId: record.sessionId,
      });
      return record;
    } finally {
      connection.close();
    }
  }

  async startTurn(
    host,
    sessionId,
    prompt,
    { effort = null, capacityRecovery = false, automaticRecovery = false, attachments = [] } = {},
  ) {
    if (/^\/[\w:-]+(?:\s|$)/.test(String(prompt).trim())) throw new Error("Codex app-server 不执行 CLI 斜杠命令；请使用命令菜单或 $技能名");
    if (isArchiving(this, host, sessionId)) throw new Error("会话正在归档，请稍后重试");
    const session = this.sessions.get(`${host}:${sessionId}`);
    if (session?.profileSwitching) throw new Error("该 Session 正在切换账号，请稍后发送 instruction");
    const connection = session
      ? this.connections.get(connectionMapKey(host, session.connectionKey))
      : null;
    if (!connection || connection.status !== "connected" || !session) {
      throw new Error("该 Session 尚未连接 app-server");
    }
    if ((capacityRecovery || automaticRecovery) && !await this.canAutoContinue(host, sessionId)) {
      this.#cancelCapacityRecovery(host, sessionId);
      throw new Error("该实际账号未获准自动继续；请手动发送指令");
    }
    if (isArchiving(this, host, sessionId) || session.profileSwitching || this.sessions.get(`${host}:${sessionId}`) !== session) {
      throw new Error("会话状态已变化，未发送指令");
    }
    const input = appServerTurnInput(cleanString(prompt, 20_000), attachments);
    if (!input.length) throw new Error("instruction 和附件不能同时为空");
    if (!capacityRecovery) this.#cancelCapacityRecovery(host, sessionId);
    const policy = session.readOnly ? { approvalPolicy: "never", sandboxPolicy: { type: "readOnly" } } : runtimePolicy(session.yolo);
    session.turnStarting = true;
    let result;
    try { result = await connection.request("turn/start", {
      threadId: sessionId,
      input,
      cwd: session.cwd || null,
      approvalPolicy: policy.approvalPolicy,
      // `thread/start`/`thread/resume` use the SandboxMode string, while
      // `turn/start` uses the v2 SandboxPolicy object.  Always override the
      // sticky policy here: a resumed thread must follow the policy selected
      // in SCOPE instead of silently inheriting an older rollout setting.
      sandboxPolicy: policy.sandboxPolicy,
      model: session.model || null,
      effort: effort || session.effort || null,
    }); } finally { delete session.turnStarting; }
    session.status = "working";
    session.resumeOnRecovery = true;
    session.activeTurnId = cleanString(result?.turn?.id, 200) || null;
    session.lastProtocolError = null;
    session.lastEventAt = new Date(this.now()).toISOString();
    this.emit("change");
    return result;
  }

  clearSessionRestartHold(host, sessionId) {
    if (isArchiving(this, host, sessionId)) return;
    const session = this.sessions.get(`${host}:${sessionId}`);
    if (session) { delete session.profileHandoff; delete session.profileSwitching; }
  }

  async canAutoContinue(host, sessionId) {
    if (isArchiving(this, host, sessionId)) return false;
    if (!this.resolveCapacityRetryDelays) return true;
    const session = this.sessions.get(`${host}:${sessionId}`);
    const connection = session && this.connections.get(connectionMapKey(host, session.connectionKey));
    if (!connection || connection.closed || session.profileHandoff) return false;
    try {
      const delays = await this.resolveCapacityRetryDelays(host, connection);
      connection.capacityRetryDelaysMs = Array.isArray(delays) ? delays : [];
      return connection.capacityRetryDelaysMs.length > 0;
    } catch {
      connection.capacityRetryDelaysMs = [];
      return false;
    }
  }

  async steerTurn(host, sessionId, prompt, { attachments = [] } = {}) {
    if (isArchiving(this, host, sessionId)) throw new Error("会话正在归档，请稍后重试");
    const session = this.sessions.get(`${host}:${sessionId}`);
    if (session?.profileHandoff) throw new Error("正在交接账号，请等待完成或取消交接后发送 instruction");
    const connection = session
      ? this.connections.get(connectionMapKey(host, session.connectionKey))
      : null;
    if (!connection || connection.status !== "connected" || !session) {
      throw new Error("该 Session 尚未连接 app-server");
    }
    const input = appServerTurnInput(cleanString(prompt, 20_000), attachments);
    if (!input.length) throw new Error("instruction 和附件不能同时为空");
    let activeTurnId = cleanString(session.activeTurnId, 200);
    if (!activeTurnId) {
      const current = await connection.request("thread/read", {
        threadId: sessionId,
        includeTurns: true,
      });
      activeTurnId = cleanString(
        [...(Array.isArray(current?.thread?.turns) ? current.thread.turns : [])]
          .reverse()
          .find((turn) => turn?.status === "inProgress")?.id,
        200,
      );
    }
    if (!activeTurnId) {
      throw new Error("当前 Session 没有可接收追加 context 的活动 Turn；请刷新后重试");
    }
    const result = await connection.request("turn/steer", {
      threadId: sessionId,
      expectedTurnId: activeTurnId,
      input,
      additionalContext: null,
    });
    session.activeTurnId = activeTurnId;
    session.lastEventAt = new Date(this.now()).toISOString();
    session.resumeOnRecovery = true;
    this.emit("change");
    return result;
  }

  async listModels(host, executable = "codex", connectionKey = "active") {
    const connection = await this.prepareHost(host, executable, connectionKey);
    const models = [];
    let cursor = null;
    do {
      const result = await connection.request("model/list", {
        cursor,
        limit: 100,
        includeHidden: false,
      });
      for (const model of result?.data || []) {
        if (!model?.id) continue;
        models.push({
          id: cleanString(model.id, 200),
          model: cleanString(model.model, 200),
          displayName: cleanString(model.displayName, 200),
          description: cleanString(model.description, 600),
          isDefault: Boolean(model.isDefault),
          defaultReasoningEffort: cleanString(
            model.defaultReasoningEffort,
            40,
          ),
          supportedReasoningEfforts: (model.supportedReasoningEfforts || [])
            .map((option) => cleanString(option?.reasoningEffort, 40))
            .filter(Boolean),
        });
      }
      cursor = result?.nextCursor || null;
    } while (cursor && models.length < 300);
    return models;
  }

  async getAccount(host, executable = "codex", connectionKey = "active") {
    const connection = await this.prepareHost(host, executable, connectionKey);
    return connection.request("account/read", { refreshToken: false });
  }

  async getRateLimits(host, executable = "codex", connectionKey = "active") {
    const connection = await this.prepareHost(host, executable, connectionKey);
    const result = await connection.request("account/rateLimits/read", {});
    connection.rateLimits = normalizeAccountQuota(result?.rateLimits || result);
    this.emit("change");
    return connection.rateLimits;
  }

  async setSessionModel(host, sessionId, model, effort = null, yolo = null) {
    if (isArchiving(this, host, sessionId)) throw new Error("会话正在归档，请稍后重试");
    const session = this.sessions.get(`${host}:${sessionId}`);
    if (session?.profileHandoff) throw new Error("正在交接账号，请等待完成或取消后修改模型");
    const connection = session
      ? this.connections.get(connectionMapKey(host, session.connectionKey))
      : null;
    if (!session) {
      throw new Error("该 Session 尚未由 app-server 托管");
    }
    if (session.status !== "working" && session.status !== "offline" && (!connection || connection.status !== "connected")) {
      throw new Error("该 Session 尚未连接 app-server");
    }
    const selectedModel = cleanString(model, 200);
    const selectedEffort = cleanString(effort, 40);
    if (!selectedModel) throw new Error("模型不能为空");
    const policy = session.readOnly
      ? { yolo: false, approvalPolicy: "never", sandbox: "read-only" }
      : runtimePolicy(typeof yolo === "boolean" ? yolo : session.yolo);
    // A running turn keeps its existing model. Persist the override now so
    // turn/start (including recovery) uses it without interrupting that turn.
    const deferred = session.status === "working" || session.status === "offline";
    if (!deferred) await connection.request("thread/resume", {
      threadId: sessionId,
      path: session.path || null,
      cwd: session.cwd || null,
      model: selectedModel,
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
      excludeTurns: true,
    });
    // A loaded thread may report its previous model from thread/resume even
    // though the requested override is valid for the next turn. Keep the UI
    // selection authoritative and send it explicitly on every turn/start.
    session.model = selectedModel;
    session.effort = selectedEffort;
    session.yolo = policy.yolo;
    session.lastEventAt = new Date(this.now()).toISOString();
    this.emit("change");
    return { ...session, deferred };
  }

  async setHostModel(host, selectedModel, effort = null) {
    const results = [];
    for (const session of this.sessionRecords().filter((record) => record.host === host)) {
      const supported = selectedModel.supportedReasoningEfforts || [];
      const nextEffort = effort || (supported.includes(session.effort)
        ? session.effort : selectedModel.defaultReasoningEffort || supported[0] || "");
      try {
        const updated = await this.setSessionModel(host, session.sessionId,
          selectedModel.model || selectedModel.id, nextEffort);
        results.push({ sessionId: session.sessionId, transport: "app-server",
          status: updated.deferred ? "next-turn" : "applied", effort: updated.effort });
      } catch (error) {
        results.push({ sessionId: session.sessionId, transport: "app-server",
          status: "failed", error: error.message });
      }
    }
    return results;
  }

  async sessionCommands(host, sessionId) {
    const session = this.sessions.get(`${host}:${sessionId}`);
    const connection = session && this.connections.get(connectionMapKey(host, session.connectionKey));
    if (!session || !connection || connection.status !== "connected") throw new Error("恢复 app-server 会话后可读取项目技能");
    const result = await connection.request("skills/list", { cwds: [session.cwd], forceReload: true });
    return (result.data || []).flatMap(group => (group.skills || []).filter(skill => skill.enabled !== false).map(skill => ({
      name: `skills:${skill.name}`, description: skill.description || skill.interface?.shortDescription || "项目技能",
      kind: "skill", insertion: `$${skill.name} `,
    })));
  }

  async compactSession(host, sessionId) {
    if (this.sessions.get(`${host}:${sessionId}`)?.profileHandoff) throw new Error("正在交接账号，请等待完成或先取消交接");
    if (isArchiving(this, host, sessionId)) throw new Error("会话正在归档，请稍后重试");
    const session = this.sessions.get(`${host}:${sessionId}`);
    const connection = session
      ? this.connections.get(connectionMapKey(host, session.connectionKey))
      : null;
    if (!connection || connection.status !== "connected" || !session) {
      throw new Error("该 Session 尚未连接 app-server");
    }
    const result = await connection.request("thread/compact/start", {
      threadId: sessionId,
    });
    session.status = "working";
    session.lastEventAt = new Date(this.now()).toISOString();
    this.emit("change");
    return result;
  }

  /** Stop only this turn. Keep the chat subscribed and ready for another message. */
  async interruptTurn(host, sessionId) {
    if (isArchiving(this, host, sessionId)) throw new Error("会话正在归档，请稍后重试");
    const session = this.sessions.get(`${host}:${sessionId}`);
    if (!session || session.profileHandoff) throw new Error("会话未连接或正在交接账号");
    const connection = this.connections.get(connectionMapKey(host, session.connectionKey));
    if (!connection || connection.status !== "connected" || connection.closed || session.status === "offline")
      throw new Error("主机离线，无法确认生成已停止");
    this.#cancelCapacityRecovery(host, sessionId);
    let turnId = cleanString(session.activeTurnId, 200);
    if (!turnId && session.status === "working") {
      const current = await connection.request("thread/read", { threadId: sessionId, includeTurns: true });
      turnId = cleanString([...(current.thread?.turns || [])].reverse().find(turn => turn.status === "inProgress")?.id, 200);
      if (!turnId && this.#statusName(current.thread?.status) === "working") throw new Error("尚未定位活动 Turn，请稍后重试");
    }
    if (turnId) await connection.request("turn/interrupt", { threadId: sessionId, turnId });
    session.activeTurnId = null;
    session.status = "idle";
    session.resumeOnRecovery = false;
    session.lastEventAt = new Date(this.now()).toISOString();
    this.emit("change");
    return { interrupted: Boolean(turnId), sessionId };
  }

  async stopSession(host, sessionId) {
    if (isArchiving(this, host, sessionId)) throw new Error("会话正在归档，请稍后重试");
    if (this.sessions.get(`${host}:${sessionId}`)?.profileHandoff) throw new Error("正在交接账号，请先取消交接再关闭会话");
    const key = `${host}:${sessionId}`;
    const session = this.sessions.get(key);
    const connection = session
      ? this.connections.get(connectionMapKey(host, session.connectionKey))
      : null;
    if (!session) {
      throw new Error("该 Session 尚未由 app-server 托管");
    }
    this.#cancelCapacityRecovery(host, sessionId);
    if (
      !connection ||
      connection.status !== "connected" ||
      connection.closed ||
      session.status === "offline"
    ) {
      throw new Error(
        "该主机当前离线，无法确认远端 Turn 已停止；请恢复连接后重试",
      );
    }

    let activeTurnId = cleanString(session.activeTurnId, 200);
    if (session.status === "working" && !activeTurnId) {
      const current = await connection.request("thread/read", {
        threadId: sessionId,
        includeTurns: true,
      });
      activeTurnId = cleanString(
        [...(current?.thread?.turns || [])]
          .reverse()
          .find((turn) => turn?.status === "inProgress")?.id,
        200,
      );
      if (
        !activeTurnId &&
        this.#statusName(current?.thread?.status) === "working"
      ) {
        throw new Error(
          "远端仍报告 Session 活跃，但无法定位可中止的 Turn；为避免误报已关闭，操作已取消",
        );
      }
    }

    let interrupted = false;
    if (activeTurnId) {
      await connection.request("turn/interrupt", {
        threadId: sessionId,
        turnId: activeTurnId,
      });
      interrupted = true;
    }
    await connection.request("thread/unsubscribe", { threadId: sessionId });

    this.sessions.delete(key);
    for (const itemKey of this.items.keys()) {
      if (itemKey.startsWith(`${host}:${sessionId}:`)) {
        this.items.delete(itemKey);
      }
    }
    for (const [requestKey, request] of this.requests.entries()) {
      if (request.host === host && request.threadId === sessionId) {
        this.requests.delete(requestKey);
      }
    }
    // Stopping a logical app-server session only interrupts its active turn and
    // releases this monitor's subscription. The durable rollout stays in
    // ~/.codex/sessions and the shared host daemon remains available to sibling
    // sessions.
    this.emit("session-release", {
      host,
      sessionId,
      reason: "stop",
      record: { ...session, resumeOnRecovery: false },
    });
    this.emit("change");
    return {
      ...session,
      stopped: true,
      interrupted,
    };
  }

  async archiveSession(host, sessionId, executable = "codex", connectionKey = "active") {
    return archiveThread(this, host, sessionId, executable, connectionKey);
  }

  forgetArchivedSession(host, sessionId) {
    const key = `${host}:${sessionId}`;
    const session = this.sessions.get(key);
    this.#cancelCapacityRecovery(host, sessionId);
    this.sessions.delete(key);
    for (const itemKey of this.items.keys()) if (itemKey.startsWith(`${key}:`)) this.items.delete(itemKey);
    for (const [requestKey, request] of this.requests) if (request.host === host && request.threadId === sessionId) this.requests.delete(requestKey);
    this.emit("session-release", { host, sessionId, reason: "archive", record: session });
    this.emit("change");
  }

  async unarchiveSession(host, sessionId, executable = "codex", connectionKey = "active") {
    const connection = await this.prepareHost(host, executable, connectionKey);
    try {
      const result = await connection.request("thread/unarchive", { threadId: sessionId });
      return result?.thread || { id: sessionId };
    } catch (error) {
      // Recover when the earlier unarchive succeeded but its reply was lost.
      const current = await connection.request("thread/read", { threadId: sessionId, includeTurns: false }).catch(() => null);
      if (/[\\/]sessions[\\/]/.test(current?.thread?.path || "")) return current.thread;
      throw error;
    }
  }

  async releaseSession(host, sessionId, executable = "codex") {
    if (isArchiving(this, host, sessionId)) throw new Error("会话正在归档，请稍后重试");
    if (this.sessions.get(`${host}:${sessionId}`)?.profileHandoff) throw new Error("正在交接账号，请先取消交接");
    const key = `${host}:${sessionId}`;
    const session = this.sessions.get(key);
    const connection = session
      ? this.connections.get(connectionMapKey(host, session.connectionKey))
      : null;
    if (!session) {
      throw new Error("该 Session 尚未连接 app-server");
    }
    if (
      !connection ||
      connection.status !== "connected" ||
      connection.closed ||
      session.status === "offline"
    ) {
      // The SSH stdio transport may have disappeared while the last known
      // session record remains useful for recovery. There is nothing remote
      // left to unsubscribe in that case; discard only the stale local
      // subscription so the same rollout can be resumed through tmux.
      this.#cancelCapacityRecovery(host, sessionId);
      this.sessions.delete(key);
      this.emit("session-release", { host, sessionId });
      for (const itemKey of this.items.keys()) {
        if (itemKey.startsWith(`${host}:${sessionId}:`)) {
          this.items.delete(itemKey);
        }
      }
      for (const [requestKey, request] of this.requests.entries()) {
        if (request.host === host && request.threadId === sessionId) {
          this.requests.delete(requestKey);
        }
      }
      this.emit("change");
      return { ...session, status: "offline", releasedOffline: true };
    }
    if (session.status === "working") {
      throw new Error("当前 app-server Turn 仍在运行，请等待回复完成后再切换到 tmux");
    }
    const pendingRequest = Array.from(this.requests.values()).find(
      (request) =>
        request.host === host &&
        request.threadId === sessionId &&
        ["pending", "responding", "disconnected"].includes(request.status),
    );
    if (pendingRequest) {
      throw new Error("该 Session 仍有待回答问题或审批，请处理后再切换到 tmux");
    }

    const siblingSessions = Array.from(this.sessions.values()).filter(
      (candidate) =>
        candidate.host === host &&
        candidate.sessionId !== sessionId &&
        normalizedConnectionKey(candidate.connectionKey) ===
          normalizedConnectionKey(session.connectionKey) &&
        candidate.status !== "offline",
    );
    if (siblingSessions.some((candidate) => candidate.status === "working")) {
      throw new Error(
        "同一主机还有正在运行的 app-server Turn；为避免中断其他 Session，请等待它完成后再切换",
      );
    }
    const siblingRequest = Array.from(this.requests.values()).find(
      (request) =>
        request.host === host &&
        request.threadId !== sessionId &&
        ["pending", "responding", "disconnected"].includes(request.status),
    );
    if (siblingRequest) {
      throw new Error(
        "同一主机还有待回答的 app-server 请求；请先处理后再切换该 Session",
      );
    }

    this.#cancelCapacityRecovery(host, sessionId);
    await connection.request("thread/unsubscribe", { threadId: sessionId });
    this.sessions.delete(key);
    this.emit("session-release", { host, sessionId });
    for (const itemKey of this.items.keys()) {
      if (itemKey.startsWith(`${host}:${sessionId}:`)) {
        this.items.delete(itemKey);
      }
    }
    // Keep the shared host transport connected. Sibling sessions can continue
    // and an idle connection is safer than terminating its process tree.

    try {
      for (const sibling of siblingSessions) {
        await this.resumeSession({
          host,
          sessionId: sibling.sessionId,
          path: sibling.path,
          cwd: sibling.cwd,
          model: sibling.model || null,
          effort: sibling.effort || null,
          yolo: sibling.yolo !== false,
          executable,
          connectionKey: sibling.connectionKey,
        });
      }
      this.emit("change");
      return { ...session };
    } catch (error) {
      try {
        for (const original of [...siblingSessions, session]) {
          await this.resumeSession({
            host,
            sessionId: original.sessionId,
            path: original.path,
            cwd: original.cwd,
            model: original.model || null,
            effort: original.effort || null,
            yolo: original.yolo !== false,
            executable,
            connectionKey: original.connectionKey,
          });
        }
      } catch (rollbackError) {
        throw new Error(
          `${error.message}；恢复该主机 app-server Sessions 也失败：${rollbackError.message}`,
        );
      }
      throw error;
    }
  }

  holdSessionForProfile(host, sessionId) {
    if (isArchiving(this, host, sessionId)) throw new Error("会话正在归档，请稍后重试");
    const session = this.sessions.get(`${host}:${sessionId}`);
    if (!session || session.status === "working" || session.turnStarting || session.profileSwitching ||
      Array.from(this.requests.values()).some((r) => r.host === host && r.threadId === sessionId &&
        ["pending", "responding", "disconnected"].includes(r.status))) {
      throw new Error("该会话仍在执行或处理审批，暂不能交接账号");
    }
    this.#cancelCapacityRecovery(host, sessionId);
    session.profileHandoff = true;
    session.profileSwitching = true;
  }

  hydrateProfileHandoff(source) {
    const key = `${source.host}:${source.sessionId}`;
    if (this.sessions.has(key)) return;
    this.sessions.set(key, { ...source, status: "attention", profileHandoff: true,
      profileSwitching: true, connectedAt: new Date(this.now()).toISOString(), lastEventAt: new Date(this.now()).toISOString() });
    this.emit("change");
  }

  async releaseProfileWriter(host, sessionId, source) {
    const connection = await this.prepareHost(host, source.executable || "codex", source.connectionKey || "active");
    await connection.request("thread/unsubscribe", { threadId: sessionId });
  }

  async finishProfileHandoff(host, sessionId, connectionKey, executable, source) {
    return this.resumeSession({ ...source, host, sessionId, connectionKey, executable: executable || source.executable || "codex",
      allowProfileHandoff: true });
  }

  async migrateSessionConnection(
    host,
    sessionId,
    connectionKey = "active",
    executable = "codex",
  ) {
    const key = `${host}:${sessionId}`;
    const session = this.sessions.get(key);
    if (!session) throw new Error("该 Session 尚未连接 app-server");
    const sourceConnectionKey = normalizedConnectionKey(session.connectionKey);
    const targetConnectionKey = normalizedConnectionKey(connectionKey);
    if (sourceConnectionKey === targetConnectionKey) return { ...session };
    if (session.status === "working" || session.turnStarting) {
      throw new Error("当前 app-server Turn 仍在运行，不能迁移 writer");
    }
    const pendingRequest = Array.from(this.requests.values()).find(
      (request) =>
        request.host === host &&
        request.threadId === sessionId &&
        ["pending", "responding", "disconnected"].includes(request.status),
    );
    if (pendingRequest) {
      throw new Error("该 Session 仍有待回答问题或审批，不能迁移 writer");
    }

    const sourceConnection = this.connections.get(
      connectionMapKey(host, sourceConnectionKey),
    );
    if (
      !sourceConnection ||
      sourceConnection.status !== "connected" ||
      sourceConnection.closed
    ) {
      throw new Error("原 app-server writer 已断开，无法安全释放 Session");
    }
    await this.prepareHost(host, executable, targetConnectionKey);
    if (session.status === "working" || session.turnStarting || session.profileSwitching || Array.from(this.requests.values()).some(
      (request) => request.host === host && request.threadId === sessionId &&
        ["pending", "responding", "disconnected"].includes(request.status),
    )) throw new Error("当前 Session 已开始执行或有待处理请求，请稍后切换账号");
    const original = { ...session };
    session.profileSwitching = true;
    this.#cancelCapacityRecovery(host, sessionId);
    try {
      await sourceConnection.request("thread/unsubscribe", { threadId: sessionId });
    } catch (error) {
      delete session.profileSwitching;
      throw error;
    }
    try {
      return await this.resumeSession({
        host,
        sessionId,
        path: original.path,
        cwd: original.cwd,
        model: original.model || null,
        effort: original.effort || null,
        yolo: original.yolo !== false,
        executable: original.executable || executable,
        resumeOnRecovery: original.resumeOnRecovery === true,
        connectionKey: targetConnectionKey,
      });
    } catch (error) {
      try {
        await this.resumeSession({
          host,
          sessionId,
          path: original.path,
          cwd: original.cwd,
          model: original.model || null,
          effort: original.effort || null,
          yolo: original.yolo !== false,
          executable: original.executable || executable,
          resumeOnRecovery: original.resumeOnRecovery === true,
          connectionKey: sourceConnectionKey,
        });
      } catch (rollbackError) {
        throw new Error(
          `${error.message}；回滚原 app-server writer 也失败：${rollbackError.message}`,
        );
      }
      throw error;
    } finally {
      delete session.profileSwitching;
    }
  }

  async forkSessionConnection(
    host,
    sessionId,
    connectionKey = "active",
    executable = "codex",
  ) {
    const key = `${host}:${sessionId}`;
    const session = this.sessions.get(key);
    if (!session) throw new Error("该 Session 尚未连接 app-server");
    if (session.status === "working") {
      throw new Error("当前 app-server Turn 仍在运行，不能创建恢复分支");
    }
    const pendingRequest = Array.from(this.requests.values()).find(
      (request) =>
        request.host === host &&
        request.threadId === sessionId &&
        ["pending", "responding", "disconnected"].includes(request.status),
    );
    if (pendingRequest) {
      throw new Error("该 Session 仍有待回答问题或审批，不能创建恢复分支");
    }

    const selectedConnectionKey = normalizedConnectionKey(connectionKey);
    const connection = await this.prepareHost(
      host,
      executable,
      selectedConnectionKey,
    );
    const policy = runtimePolicy(session.yolo);
    const result = await connection.request("thread/fork", {
      threadId: sessionId,
      path: null,
      cwd: session.cwd || null,
      model: session.model || null,
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
      ephemeral: false,
      excludeTurns: true,
    });
    const thread = result?.thread || {};
    if (!thread.id || thread.id === sessionId) {
      throw new Error("app-server 未返回有效的恢复分支 Session ID");
    }
    const now = new Date(this.now()).toISOString();
    const record = {
      host,
      sessionId: thread.id,
      path: thread.path || null,
      cwd: sessionDirectory(host, result?.cwd || thread.cwd || session.cwd || ""),
      model: session.model || result?.model || "",
      effort: cleanString(session.effort, 40),
      yolo: policy.yolo,
      executable: session.executable || executable,
      connectionKey: selectedConnectionKey,
      status: this.#statusName(thread.status),
      resumeOnRecovery: true,
      connectedAt: now,
      lastEventAt: now,
      forkedFromSessionId: sessionId,
    };
    this.#cancelCapacityRecovery(host, sessionId);
    this.sessions.delete(key);
    this.sessions.set(`${host}:${record.sessionId}`, record);
    this.emit("session-release", {
      host,
      sessionId,
      reason: "forked-to-active-profile",
      replacementSessionId: record.sessionId,
    });
    this.emit("change");
    return { ...record };
  }

  isManaged(host, sessionId) {
    return this.sessions.has(`${host}:${sessionId}`);
  }

  isConnected(host, sessionId) {
    const session = this.sessions.get(`${host}:${sessionId}`);
    const connection = session
      ? this.connections.get(connectionMapKey(host, session.connectionKey))
      : null;
    return Boolean(
      session &&
        connection &&
        connection.status === "connected" &&
        !connection.closed &&
        session.status !== "offline",
    );
  }

  async answerInput(key, rawAnswers) {
    return this.answerHumanRequest(key, { answers: rawAnswers });
  }

  async answerHumanRequest(key, rawResponse) {
    const request = this.requests.get(key);
    if (!request) throw new Error("找不到这条待处理请求");
    if (request.expiresAt && Date.parse(request.expiresAt) <= this.now()) {
      request.status = "expired";
      request.error = "请求已自动超时";
      this.emit("change");
      throw new Error(request.error);
    }
    const payload = normalizeHumanResponse(request, rawResponse);
    const connection = this.connections.get(
      connectionMapKey(request.host, request.connectionKey),
    );
    if (!connection || connection.status !== "connected") {
      throw new Error("对应主机的 app-server 已断开");
    }
    request.status = "responding";
    request.error = null;
    this.emit("change");
    try {
      connection.respond(request.requestId, payload);
      request.status = "answered";
      request.answeredAt = new Date(this.now()).toISOString();
      this.emit("change");
      return {
        key: request.key,
        kind: request.kind,
        host: request.host,
        threadId: request.threadId,
        answeredAt: request.answeredAt,
      };
    } catch (error) {
      request.status = "pending";
      request.error = publicConnectionError(error);
      this.emit("change");
      throw error;
    }
  }

  sessionRecords() {
    return Array.from(this.sessions.values()).map((session) => {
      const recovery = this.capacityRecoveries.get(
        `${session.host}:${session.sessionId}`,
      );
      const connection = this.connections.get(
        connectionMapKey(session.host, session.connectionKey),
      );
      return {
        ...session,
        capacityRecovery: recovery ? this.#publicCapacityRecovery(recovery) : null,
        rateLimits: connection?.rateLimits || null,
      };
    });
  }

  publicState() {
    const activeRequests = [];
    for (const request of this.requests.values()) {
      if (
        request.status === "pending" &&
        request.expiresAt &&
        Date.parse(request.expiresAt) <= this.now()
      ) {
        request.status = "expired";
        request.error = "请求已自动超时";
      }
      if (["pending", "responding", "disconnected"].includes(request.status)) {
        activeRequests.push({
          ...request,
          ...(request.questions
            ? {
                questions: request.questions.map((question) => ({
                  ...question,
                })),
              }
            : {}),
        });
      }
    }
    activeRequests.sort(
      (a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt),
    );

    return {
      experimental: true,
      connections: Array.from(this.connections.entries()).map(
        ([mapKey, connection]) => {
          const { host, connectionKey } = connectionMapParts(mapKey);
          return {
            ...connection.publicState(
              Array.from(this.sessions.values())
                .filter(
                  (session) =>
                    session.host === host &&
                    normalizedConnectionKey(session.connectionKey) ===
                      connectionKey &&
                    session.status !== "offline",
                )
                .map((session) => session.sessionId),
            ),
            connectionKey,
            rateLimits: connection.rateLimits || null,
          };
        },
      ),
      sessions: this.sessionRecords(),
      pendingRequests: activeRequests,
      pendingInputs: activeRequests.filter(
        (request) => request.kind === "user-input",
      ),
    };
  }

  closeHost(host) {
    this.#cancelHostCapacityRecoveries(host);
    for (const [mapKey, connection] of this.connections.entries()) {
      if (connectionMapParts(mapKey).host !== host) continue;
      connection.close();
      this.connections.delete(mapKey);
    }
    for (const mapKey of this.connecting.keys()) {
      if (connectionMapParts(mapKey).host === host) {
        this.connecting.delete(mapKey);
      }
    }
    for (const session of this.sessions.values()) {
      if (session.host === host) session.status = "offline";
    }
    this.emit("change");
  }

  closeConnection(host, connectionKey = "active") {
    const selectedConnectionKey = normalizedConnectionKey(connectionKey);
    const mapKey = connectionMapKey(host, selectedConnectionKey);
    for (const session of this.sessions.values()) {
      if (
        session.host === host &&
        normalizedConnectionKey(session.connectionKey) === selectedConnectionKey
      ) {
        this.#cancelCapacityRecovery(host, session.sessionId);
      }
    }
    const connection = this.connections.get(mapKey);
    if (connection) {
      connection.close();
      this.connections.delete(mapKey);
    }
    this.connecting.delete(mapKey);
    for (const request of this.requests.values()) {
      if (
        request.host === host &&
        normalizedConnectionKey(request.connectionKey) === selectedConnectionKey &&
        request.status === "pending"
      ) {
        request.status = "disconnected";
        request.error = "app-server writer 正在迁移";
      }
    }
    for (const session of this.sessions.values()) {
      if (
        session.host === host &&
        normalizedConnectionKey(session.connectionKey) === selectedConnectionKey
      ) {
        session.status = "offline";
        session.activeTurnId = null;
      }
    }
    this.emit("change");
  }

  close() {
    for (const recovery of this.capacityRecoveries.values()) {
      if (recovery.timer) this.clearTimer(recovery.timer);
    }
    this.capacityRecoveries.clear();
    // Each connection is a disposable WebSocket proxy to a durable remote
    // app-server. Close the proxy stream without terminating the remote daemon.
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
  }

  #handleNotification(host, connectionKey, message) {
    const params = message.params || {};
    let authenticationFailure = null;
    let turnFailure = null;
    let threadSystemError = null;
    const threadId = cleanString(
      params.threadId || params.turn?.threadId || params.conversationId,
      200,
    );
    if (
      threadId &&
      ["item/started", "item/completed"].includes(message.method) &&
      params.item?.id
    ) {
      this.items.set(
        `${host}:${threadId}:${cleanString(params.item.id, 200)}`,
        params.item,
      );
    }
    if (message.method === "thread/archived" && threadId) {
      this.forgetArchivedSession(host, threadId);
      this.emit("thread-archived", { host, sessionId: threadId, connectionKey });
      return;
    }
    if (message.method === "serverRequest/resolved") {
      const key = humanRequestKey(
        requestScopeHost(host, connectionKey),
        params.requestId,
      );
      const request = this.requests.get(key);
      if (request && request.status !== "answered") {
        request.status = "resolved";
      }
    }
    if (threadId) {
      const session = this.sessions.get(`${host}:${threadId}`);
      if (session) {
        session.lastEventAt = new Date(this.now()).toISOString();
        if (message.method === "turn/started") {
          session.status = "working";
          session.resumeOnRecovery = true;
          session.activeTurnId =
            cleanString(params.turn?.id || params.turnId, 200) ||
            session.activeTurnId ||
            null;
        }
        if (message.method === "error") {
          session.lastProtocolError = errorText(params.error || params);
          if (isModelCapacityError(params.error || params)) {
            this.#scheduleCapacityContinuation(host, threadId, {
              turnId: cleanString(params.turnId, 200),
              error: session.lastProtocolError,
            });
          }
        }
        if (message.method === "turn/completed") {
          const turn = params.turn || {};
          const turnStatus = cleanString(turn.status, 80).toLowerCase();
          const failure = turn.error || params.error || session.lastProtocolError;
          if (turnStatus === "failed" && isModelCapacityError(failure)) {
            session.status = "idle";
            this.#scheduleCapacityContinuation(host, threadId, {
              turnId: cleanString(turn.id || params.turnId, 200),
              error: errorText(failure),
            });
          } else if (
            turnStatus === "failed" &&
            isTransientCodexBackendError(failure)
          ) {
            // Codex has already stored the user item. Continue rather than
            // replaying the original (possibly side-effectful) instruction.
            session.status = "idle";
            this.#scheduleCapacityContinuation(host, threadId, {
              turnId: cleanString(turn.id || params.turnId, 200),
              error: errorText(failure),
              kind: "backend",
            });
          } else if (turnStatus === "failed") {
            session.status = "attention";
            const authFailure = isAuthenticationRefreshError(failure);
            // app-server appends the user item before token refresh fails. Keep
            // the interrupted-work bit so a healthy writer can resume with a
            // single "continue" rather than duplicating the original prompt.
            session.resumeOnRecovery = authFailure;
            this.#failCapacityRecovery(host, threadId, errorText(failure));
            turnFailure = {
              host,
              sessionId: threadId,
              turnId: cleanString(turn.id || params.turnId, 200),
              connectionKey: normalizedConnectionKey(session.connectionKey),
              error: errorText(failure),
              authenticationFailure: authFailure,
            };
            if (authFailure) {
              authenticationFailure = {
                host,
                sessionId: threadId,
                connectionKey: normalizedConnectionKey(session.connectionKey),
                error: errorText(failure),
              };
            }
          } else {
            session.status = "idle";
            session.resumeOnRecovery = false;
            session.lastProtocolError = null;
            this.#cancelCapacityRecovery(host, threadId);
          }
          session.activeTurnId = null;
        }
        if (message.method === "thread/status/changed") {
          session.status = this.#statusName(params.status);
          if (params.status?.type === "systemError") {
            threadSystemError = {
              host,
              sessionId: threadId,
              connectionKey: normalizedConnectionKey(session.connectionKey),
              error: errorText(params.status),
            };
          }
          if (session.status === "working") session.resumeOnRecovery = true;
          if (session.status !== "working") session.activeTurnId = null;
        }
      }
    }
    if (message.method === "account/rateLimits/updated") {
      const connection = this.connections.get(
        connectionMapKey(host, connectionKey),
      );
      if (connection) {
        connection.rateLimits = normalizeAccountQuota(
          params?.rateLimits || params,
        );
      }
    }
    this.emit("change");
    if (authenticationFailure) {
      this.emit("authentication-failure", authenticationFailure);
    }
    if (turnFailure) this.emit("turn-failure", turnFailure);
    if (threadSystemError) this.emit("thread-system-error", threadSystemError);
  }

  #scheduleCapacityContinuation(
    host,
    sessionId,
    { turnId = "", error = "", kind = "capacity" } = {},
  ) {
    const key = `${host}:${sessionId}`;
    const session = this.sessions.get(key);
    if (!session || session.profileHandoff) return;
    if (this.resolveCapacityRetryDelays &&
        !this.connections.get(connectionMapKey(host, session.connectionKey))?.capacityRetryDelaysMs?.length) {
      this.#cancelCapacityRecovery(host, sessionId);
      session.status = "attention";
      return;
    }
    const failureId = turnId || `${session.lastEventAt}:${error}`;
    const current = this.capacityRecoveries.get(key);
    if (current?.lastFailureId === failureId) return;
    if (
      current?.lastError === error &&
      ["scheduled", "waiting"].includes(current.status)
    ) {
      current.lastFailureId = failureId;
      return;
    }

    if (
      Array.from(this.requests.values()).some(
        (request) =>
          request.host === host &&
          request.threadId === sessionId &&
          ["pending", "responding", "disconnected"].includes(request.status),
      )
    ) {
      return;
    }

    const retryDelays =
      kind === "backend"
        ? this.transientRetryDelaysMs
        : this.connections.get(connectionMapKey(host, session.connectionKey))?.capacityRetryDelaysMs || this.capacityRetryDelaysMs;
    const fallbackError =
      kind === "backend"
        ? "Codex backend temporarily unavailable"
        : "Selected model is at capacity";
    const attempt = current?.kind === kind ? current.attempt || 0 : 0;
    if (current?.timer) this.clearTimer(current.timer);
    if (attempt >= retryDelays.length) {
      const exhausted = {
        host,
        sessionId,
        attempt,
        status: "exhausted",
        kind,
        maxAttempts: retryDelays.length,
        nextRetryAt: null,
        lastFailureId: failureId,
        lastError: error || fallbackError,
        lastContinueAt: current?.lastContinueAt || null,
        timer: null,
      };
      this.capacityRecoveries.set(key, exhausted);
      session.status = "attention";
      this.emit("change");
      return;
    }

    const delay = retryDelays[attempt];
    const recovery = {
      host,
      sessionId,
      attempt: attempt + 1,
      status: "scheduled",
      kind,
      maxAttempts: retryDelays.length,
      nextRetryAt: new Date(this.now() + delay).toISOString(),
      lastFailureId: failureId,
      lastError: error || fallbackError,
      lastContinueAt: current?.lastContinueAt || null,
      timer: null,
    };
    recovery.timer = this.setTimer(
      () => this.#runCapacityContinuation(key, recovery),
      delay,
    );
    recovery.timer?.unref?.();
    this.capacityRecoveries.set(key, recovery);
    this.emit("change");
  }

  async #runCapacityContinuation(key, recovery) {
    if (this.capacityRecoveries.get(key) !== recovery) return;
    recovery.timer = null;
    recovery.nextRetryAt = null;
    const session = this.sessions.get(key);
    if (!session) {
      this.capacityRecoveries.delete(key);
      return;
    }
    const hasPendingRequest = Array.from(this.requests.values()).some(
      (request) =>
        request.host === recovery.host &&
        request.threadId === recovery.sessionId &&
        ["pending", "responding", "disconnected"].includes(request.status),
    );
    if (session.status === "working" || hasPendingRequest) {
      recovery.status = "waiting";
      recovery.nextRetryAt = new Date(this.now() + 2_000).toISOString();
      recovery.timer = this.setTimer(
        () => this.#runCapacityContinuation(key, recovery),
        2_000,
      );
      recovery.timer?.unref?.();
      this.emit("change");
      return;
    }

    recovery.status = "sending";
    this.emit("change");
    try {
      await this.startTurn(
        recovery.host,
        recovery.sessionId,
        CAPACITY_CONTINUE_PROMPT,
        { capacityRecovery: true },
      );
      if (this.capacityRecoveries.get(key) !== recovery) return;
      recovery.status = "sent";
      recovery.lastContinueAt = new Date(this.now()).toISOString();
      this.emit("change");
    } catch (failure) {
      if (this.capacityRecoveries.get(key) !== recovery) return;
      recovery.status = "failed";
      recovery.lastError = publicConnectionError(failure);
      session.status = "attention";
      this.emit("change");
    }
  }

  #failCapacityRecovery(host, sessionId, failure) {
    const key = `${host}:${sessionId}`;
    const recovery = this.capacityRecoveries.get(key);
    if (!recovery) return;
    if (recovery.timer) this.clearTimer(recovery.timer);
    recovery.timer = null;
    recovery.status = "failed";
    recovery.nextRetryAt = null;
    recovery.lastError = failure || recovery.lastError;
  }

  #cancelCapacityRecovery(host, sessionId) {
    const key = `${host}:${sessionId}`;
    const recovery = this.capacityRecoveries.get(key);
    if (recovery?.timer) this.clearTimer(recovery.timer);
    this.capacityRecoveries.delete(key);
  }

  #cancelHostCapacityRecoveries(host) {
    for (const recovery of this.capacityRecoveries.values()) {
      if (recovery.host !== host) continue;
      if (recovery.timer) this.clearTimer(recovery.timer);
      this.capacityRecoveries.delete(`${recovery.host}:${recovery.sessionId}`);
    }
  }

  #publicCapacityRecovery(recovery) {
    return {
      status: recovery.status,
      kind: recovery.kind || "capacity",
      attempt: recovery.attempt,
      maxAttempts: recovery.maxAttempts ?? this.capacityRetryDelaysMs.length,
      nextRetryAt: recovery.nextRetryAt,
      lastError: recovery.lastError,
      lastContinueAt: recovery.lastContinueAt,
    };
  }

  #statusName(status) {
    if (status?.type === "active") return "working";
    if (status?.type === "systemError") return "attention";
    if (status?.type === "notLoaded") return "offline";
    return "idle";
  }
}
