/**
 * Keep the relative order the user is currently browsing while still
 * removing vanished rows and appending newly discovered rows.
 *
 * Passing an empty previousKeys array deliberately adopts nextItems' current
 * order, which lets callers expose an explicit "refresh order" action.
 *
 * @template T
 * @param {T[]} nextItems
 * @param {string[]} previousKeys
 * @param {(item: T) => string} keyOf
 * @returns {{ items: T[], keys: string[] }}
 */
export function retainStableOrder(nextItems, previousKeys, keyOf) {
  const itemsByKey = new Map();
  for (const item of nextItems) {
    itemsByKey.set(keyOf(item), item);
  }

  const keys = [];
  const seen = new Set();
  for (const key of previousKeys) {
    if (!itemsByKey.has(key) || seen.has(key)) continue;
    keys.push(key);
    seen.add(key);
  }
  for (const item of nextItems) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    keys.push(key);
    seen.add(key);
  }

  return {
    items: keys.map((key) => itemsByKey.get(key)),
    keys,
  };
}

