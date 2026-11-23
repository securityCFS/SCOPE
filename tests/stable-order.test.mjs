import assert from "node:assert/strict";
import test from "node:test";

import { retainStableOrder } from "../lib/stable-order.js";

const keyOf = (item) => item.id;

test("adopts the desired order for an uninitialized list", () => {
  const result = retainStableOrder(
    [{ id: "newest" }, { id: "older" }],
    [],
    keyOf,
  );

  assert.deepEqual(result.keys, ["newest", "older"]);
  assert.deepEqual(result.items.map(keyOf), ["newest", "older"]);
});

test("live updates do not reorder rows already being browsed", () => {
  const result = retainStableOrder(
    [{ id: "third" }, { id: "first" }, { id: "second" }],
    ["first", "second", "third"],
    keyOf,
  );

  assert.deepEqual(result.items.map(keyOf), ["first", "second", "third"]);
});

test("removes missing rows and appends newly discovered rows", () => {
  const result = retainStableOrder(
    [{ id: "new-a" }, { id: "kept" }, { id: "new-b" }],
    ["removed", "kept"],
    keyOf,
  );

  assert.deepEqual(result.items.map(keyOf), ["kept", "new-a", "new-b"]);
});

