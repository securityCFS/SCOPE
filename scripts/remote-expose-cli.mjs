#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createLoginCode,
  parsePortOrigin,
  listTrustedDevices,
  loadOrCreatePrivateAccessToken,
  revokeTrustedDevice,
  rotatePrivateAccessToken,
} from "../bridge/private-gateway.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, "..");
const SCOPE_BIN = path.join(PACKAGE_ROOT, "bin", "scope.mjs");

export function isValidDomain(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 253 || !trimmed.includes(".")) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(trimmed);
}

export function isValidTunnelName(value) {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/.test(value.trim())
  );
}

export function parsePortFlag(raw, fallback, label = "port") {
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) {
    throw new Error(`${label} must be an integer between 1024 and 65535`);
  }
  return parsed;
}

export function parseHttpsPortFlag(raw, fallback = 443) {
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("HTTPS port must be an integer between 1 and 65535");
  }
  return parsed;
}

export function buildLoginUrl(baseUrl, loginCode) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Login URL must start with https:// or http://");
  }
  parsed.searchParams.set("scope_login", loginCode);
  return parsed.toString();
}

export function buildCloudflaredConfig({
  tunnelId,
  credentialsFile,
  domain,
  portDomain = "",
  gatewayPort = 4820,
}) {
  if (!isValidDomain(domain)) {
    throw new Error(`Invalid domain name: ${domain}`);
  }
  if (portDomain && !isValidDomain(portDomain)) {
    throw new Error(`Invalid port domain name: ${portDomain}`);
  }
  if (portDomain && portDomain.trim().toLowerCase() === domain.trim().toLowerCase()) {
    throw new Error("--port-domain must differ from --domain");
  }
  const safePort = parsePortFlag(gatewayPort, 4820, "gateway-port");
  const hostnames = [domain, ...(portDomain ? [portDomain] : [])];
  return [
    `tunnel: ${tunnelId}`,
    `credentials-file: ${credentialsFile}`,
    "ingress:",
    ...hostnames.flatMap((hostname) => [
      `  - hostname: ${hostname.trim().toLowerCase()}`,
      `    service: http://127.0.0.1:${safePort}`,
    ]),
    "  - service: http_status:404",
    "",
  ].join("\n");
}

