const ATTACHMENT_PREVIEW_RE = /\n*\s*\[附件:\s*[^\]]*\]\s*$/;
const ATTACHMENT_MANIFEST_RE = /\n*\[SCOPE 网页附件：[\s\S]*$/;
const EMPTY_ATTACHMENT_PROMPT = "请查看并处理本条消息附带的文件。";

function stripAttachmentEnvelope(text, pattern) {
  const source = typeof text === "string" ? text : "";
  const matched = pattern.test(source);
  return {
    text: source.replace(pattern, "").trim(),
    hasAttachment: matched,
  };
}

function promptsMatch(messageText, turnPrompt) {
  const msg = stripAttachmentEnvelope(messageText, ATTACHMENT_MANIFEST_RE);
  const turn = stripAttachmentEnvelope(turnPrompt, ATTACHMENT_PREVIEW_RE);
  if (msg.text === turn.text) return true;
  if (msg.hasAttachment || turn.hasAttachment) {
    if (
      (turn.text === "" && msg.text === EMPTY_ATTACHMENT_PROMPT) ||
      (msg.text === "" && turn.text === EMPTY_ATTACHMENT_PROMPT)
    ) {
      return true;
    }
  }
  return false;
}

/** Match a spool turn against its corresponding native history user entry. */
export function historyContainsUserTurn(messages, turn) {
  if (!Array.isArray(messages) || !turn?.prompt) return false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (
      message.role !== "user" ||
      !promptsMatch(message.text || "", turn.prompt || "")
    )
      continue;
    const at = Date.parse(message.createdAt || "");
    if (!Number.isFinite(at) || !turn.createdAt || at < turn.createdAt - 2000)
      continue;
    return true;
  }
  return false;
}

/** Hide a spool turn only when native history contains that exact user/reply pair. */
export function historyContainsTurn(messages, turn) {
  if (!Array.isArray(messages) || turn?.status !== "completed" || !turn.text?.trim())
    return false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (
      message.role !== "user" ||
      !promptsMatch(message.text || "", turn.prompt || "")
    )
      continue;
    const at = Date.parse(message.createdAt || "");
    if (!Number.isFinite(at) || !turn.createdAt || at < turn.createdAt - 2000)
      continue;
    for (
      let next = index + 1;
      next < messages.length && messages[next].role !== "user";
      next++
    ) {
      if (
        messages[next].role === "assistant" &&
        messages[next].text.trim() === turn.text.trim()
      )
        return true;
    }
  }
  return false;
}

/** Keep only unresolved spool turns after the latest native-history-matched turn. */
export function visibleSpoolTurns(messages, turns) {
  if (!Array.isArray(turns)) return [];
  if (!Array.isArray(messages) || messages.length === 0) return turns;
  const matched = turns.map((turn) => historyContainsTurn(messages, turn));
  const lastMatchedIndex = matched.lastIndexOf(true);
  return turns.filter((turn, index) => {
    if (matched[index]) return false;
    if (index < lastMatchedIndex) return false;
    if (
      turn.status === "stopped" &&
      index < turns.length - 1 &&
      historyContainsUserTurn(messages, turn)
    ) {
      return false;
    }
    return true;
  });
}
