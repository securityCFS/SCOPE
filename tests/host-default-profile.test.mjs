import { bridgeSource } from "./helpers/bridge-source.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const server = bridgeSource();
test("default profile route never disconnects, migrates or restarts live sessions", () => {
  const route = server.split('url.pathname === "/api/auth/profiles/activate"')[1].split('url.pathname === "/api/auth/profiles/delete"')[0];
  assert.match(route, /runProfileWrite\(\s*host.alias,\s*"select-default"/);
  assert.match(route, /restartRequired: false/);
  assert.doesNotMatch(route, /closeUnboundHostConnections|startAuthRestart|retireProfile|resumeSession|assertNoPendingProfileMigration/);
});
test("default selection does not overwrite either account's credentials", () => {
  const probe = server.split('elif action == "select-default":')[1].split('elif action == "activate":')[0];
  assert.match(probe, /os.replace\(marker_tmp, os.path.join\(root, "active"\)\)/);
  assert.doesNotMatch(probe, /atomic_copy|default_auth|shutil|unlink/);
});
test("new sessions explicitly resolve the host default without reusing active transport", () => {
  assert.match(server, /connectionKey: await newSessionConnectionKey\(host.alias\)/);
  assert.match(server, /existing\?\.connectionKey \|\| options.connectionKey \|\| recoveredWriter\?\.connectionKey \|\| await newSessionConnectionKey/);
});
