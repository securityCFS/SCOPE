import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationEntries,
  hasConversationReply,
  mergeConversationPage,
} from "../lib/conversation.js";
import { conversationRoutes } from "../bridge/workbench/conversation-routes.mjs";

const event = (id, kind = "assistant", text = id) => ({ id, kind, text });
test("identical replies in separate turns clear waiting without mistaking an old loaded reply for new work", () => {
  const pending = { baselineAssistantId: "old", baselineAssistant: "收到" };
  assert.equal(
    hasConversationReply(pending, {
      latestAssistantId: "new",
      latestAssistant: "收到",
    }),
    true,
  );
  assert.equal(
    hasConversationReply(pending, {
      latestAssistantId: "old",
      latestAssistant: "收到，旧消息的完整文本",
    }),
    false,
  );
  assert.equal(
    hasConversationReply(pending, {
      latestAssistantId: "new",
      latestAssistant: "",
    }),
    false,
  );
});
test("conversation preserves final replies and collapses adjacent thinking and execution", () => {
  const input = [
    event("u", "user"),
    event("c", "intermediate"),
    event("t", "tool"),
    event("cmd", "command"),
    event("a"),
    event("e", "error"),
    event("a"),
  ];
  const entries = conversationEntries(input);
  assert.deepEqual(
    entries.map((e) => [e.type, e.id]),
    [
      ["message", "u"],
      ["activity", "c"],
      ["message", "a"],
      ["message", "e"],
    ],
  );
  assert.deepEqual(
    entries[1].events.map((e) => e.id),
    ["c", "t", "cmd"],
  );
  assert.equal(input.length, 7);
});
test("progress reports split tool groups and stay expanded in chronological order", () => {
  const entries = conversationEntries([
    event("u", "user"),
    { ...event("p1"), phase: "commentary", category: "reasoning" },
    event("cmd1", "command"), event("tool1", "tool"),
    { ...event("p2"), phase: "commentary", category: "reasoning" },
    event("think", "reasoning"), event("cmd2", "command"),
    { ...event("p3"), phase: "commentary", category: "dialogue" },
    event("final"),
  ]);
  assert.deepEqual(entries.map(e => [e.type, e.id]), [
    ["message", "u"], ["message", "p1"], ["activity", "cmd1"],
    ["message", "p2"], ["activity", "think"], ["message", "p3"], ["message", "final"],
  ]);
  assert.deepEqual(entries.filter(e => e.type === "activity").map(e => e.events.map(v => v.id)), [["cmd1", "tool1"], ["think", "cmd2"]]);
});

test("live tail refresh preserves older pages and updates a streaming message without duplicates", () => {
  const previous = {
    host: "h",
    sessionId: "s",
    events: [event("old"), event("a", "assistant", "partial")],
    hasMore: true,
    nextBefore: 10,
  };
  const incoming = {
    host: "h",
    sessionId: "s",
    events: [event("a", "assistant", "complete"), event("new")],
    hasMore: true,
    nextBefore: 40,
  };
  const merged = mergeConversationPage(previous, incoming);
  assert.deepEqual(
    merged.events.map((e) => e.text),
    ["old", "complete", "new"],
  );
  assert.equal(merged.nextBefore, 10);
  assert.equal(
    mergeConversationPage(
      { ...previous, hasMore: false, nextBefore: null },
      incoming,
    ).hasMore,
    false,
  );
  assert.equal(
    mergeConversationPage(previous, { ...incoming, host: "other" }).events
      .length,
    2,
  );
});
test("interrupt route validates a target and surfaces offline failure instead of claiming success", async () => {
  let result,
    persisted = 0,
    calls = 0;
  const route = conversationRoutes(
    {
      async interruptTurn() {
        calls++;
        throw new Error("offline");
      },
    },
    {
      readJsonBody: async (req) => req.body,
      jsonResponse: (_res, status, body) => {
        result = { status, body };
      },
      persist: async () => {
        persisted++;
      },
    },
  );
  const url = new URL("http://localhost/api/session/interrupt");
  await route({ method: "POST", body: { host: "", sessionId: "s" } }, {}, url);
  assert.equal(calls, 0);
  assert.equal(result.status, 409);
  await route({ method: "POST", body: { host: "h", sessionId: "s" } }, {}, url);
  assert.equal(result.body.error, "offline");
  assert.equal(persisted, 0);
});
