import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadDeploymentProfile } from "../bridge/deployment-profile.mjs";
test("fresh deployments have no personal hosts, tunnels or experimental queue", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "scope-deployment-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "deployment.json");
  assert.deepEqual(loadDeploymentProfile({ filename, env: {} }), {
    taskQueue: false,
    dlcHostname: "",
    proxyBootstrapHosts: [],
    emailTunnelHost: "",
  });
  writeFileSync(
    filename,
    JSON.stringify({
      taskQueue: true,
      dlcHostname: "dlc-host",
      proxyBootstrapHosts: ["alpha"],
    }),
  );
  assert.equal(
    loadDeploymentProfile({
      filename,
      env: { SCOPE_ENABLE_TASK_QUEUE: "0", SCOPE_DLC_SSH_HOSTNAME: "" },
    }).taskQueue,
    false,
  );
  assert.equal(
    loadDeploymentProfile({ filename, env: {} }).dlcHostname,
    "dlc-host",
  );
  assert.throws(
    () =>
      loadDeploymentProfile({
        filename,
        env: { SCOPE_EMAIL_TUNNEL_HOST: "-Fbad" },
      }),
    /Invalid host/,
  );
  writeFileSync(filename, '{"taskQueue":"false"}');
  assert.throws(() => loadDeploymentProfile({ filename, env: {} }), /boolean/);
});