function systemdQuote(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderSystemdUnits({
  nodeBin = process.execPath,
  scopeBin = SCOPE_BIN,
  stateDir,
  uiPort = 3000,
  bridgePort = 4815,
  gatewayPort = 4820,
  withGateway = false,
  withCloudflared = false,
  cloudflaredBin = "cloudflared",
  cloudflaredConfig = path.join(os.homedir(), ".cloudflared", "config.yml"),
  tunnelName = "scope-hub",
  pathEnv = process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
  workingDir = os.homedir(),
  portOrigin = "",
}) {
  const safePortOrigin = portOrigin ? parsePortOrigin(portOrigin).origin : "";
  const safeUiPort = parsePortFlag(uiPort, 3000, "port");
  const safeBridgePort = parsePortFlag(bridgePort, 4815, "bridge-port");
  const safeGatewayPort = parsePortFlag(gatewayPort, 4820, "gateway-port");
  const resolvedState = path.resolve(stateDir);
  const units = [];

  units.push({
    name: "scope-workbench.service",
    content: [
      "[Unit]",
      "Description=SCOPE Cross-Host Multi-Agent Workbench (127.0.0.1)",
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      `WorkingDirectory=${workingDir}`,
      `ExecStart=${systemdQuote(nodeBin)} ${systemdQuote(scopeBin)} start --skip-build --port ${safeUiPort} --bridge-port ${safeBridgePort} --state-dir ${systemdQuote(resolvedState)}`,
      "Restart=on-failure",
      "RestartSec=5",
      `Environment=PATH=${pathEnv}`,
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n"),
  });

  if (withGateway) {
    units.push({
      name: "scope-private-gateway.service",
      content: [
        "[Unit]",
        `Description=SCOPE Private Access Gateway (127.0.0.1:${safeGatewayPort})`,
        "After=scope-workbench.service",
        "Wants=scope-workbench.service",
        "",
        "[Service]",
        "Type=simple",
        `WorkingDirectory=${workingDir}`,
        `ExecStart=${systemdQuote(nodeBin)} ${systemdQuote(scopeBin)} gateway --port ${safeGatewayPort} --ui-port ${safeUiPort} --bridge-port ${safeBridgePort} --state-dir ${systemdQuote(resolvedState)}`,
        "Restart=on-failure",
        "RestartSec=5",
        `Environment=PATH=${pathEnv}`,
        ...(safePortOrigin ? [`Environment=SCOPE_PORT_ORIGIN=${safePortOrigin}`] : []),
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n"),
    });
  }

  if (withCloudflared) {
    if (!isValidTunnelName(tunnelName)) {
      throw new Error(`Invalid tunnel name: ${tunnelName}`);
    }
    units.push({
      name: "scope-cloudflared.service",
      content: [
        "[Unit]",
        `Description=Cloudflare Tunnel for SCOPE (${tunnelName})`,
        "After=network-online.target scope-private-gateway.service",
        "Wants=network-online.target scope-private-gateway.service",
        "",
        "[Service]",
        "Type=simple",
        `ExecStart=${systemdQuote(cloudflaredBin)} tunnel --no-autoupdate --config ${systemdQuote(cloudflaredConfig)} run ${systemdQuote(tunnelName)}`,
        "Restart=on-failure",
        "RestartSec=5",
        `Environment=PATH=${pathEnv}`,
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n"),
    });
  }

  return units;
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
}

function defaultStateDir(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.SCOPE_STATE_DIR) return path.resolve(process.env.SCOPE_STATE_DIR);
  const cwdScope = path.resolve(process.cwd(), ".scope");
  if (existsSync(cwdScope) || path.resolve(process.cwd()) === PACKAGE_ROOT) {
    return cwdScope;
  }
  return path.join(os.homedir(), ".scope");
}

function resolveBinary(name) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [name], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return null;
  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first || null;
}

function checkLoopbackListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(600);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

function printCloudflareAccessChecklist(domain, portDomain = "") {
  console.log("");
  console.log("[scope] Recommended: Enable Cloudflare Zero Trust Access (Double Auth)");
  console.log(`  1. Open Cloudflare Zero Trust -> Access -> Applications -> Add a Self-hosted application`);
  console.log(`  2. Application domain: ${domain}`);
  console.log("  3. Create an Allow policy:");
  console.log("     - Include: Emails -> add ONLY your own email address(es)");
  console.log("     - IMPORTANT: Do NOT add Login Methods (e.g. One-time PIN) inside Include!");
  console.log("       Include rules use OR logic; adding Login Methods there allows ANY email.");
  console.log("  4. Under Authentication settings, select One-time PIN (or GitHub / Google IdP).");
  console.log(`  5. Verify protection: curl -sI https://${domain}/   (should return HTTP 302 to cloudflareaccess.com)`);
  if (portDomain) {
    console.log(`  6. Add ${portDomain} as a second public hostname of the SAME Access application,`);
    console.log(`     then verify: curl -sI https://${portDomain}/scope-port/1/   (should also return HTTP 302)`);
  }
}

async function runTokenCommand(args) {
  const stateDir = defaultStateDir(readFlag(args, "--state-dir"));
  const stateFile = path.join(stateDir, "private-access.json");
  const rotate = args.includes("--rotate");
  const keepDevices = args.includes("--keep-devices");
  const show = args.includes("--show") || rotate;
  const publicUrl = readFlag(args, "--url");

  const token = rotate
    ? await rotatePrivateAccessToken(stateFile, {
        keepTrustedDevices: keepDevices,
      })
    : await loadOrCreatePrivateAccessToken(stateFile);

  if (rotate) {
    console.log(`[scope] Rotated private access token in ${stateFile} (0600)`);
    if (keepDevices) {
      console.log("[scope] Existing trusted devices were preserved (--keep-devices).");
    } else {
      console.log("[scope] All previously trusted devices were revoked.");
    }
    console.log("[scope] Restart the private gateway to apply the new master token.");
  } else {
    console.log(`[scope] Private access token file: ${stateFile}`);
  }

  if (show) {
    console.log("");
    console.log(`Token:     ${token}`);
  }
  if (publicUrl) {
    buildLoginUrl(publicUrl, ""); // validate before minting a code
    const { code, expiresAt } = await createLoginCode(stateFile);
    console.log(`Login URL: ${buildLoginUrl(publicUrl, code)}`);
    console.log(`(Single-use, expires ${expiresAt}. It does not contain your master token; opening it registers a Trusted Device cookie.)`);
  }
  if (!show && !publicUrl) {
    console.log("[scope] Token is initialized and stored locally (hidden by default).");
    console.log("[scope] Pass --url https://<your-domain> for a single-use one-tap login URL, or --show to print the token.");
    console.log("[scope] Pass --rotate to generate a fresh token (use --keep-devices to preserve trusted devices).");
  }
}

async function runDevicesCommand(args) {
  const stateDir = defaultStateDir(readFlag(args, "--state-dir"));
  const stateFile = path.join(stateDir, "private-access.json");
  const action = args[0] && !args[0].startsWith("-") ? args[0] : "list";

  if (action === "list") {
    const devices = await listTrustedDevices(stateFile);
    if (!devices.length) {
      console.log(`[scope] No trusted devices stored in ${stateFile}`);
      return;
    }
    console.log(`[scope] Trusted devices (${devices.length}) in ${stateFile}:`);
    for (const dev of devices) {
      console.log(
        `  - ${dev.id}  ${dev.name}  (last active: ${dev.lastSeenAt || "-"}, expires: ${dev.expiresAt || "-"})`,
      );
    }
    return;
  }

  if (action === "revoke") {
    const revokeAll = args.includes("--all");
    const targetId = revokeAll
      ? "*"
      : args
          .slice(1)
          .find((arg, idx, list) => !arg.startsWith("-") && list[idx - 1] !== "--state-dir");
    if (!targetId) {
      console.error("[scope] Usage: scope devices revoke <device-id> | scope devices revoke --all");
      process.exit(1);
    }
    const { removedCount, remainingCount } = await revokeTrustedDevice(
      targetId,
      stateFile,
    );
    if (removedCount === 0) {
      console.log(`[scope] No matching trusted device found (${targetId}).`);
    } else {
      console.log(
        `[scope] Revoked ${removedCount} trusted device(s). Remaining: ${remainingCount}.`,
      );
      console.log("[scope] Running private gateway picks up revocations automatically within ~2 seconds.");
    }
    return;
  }

  console.error(`[scope] Unknown devices action: ${action} (expected list or revoke)`);
  process.exit(1);
}

async function runExposeTailscale(args) {
  const gatewayPort = parsePortFlag(readFlag(args, "--gateway-port"), 4820, "gateway-port");
  const httpsPort = parseHttpsPortFlag(readFlag(args, "--https-port"), 443);
  const dryRun = args.includes("--dry-run");
  const turnOff = args.includes("--off");
  const stateDir = defaultStateDir(readFlag(args, "--state-dir"));
  const stateFile = path.join(stateDir, "private-access.json");

  const serveArgs = turnOff
    ? ["serve", `--https=${httpsPort}`, "off"]
    : ["serve", "--bg", `--https=${httpsPort}`, `http://127.0.0.1:${gatewayPort}`];

  if (dryRun) {
    console.log("[scope] Tailscale Serve dry-run (zero changes applied):");
    console.log(`  1. Start SCOPE + Private Gateway: scope start --gateway --gateway-port ${gatewayPort}`);
    console.log(`  2. Expose privately on your tailnet (NEVER Funnel):`);
    console.log(`     tailscale ${serveArgs.join(" ")}`);
    console.log("  3. Print your one-tap login link:");
    console.log("     scope token --url https://<your-machine>.<tailnet>.ts.net");
    return;
  }

  const tsBin = resolveBinary("tailscale");
  if (!tsBin) {
    console.error("[scope] tailscale CLI was not found on PATH.");
    console.error("        Install Tailscale: https://tailscale.com/download");
    console.error(`        Then re-run: scope expose tailscale --gateway-port ${gatewayPort}`);
    process.exit(1);
  }

  if (turnOff) {
    execFileSync(tsBin, serveArgs, { stdio: "inherit" });
    console.log(`[scope] Disabled Tailscale Serve on HTTPS port ${httpsPort}.`);
    return;
  }

  await loadOrCreatePrivateAccessToken(stateFile);

  let dnsName = "";
  try {
    const statusJson = execFileSync(tsBin, ["status", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(statusJson);
    if (parsed?.BackendState && parsed.BackendState !== "Running") {
      throw new Error(`Tailscale backend state is "${parsed.BackendState}" (run \`tailscale up\` first)`);
    }
    dnsName = String(parsed?.Self?.DNSName || "").replace(/\.$/, "");
  } catch (error) {
    console.error(`[scope] Could not read active Tailscale status: ${error.message}`);
    console.error("        Make sure Tailscale is running and signed in (`tailscale up`).");
    process.exit(1);
  }

  execFileSync(tsBin, serveArgs, { stdio: "inherit" });

  const suffix = httpsPort === 443 ? "" : `:${httpsPort}`;
  const tailnetUrl = dnsName ? `https://${dnsName}${suffix}` : `https://<your-machine>.ts.net${suffix}`;
  const gatewayListening = await checkLoopbackListening(gatewayPort);

  console.log("");
  console.log(`[scope] Tailscale Serve active (private to your tailnet only, Funnel is OFF)`);
  console.log(`  Private URL:    ${tailnetUrl}`);
  console.log(`  Gateway target: http://127.0.0.1:${gatewayPort} (${gatewayListening ? "listening" : "not running yet"})`);
  if (!gatewayListening) {
    console.log(`  Start SCOPE:    scope start --gateway --gateway-port ${gatewayPort}`);
  }
  console.log(`  Get login URL:  scope token --url ${tailnetUrl}`);
  console.log("  Disable later:  scope expose tailscale --off");
}

async function runExposeCloudflare(args) {
  const domain = (readFlag(args, "--domain") || "").trim().toLowerCase();
  const portDomain = (readFlag(args, "--port-domain") || "").trim().toLowerCase();
  const tunnelName = (readFlag(args, "--tunnel") || "scope-hub").trim();
  const gatewayPort = parsePortFlag(readFlag(args, "--gateway-port"), 4820, "gateway-port");
  const dryRun = args.includes("--dry-run");
  const stateDir = defaultStateDir(readFlag(args, "--state-dir"));
  const stateFile = path.join(stateDir, "private-access.json");
  const cloudflaredDir = path.join(os.homedir(), ".cloudflared");
  const configPath = path.resolve(
    readFlag(args, "--config") || path.join(cloudflaredDir, "config.yml"),
  );

  if (!isValidDomain(domain)) {
    console.error("[scope] Missing or invalid --domain (expected a hostname like scope.yourdomain.com).");
    console.error("        Example: scope expose cloudflare --domain scope.yourdomain.com");
    process.exit(1);
  }
  if (!isValidTunnelName(tunnelName)) {
    console.error(`[scope] Invalid --tunnel name: ${tunnelName}`);
    process.exit(1);
  }
  if (portDomain && (!isValidDomain(portDomain) || portDomain === domain)) {
    console.error("[scope] Invalid --port-domain (expected a different hostname such as scope-ports.yourdomain.com).");
    process.exit(1);
  }
  const portOriginFlag = portDomain ? ` --port-origin https://${portDomain}` : "";

  const previewConfig = buildCloudflaredConfig({
    tunnelId: "<TUNNEL_ID>",
    credentialsFile: path.join(cloudflaredDir, "<TUNNEL_ID>.json"),
    domain,
    portDomain,
    gatewayPort,
  });

  if (dryRun) {
    console.log("[scope] Cloudflare Named Tunnel setup plan (dry-run, zero changes applied):");
    console.log("  1. Install cloudflared and authorize your domain once:");
    console.log("     cloudflared tunnel login");
    console.log("  2. Create tunnel and bind DNS record (zero inbound server ports needed):");
    console.log(`     cloudflared tunnel create ${tunnelName}`);
    console.log(`     cloudflared tunnel route dns ${tunnelName} ${domain}`);
    if (portDomain) console.log(`     cloudflared tunnel route dns ${tunnelName} ${portDomain}`);
    console.log(`  3. Write ${configPath} (0600):`);
    for (const line of previewConfig.trimEnd().split("\n")) {
      console.log(`     ${line}`);
    }
    console.log("  4. Start SCOPE + Private Gateway + Tunnel:");
    if (process.platform === "linux") {
      console.log(`     scope service install --with-gateway --with-cloudflared --tunnel ${tunnelName} --gateway-port ${gatewayPort}${portOriginFlag}`);
    } else {
      console.log(`     scope start --gateway --gateway-port ${gatewayPort}${portOriginFlag}`);
      console.log(`     cloudflared tunnel --config "${configPath}" run ${tunnelName}`);
    }
    console.log(`  5. Print a single-use login link:`);
    console.log(`     scope token --url https://${domain}`);
    printCloudflareAccessChecklist(domain, portDomain);
    return;
  }

  const cfBin = resolveBinary("cloudflared");
  if (!cfBin) {
    console.error("[scope] cloudflared was not found on PATH.");
    console.error("        Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
    console.error(`        Or preview the full manual steps with: scope expose cloudflare --domain ${domain} --dry-run`);
    process.exit(1);
  }

  const certPath = path.join(cloudflaredDir, "cert.pem");
  if (!existsSync(certPath)) {
    console.error(`[scope] Cloudflare origin certificate not found at ${certPath}.`);
    console.error("        Run `cloudflared tunnel login` first, select your domain in the browser, then re-run:");
    console.error(`        scope expose cloudflare --domain ${domain} --tunnel ${tunnelName}`);
    process.exit(1);
  }

  await loadOrCreatePrivateAccessToken(stateFile);

  let tunnels = [];
  try {
    const raw = execFileSync(cfBin, ["tunnel", "list", "--output", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    tunnels = JSON.parse(raw || "[]");
  } catch (error) {
    console.error(`[scope] Failed to list Cloudflare tunnels: ${error.message}`);
    process.exit(1);
  }

  let match = tunnels.find((item) => item?.name === tunnelName && !item?.deleted_at);
  if (!match) {
    console.log(`[scope] Creating Cloudflare Named Tunnel "${tunnelName}"...`);
    execFileSync(cfBin, ["tunnel", "create", tunnelName], { stdio: "inherit" });
    const refreshed = execFileSync(cfBin, ["tunnel", "list", "--output", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    tunnels = JSON.parse(refreshed || "[]");
    match = tunnels.find((item) => item?.name === tunnelName && !item?.deleted_at);
  }

  if (!match?.id) {
    console.error(`[scope] Could not resolve tunnel ID for "${tunnelName}".`);
    process.exit(1);
  }

  const credentialsFile = path.resolve(
    readFlag(args, "--credentials") || path.join(cloudflaredDir, `${match.id}.json`),
  );
  if (!existsSync(credentialsFile)) {
    console.error(`[scope] Tunnel credentials file not found: ${credentialsFile}`);
    console.error("        Pass --credentials <path> if stored elsewhere.");
    process.exit(1);
  }

  console.log(`[scope] Routing DNS ${domain} -> tunnel ${tunnelName} (${match.id})...`);
  execFileSync(cfBin, ["tunnel", "route", "dns", "--overwrite-dns", tunnelName, domain], {
    stdio: "inherit",
  });
  if (portDomain) {
    console.log(`[scope] Routing DNS ${portDomain} -> tunnel ${tunnelName} (isolated forwarded ports)...`);
    execFileSync(cfBin, ["tunnel", "route", "dns", "--overwrite-dns", tunnelName, portDomain], {
      stdio: "inherit",
    });
  }

  await mkdir(path.dirname(configPath), { recursive: true });
  if (existsSync(configPath)) {
    const backup = `${configPath}.bak.${Date.now()}`;
    await copyFile(configPath, backup);
    console.log(`[scope] Backed up existing cloudflared config to ${backup}`);
  }
  const yaml = buildCloudflaredConfig({
    tunnelId: match.id,
    credentialsFile,
    domain,
    portDomain,
    gatewayPort,
  });
  await writeFile(configPath, yaml, { mode: 0o600 });
  await chmod(configPath, 0o600).catch(() => {});

  const gatewayListening = await checkLoopbackListening(gatewayPort);
  console.log("");
  console.log(`[scope] Cloudflare Tunnel configured!`);
  console.log(`  Domain:         https://${domain}`);
  if (portDomain) console.log(`  Port domain:    https://${portDomain} (isolated forwarded apps)`);
  console.log(`  Tunnel:         ${tunnelName} (${match.id})`);
  console.log(`  Config file:    ${configPath} (0600)`);
  console.log(`  Gateway target: http://127.0.0.1:${gatewayPort} (${gatewayListening ? "listening" : "not running yet"})`);
  console.log("");
  console.log("[scope] Next steps:");
  if (process.platform === "linux") {
    console.log(`  1. Install persistent systemd services:`);
    console.log(`     scope service install --with-gateway --with-cloudflared --tunnel ${tunnelName} --gateway-port ${gatewayPort}${portOriginFlag}`);
    console.log(`     loginctl enable-linger "$USER"`);
  } else {
    console.log(`  1. Start SCOPE + Private Gateway: scope start --gateway --gateway-port ${gatewayPort}${portOriginFlag}`);
    console.log(`  2. Run tunnel: cloudflared tunnel --config "${configPath}" run ${tunnelName}`);
  }
  console.log(`  3. Print a single-use login link:`);
  console.log(`     scope token --url https://${domain}`);
  printCloudflareAccessChecklist(domain, portDomain);
}

async function runServiceCommand(args) {
  const action = args[0] || "status";
  const rest = args.slice(1);
  const dryRun = rest.includes("--dry-run");
  const withGateway = rest.includes("--with-gateway") || rest.includes("--gateway");
  const withCloudflared = rest.includes("--with-cloudflared");
  const uiPort = parsePortFlag(readFlag(rest, "--port"), 3000, "port");
  const bridgePort = parsePortFlag(readFlag(rest, "--bridge-port"), 4815, "bridge-port");
  const gatewayPort = parsePortFlag(readFlag(rest, "--gateway-port"), 4820, "gateway-port");
  const tunnelName = (readFlag(rest, "--tunnel") || "scope-hub").trim();
  const portOrigin = readFlag(rest, "--port-origin") || "";
  const stateDir = defaultStateDir(readFlag(rest, "--state-dir"));
  const cloudflaredConfig = path.resolve(
    readFlag(rest, "--cloudflared-config") ||
      path.join(os.homedir(), ".cloudflared", "config.yml"),
  );
  const cloudflaredBin = resolveBinary("cloudflared") || "cloudflared";

  const units = renderSystemdUnits({
    stateDir,
    uiPort,
    bridgePort,
    gatewayPort,
    withGateway: withGateway || withCloudflared,
    withCloudflared,
    cloudflaredBin,
    cloudflaredConfig,
    tunnelName,
    portOrigin,
  });

  if (dryRun) {
    console.log("[scope] systemd --user units preview (dry-run, zero files written):");
    for (const unit of units) {
      console.log(`\n--- ${unit.name} ---`);
      console.log(unit.content.trimEnd());
    }
    return;
  }

  if (process.platform !== "linux") {
    console.log(`[scope] \`scope service\` manages Linux systemd --user units (current OS: ${process.platform}).`);
    console.log("        On macOS/Windows, run SCOPE with gateway in one command:");
    console.log(`        scope start --gateway --port ${uiPort} --bridge-port ${bridgePort} --gateway-port ${gatewayPort}`);
    return;
  }

  const unitDir = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "systemd",
    "user",
  );
  const allUnitNames = [
    "scope-workbench.service",
    "scope-private-gateway.service",
    "scope-cloudflared.service",
  ];

  const hasSystemd =
    spawnSync("systemctl", ["--user", "show-environment"], { stdio: "ignore" })
      .status === 0;
  if (!hasSystemd) {
    console.error("[scope] systemd --user bus is not available in this session.");
    console.error("        You can run SCOPE in the background with:");
    console.error(`        nohup scope start --gateway --state-dir "${stateDir}" > "${path.join(stateDir, "scope.log")}" 2>&1 &`);
    process.exit(1);
  }

  if (action === "install") {
    await mkdir(unitDir, { recursive: true });
    for (const unit of units) {
      const target = path.join(unitDir, unit.name);
      await writeFile(target, unit.content, "utf8");
      console.log(`[scope] Wrote ${target}`);
    }
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
    execFileSync(
      "systemctl",
      ["--user", "enable", "--now", ...units.map((u) => u.name)],
      { stdio: "inherit" },
    );
    console.log("");
    console.log(`[scope] Active services: ${units.map((u) => u.name).join(", ")}`);
    console.log(`  Local UI:     http://127.0.0.1:${uiPort}`);
    console.log(`  Local Bridge: http://127.0.0.1:${bridgePort}`);
    if (withGateway || withCloudflared) {
      console.log(`  Gateway:      http://127.0.0.1:${gatewayPort}`);
    }
    console.log(`  Keep alive after SSH logout: loginctl enable-linger "$USER"`);
    return;
  }

  if (action === "status") {
    const installed = allUnitNames.filter((name) =>
      existsSync(path.join(unitDir, name)),
    );
    if (!installed.length) {
      console.log("[scope] No SCOPE systemd --user services installed yet.");
      console.log("        Run: scope service install --with-gateway");
      return;
    }
    spawnSync("systemctl", ["--user", "status", "--no-pager", ...installed], {
      stdio: "inherit",
    });
    return;
  }

  if (action === "restart") {
    const installed = allUnitNames.filter((name) =>
      existsSync(path.join(unitDir, name)),
    );
    if (!installed.length) {
      console.error("[scope] No SCOPE systemd --user services installed yet.");
      process.exit(1);
    }
    execFileSync("systemctl", ["--user", "restart", ...installed], {
      stdio: "inherit",
    });
    console.log(`[scope] Restarted: ${installed.join(", ")}`);
    return;
  }

  if (action === "uninstall") {
    const installed = allUnitNames.filter((name) =>
      existsSync(path.join(unitDir, name)),
    );
    if (installed.length) {
      spawnSync("systemctl", ["--user", "disable", "--now", ...installed], {
        stdio: "inherit",
      });
      for (const name of installed) {
        await rm(path.join(unitDir, name), { force: true });
      }
      execFileSync("systemctl", ["--user", "daemon-reload"], {
        stdio: "inherit",
      });
      console.log(`[scope] Removed services: ${installed.join(", ")}`);
    } else {
      console.log("[scope] No installed SCOPE systemd --user services found.");
    }
    return;
  }

  console.error(`[scope] Unknown service action: ${action} (expected install, status, restart, or uninstall)`);
  process.exit(1);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "token") {
      await runTokenCommand(rest);
      return;
    }
    if (command === "devices") {
      await runDevicesCommand(rest);
      return;
    }
    if (command === "expose") {
      const target = rest[0];
      if (target === "tailscale") {
        await runExposeTailscale(rest.slice(1));
        return;
      }
      if (target === "cloudflare") {
        await runExposeCloudflare(rest.slice(1));
        return;
      }
      console.error("[scope] Usage: scope expose <tailscale|cloudflare> [options]");
      console.error("  scope expose tailscale [--gateway-port 4820] [--https-port 443] [--off] [--dry-run]");
      console.error("  scope expose cloudflare --domain <scope.yourdomain.com> [--port-domain <scope-ports.yourdomain.com>] [--tunnel scope-hub] [--gateway-port 4820] [--dry-run]");
      process.exit(1);
    }
    if (command === "service") {
      await runServiceCommand(rest);
      return;
    }
    console.error(`[scope] Unknown remote-expose command: ${command || "(none)"}`);
    process.exit(1);
  } catch (error) {
    console.error(`[scope] ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
