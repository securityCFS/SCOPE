import { spawn } from "node:child_process";
import { JsonlAppServerConnection } from "../bridge/app-server-client.mjs";

const executable = process.argv[2];
const cwd = process.argv[3] || process.cwd();
if (!executable) {
  console.error(
    "usage: node tests/real-plan-input-smoke.mjs <codex-binary> [cwd]",
  );
  process.exit(2);
}

function waitFor(emitter, eventName, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(eventName, onEvent);
      reject(new Error(`timed out waiting for ${eventName}`));
    }, timeoutMs);
    function onEvent(value) {
      if (!predicate(value)) return;
      clearTimeout(timer);
      emitter.off(eventName, onEvent);
      resolve(value);
    }
    emitter.on(eventName, onEvent);
  });
}

const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const connection = new JsonlAppServerConnection({
  host: "local-plan-smoke",
  child,
  requestTimeoutMs: 30_000,
});
connection.on("protocol-error", (error) => {
  console.error(`protocol-error: ${error.message}`);
});
connection.on("notification", (message) => {
  if (
    [
      "error",
      "warning",
      "turn/started",
      "turn/completed",
      "item/completed",
    ].includes(message.method)
  ) {
    console.error(
      `notification: ${message.method} ${JSON.stringify(message.params)}`,
    );
  }
});

try {
  await connection.start();
  const models = await connection.request("model/list", {});
  const model =
    models.data.find((candidate) => candidate.id === "gpt-5.4-mini")?.id ||
    models.data[0]?.id;
  if (!model) throw new Error("app-server did not return an available model");
  const started = await connection.request("thread/start", {
    cwd,
    model,
    ephemeral: true,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  const threadId = started.thread.id;
  const inputPromise = waitFor(
    connection,
    "user-input",
    (input) => input.threadId === threadId,
    90_000,
  );
  const completedPromise = waitFor(
    connection,
    "notification",
    (message) =>
      message.method === "turn/completed" &&
      message.params?.threadId === threadId,
    90_000,
  );

  await connection.request("turn/start", {
    threadId,
    input: [
      {
        type: "text",
        text: [
          "这是一次 SCOPE app-server 协议冒烟测试。",
          "请立即调用 request_user_input，且只提出一个问题：",
          "id=protocol_check，header=协议测试，question=网页是否收到了这个选项？",
          "提供两个选项：收到 (Recommended)，description=确认双向协议正常；",
          "未收到，description=报告协议失败。不要执行其他操作。",
        ].join(" "),
        text_elements: [],
      },
    ],
    collaborationMode: {
      mode: "plan",
      settings: {
        model: started.model,
        reasoning_effort: "low",
        developer_instructions: null,
      },
    },
  });

  const firstOutcome = await Promise.race([
    inputPromise.then((input) => ({ type: "input", input })),
    completedPromise.then((completed) => ({ type: "completed", completed })),
  ]);
  if (firstOutcome.type === "completed") {
    throw new Error(
      `turn completed before request_user_input: ${JSON.stringify(
        firstOutcome.completed.params.turn,
      )}`,
    );
  }
  const input = firstOutcome.input;
  const selected =
    input.questions[0]?.options?.find((option) =>
      option.label.includes("Recommended"),
    )?.label || input.questions[0]?.options?.[0]?.label;
  if (!selected) throw new Error("request_user_input did not include options");
  connection.respond(input.requestId, {
    answers: {
      [input.questions[0].id]: { answers: [selected] },
    },
  });
  const completed = await completedPromise;
  console.log(
    JSON.stringify({
      threadId,
      requestId: input.requestId,
      questionId: input.questions[0].id,
      optionLabels: input.questions[0].options.map((option) => option.label),
      selected,
      turnStatus: completed.params.turn.status,
    }),
  );
} finally {
  connection.close();
}
