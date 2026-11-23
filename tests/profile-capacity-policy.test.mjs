import assert from "node:assert/strict";
import test from "node:test";
import { profileCapacityRetryDelays } from "../bridge/profile-capacity-policy.mjs";

const profiles = { activeProfile: "pro-plus", profiles: [
  { slug: "pro-plus", account: { email: "plus@example.test" } },
  { slug: "pro-plus-2", account: { email: "second@example.test" } },
] };
test("only the actual pro-plus writer gets 100 bounded capacity retries", () => {
  const delays = profileCapacityRetryDelays(profiles, { type: "chatgpt", email: "plus@example.test" });
  assert.equal(delays.length, 100);
  assert.deepEqual(delays.slice(0, 5), [3000, 10000, 30000, 60000, 120000]);
  assert.ok(delays.slice(5).every((delay) => delay === 120000));
  for (const account of [null, { type: "chatgpt", email: "lite@example.test" }, { type: "chatgpt", email: "second@example.test" }]) {
    assert.equal(profileCapacityRetryDelays(profiles, account).length, 0);
  }
  assert.equal(profileCapacityRetryDelays(null, { type: "chatgpt", email: "plus@example.test" }).length, 0);
});
