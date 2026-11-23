/** Shallow field patches keep unchanged histories out of inventory updates. */
function fields(before, after, omit = []) {
  const set = {}, unset = [];
  for (const key of Object.keys(after)) {
    if (!omit.includes(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])) set[key] = after[key];
  }
  for (const key of Object.keys(before)) {
    if (!omit.includes(key) && !Object.hasOwn(after, key)) unset.push(key);
  }
  return { set, unset };
}
export function overviewDelta(before, after) {
  const patch = fields(before, after, ["hosts"]);
  const previous = new Map((before.hosts || []).map(host => [host.alias, host]));
  const changes = [];
  for (const host of after.hosts || []) {
    const old = previous.get(host.alias);
    const value = fields(old || {}, host);
    if (!old || Object.keys(value.set).length || value.unset.length)
      changes.push({ alias: host.alias, replace: !old, ...value });
  }
  const order = (after.hosts || []).map(host => host.alias);
  const orderChanged = JSON.stringify(order) !== JSON.stringify((before.hosts || []).map(host => host.alias));
  if (changes.length || orderChanged) patch.hosts = { changes, ...(orderChanged ? { order } : {}) };
  return Object.keys(patch.set).length || patch.unset.length || patch.hosts ? patch : null;
}
function applyFields(before, patch) {
  const result = { ...before, ...patch.set };
  for (const key of patch.unset) delete result[key];
  return result;
}
export function applyOverviewDelta(before, patch) {
  const next = applyFields(before, patch);
  if (patch.hosts) {
    const hosts = new Map((before.hosts || []).map(host => [host.alias, host]));
    for (const change of patch.hosts.changes)
      hosts.set(change.alias, applyFields(change.replace ? {} : hosts.get(change.alias), change));
    next.hosts = (patch.hosts.order || [...hosts.keys()]).map(alias => hosts.get(alias));
  }
  return next;
}
