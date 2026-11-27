import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildCloudflaredConfig,
  buildLoginUrl,
  isValidDomain,
  isValidTunnelName,
  renderSystemdUnits,
} from "../scripts/remote-expose-cli.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(root, "bin", "scope.mjs");

test("remote-expose helpers validate domains/tunnels and render safe cloudflared & systemd configs", () => {
  assert.equal(isValidDomain("scope.example.com"), true);
  assert.equal(isValidDomain("my-hub.sub.example.dev"), true);
  assert.equal(isValidDomain("https://scope.example.com"), false);
  assert.equal(isValidDomain("scope.example.com/path"), false);
  assert.equal(isValidDomain("localhost"), false);
  assert.equal(isValidDomain("bad host.com"), false);

  assert.equal(isValidTunnelName("scope-hub"), true);
  assert.equal(isValidTunnelName("hub_01.prod"), true);
  assert.equal(isValidTunnelName("bad name; rm -rf /"), false);

  const yaml = buildCloudflaredConfig({
    tunnelId: "11111111-2222-3333-4444-555555555555",
    credentialsFile: "/home/dev/.cloudflared/11111111-2222-3333-4444-555555555555.json",
    domain: "SCOPE.Example.DEV",
    gatewayPort: 4820,
  });
  assert.match(yaml, /^tunnel: 11111111-2222-3333-4444-555555555555/m);
  assert.match(yaml, /hostname: scope\.example\.dev/);
  assert.match(yaml, /service: http:\/\/127\.0\.0\.1:4820/);
  assert.match(yaml, /service: http_status:404/);

  assert.equal(
    buildLoginUrl("https://scope.example.dev", "abc123code"),
    "https://scope.example.dev/?scope_login=abc123code",
  );

  const units = renderSystemdUnits({
    nodeBin: "/usr/bin/node",
    scopeBin: "/usr/local/lib/node_modules/@godchaser/scope/bin/scope.mjs",
    stateDir: "/home/dev/.scope",
    uiPort: 3000,
    bridgePort: 4815,
    gatewayPort: 4820,
    withGateway: true,
    withCloudflared: true,
    cloudflaredBin: "/home/dev/.local/bin/cloudflared",
    cloudflaredConfig: "/home/dev/.cloudflared/config.yml",
    tunnelName: "scope-hub",
  });
  assert.deepEqual(
    units.map((u) => u.name),
    [
      "scope-workbench.service",
      "scope-private-gateway.service",
      "scope-cloudflared.service",
    ],
  );
  assert.match(units[0].content, /start --skip-build --port 3000 --bridge-port 4815/);
  assert.match(units[1].content, /gateway --port 4820 --ui-port 3000 --bridge-port 4815/);
  assert.match(units[2].content, /cloudflared tunnel --no-autoupdate --config \/home\/dev\/\.cloudflared\/config\.yml run scope-hub/);
});

test("scope token hides secret by default, prints single-use login URLs, and rotates cleanly", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "scope-token-cli-"));
  try {
    const hiddenOut = execFileSync(
      process.execPath,
      [cli, "token", "--state-dir", dir],
      { encoding: "utf8" },
    );
    const saved1 = JSON.parse(readFileSync(path.join(dir, "private-access.json"), "utf8"));
    assert.ok(typeof saved1.token === "string" && saved1.token.length >= 32);
    assert.equal(hiddenOut.includes(saved1.token), false);

    const shownOut = execFileSync(
      process.execPath,
      [cli, "token", "--show", "--url", "https://scope.example.dev", "--state-dir", dir],
      { encoding: "utf8" },
    );
    assert.ok(shownOut.includes(`Token:     ${saved1.token}`));
    const loginLine = shownOut.split("\n").find((line) => line.startsWith("Login URL: "));
    assert.match(loginLine, /^Login URL: https:\/\/scope\.example\.dev\/\?scope_login=[A-Za-z0-9_-]{32}$/);
    assert.equal(loginLine.includes(saved1.token), false);
    const withCode = JSON.parse(readFileSync(path.join(dir, "private-access.json"), "utf8"));
    assert.equal(withCode.token, saved1.token);
    assert.equal(withCode.loginCodes.length, 1);
    assert.equal(JSON.stringify(withCode.loginCodes).includes(loginLine.split("=").pop()), false);

    // --url alone prints a single-use URL without revealing the master token.
    const urlOnlyOut = execFileSync(
      process.execPath,
      [cli, "token", "--url", "https://scope.example.dev", "--state-dir", dir],
      { encoding: "utf8" },
    );
    assert.match(urlOnlyOut, /Login URL: https:\/\/scope\.example\.dev\/\?scope_login=/);
    assert.equal(urlOnlyOut.includes(saved1.token), false);

    const rotatedOut = execFileSync(
      process.execPath,
      [cli, "token", "--rotate", "--url", "https://scope.example.dev", "--state-dir", dir],
      { encoding: "utf8" },
    );
    const saved2 = JSON.parse(readFileSync(path.join(dir, "private-access.json"), "utf8"));
    assert.notEqual(saved2.token, saved1.token);
    assert.ok(saved2.token.length >= 32);
    assert.ok(rotatedOut.includes(saved2.token));

    const emptyDevicesOut = execFileSync(
      process.execPath,
      [cli, "devices", "list", "--state-dir", dir],
      { encoding: "utf8" },
    );
    assert.match(emptyDevicesOut, /No trusted devices/i);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("scope expose & service dry-run commands render accurate Tailscale, Cloudflare, and systemd plans", () => {
  const tsDry = execFileSync(
    process.execPath,
    [cli, "expose", "tailscale", "--gateway-port", "4820", "--dry-run"],
    { encoding: "utf8" },
  );
  assert.match(tsDry, /tailscale serve --bg --https=443 http:\/\/127\.0\.0\.1:4820/);
  assert.match(tsDry, /NEVER Funnel/i);

  const cfDry = execFileSync(
    process.execPath,
    [cli, "expose", "cloudflare", "--domain", "scope.example.dev", "--tunnel", "my-hub", "--dry-run"],
    { encoding: "utf8" },
  );
  assert.match(cfDry, /cloudflared tunnel create my-hub/);
  assert.match(cfDry, /cloudflared tunnel route dns my-hub scope\.example\.dev/);
  assert.match(cfDry, /service: http:\/\/127\.0\.0\.1:4820/);
  assert.match(cfDry, /Do NOT add Login Methods/);

  const badDomain = spawnSync(
    process.execPath,
    [cli, "expose", "cloudflare", "--domain", "http://evil/path", "--dry-run"],
    { encoding: "utf8" },
  );
  assert.equal(badDomain.status, 1);
  assert.match(badDomain.stderr, /Invalid --domain|Missing or invalid --domain/i);

  const svcDry = execFileSync(
    process.execPath,
    [
      cli,
      "service",
      "install",
      "--with-gateway",
      "--with-cloudflared",
      "--tunnel",
      "my-hub",
      "--dry-run",
    ],
    { encoding: "utf8" },
  );
  assert.match(svcDry, /--- scope-workbench\.service ---/);
  assert.match(svcDry, /--- scope-private-gateway\.service ---/);
  assert.match(svcDry, /--- scope-cloudflared\.service ---/);
});
