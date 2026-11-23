import assert from "node:assert/strict";
import test from "node:test";
import { sshAliasesForHostname } from "../lib/ssh-config.js";

test("limits DLC scans to aliases configured for the DLC SSH hostname", () => {
  const config = `
Host 10.0.0.12
  HostName 10.0.0.12

Host gpu-box gpu-box-debug
  HostName 198.51.100.24

Host *
  ServerAliveInterval 30
`;
  assert.deepEqual(
    [...sshAliasesForHostname(config, "198.51.100.24")].sort(),
    ["198.51.100.24", "gpu-box", "gpu-box-debug"],
  );
});
