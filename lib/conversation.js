/**
 * Keep progress reports in the timeline; collapse only adjacent internal activity.
 * @param {import('../features/workspace/types').DialogueEvent[]} events
 * @returns {({type: 'message', id: string, event: import('../features/workspace/types').DialogueEvent} | {type: 'activity', id: string, events: import('../features/workspace/types').DialogueEvent[]})[]}
 */
export function conversationEntries(events) {
  /** @type {ReturnType<typeof conversationEntries>} */
  const entries = [];
  const seen = new Set();
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (
      event.kind === "user" ||
      event.kind === "error" ||
      (event.kind === "assistant" &&
        (event.phase === "commentary" || event.category !== "reasoning"))
    ) {
      entries.push({ type: "message", id: event.id, event });
    } else {
      const previous = entries.at(-1);
      if (previous?.type === "activity") previous.events.push(event);
      else entries.push({ type: "activity", id: event.id, events: [event] });
    }
  }
  return entries;
}

/** A new tail must not discard the older pages the reader explicitly loaded. */
export function mergeConversationPage(previous, incoming) {
  if (
    !previous ||
    previous.sessionId !== incoming.sessionId ||
    previous.host !== incoming.host
  )
    return incoming;
  const events = new Map(previous.events.map((event) => [event.id, event]));
  incoming.events.forEach((event) => events.set(event.id, event));
  const older =
    previous.nextBefore !== null &&
    incoming.nextBefore !== null &&
    previous.nextBefore < incoming.nextBefore;
  const complete = previous.hasMore === false;
  return {
    ...incoming,
    events: [...events.values()],
    hasMore: complete ? false : older ? previous.hasMore : incoming.hasMore,
    nextBefore: complete
      ? null
      : older
        ? previous.nextBefore
        : incoming.nextBefore,
  };
}

/** Identical text in separate assistant messages is still a new reply. */
export function hasConversationReply(pending, latest) {
  if (!latest.latestAssistant) return false;
  if (pending.baselineAssistantId !== undefined && latest.latestAssistantId)
    return latest.latestAssistantId !== pending.baselineAssistantId;
  return latest.latestAssistant !== pending.baselineAssistant;
}
