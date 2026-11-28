param(
  [Parameter(Mandatory = $true)]
  [string]$Domain,
  [string]$PortDomain = "",
  [string]$ShareDomain = "",
  [string]$Tunnel = "scope-hub",
  [int]$UiPort = 3000,
  [int]$BridgePort = 4815,
  [int]$GatewayPort = 4820,
  [string]$StateDir = (Join-Path $HOME ".scope"),
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Write-Host "[scope] SCOPE One-Click Remote Setup (Cloudflare Custom Domain: $Domain)"

if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
  throw "Node.js >= 22.13 is required. Install from https://nodejs.org/ and rerun."
}
if (-not (Get-Command "cloudflared" -ErrorAction SilentlyContinue)) {
  throw "cloudflared was not found on PATH. Install with: winget install Cloudflare.cloudflared"
}

$ScopeCmd = Get-Command "scope" -ErrorAction SilentlyContinue
if (-not $ScopeCmd) {
  if ($DryRun) {
    Write-Host "  [dry-run] npm install -g @godchaser/scope"
  } else {
    Write-Host "[scope] Installing @godchaser/scope globally..."
    npm install -g @godchaser/scope
    if ($LASTEXITCODE -ne 0) { throw "Failed to install @godchaser/scope" }
  }
}

$ExposeArgs = @("expose", "cloudflare", "--domain", $Domain, "--tunnel", $Tunnel, "--gateway-port", "$GatewayPort", "--state-dir", $StateDir)
if ($PortDomain) {
  $ExposeArgs += @("--port-domain", $PortDomain)
}
if ($ShareDomain) {
  $ExposeArgs += @("--share-domain", $ShareDomain)
}
if ($DryRun) {
  $ExposeArgs += "--dry-run"
  & scope @ExposeArgs
  exit $LASTEXITCODE
}

& scope @ExposeArgs
if ($LASTEXITCODE -ne 0) { throw "scope expose cloudflare failed" }

function Test-LocalStatus {
  param([string]$Uri, [int[]]$Allowed = @(200, 401))
  try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
    return $Allowed -contains [int]$res.StatusCode
  } catch {
    if ($_.Exception.Response) {
      return $Allowed -contains [int]$_.Exception.Response.StatusCode
    }
    return $false
  }
}

if (-not (Test-LocalStatus -Uri "http://127.0.0.1:$GatewayPort/" -Allowed @(401, 200))) {
  Write-Host "[scope] Starting SCOPE + Private Gateway on 127.0.0.1..."
  if ($PortDomain) {
    $env:SCOPE_PORT_ORIGIN = "https://$PortDomain"
  }
  if ($ShareDomain) {
    $env:SCOPE_SHARE_ORIGIN = "https://$ShareDomain"
  }
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/c", "scope", "start", "--gateway", "--port", "$UiPort", "--bridge-port", "$BridgePort", "--gateway-port", "$GatewayPort", "--state-dir", $StateDir) `
    -WindowStyle Hidden
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 750
    if (Test-LocalStatus -Uri "http://127.0.0.1:$GatewayPort/" -Allowed @(401, 200)) { break }
  }
}

$ConfigPath = Join-Path $HOME ".cloudflared\config.yml"
Write-Host "[scope] Starting Cloudflare Tunnel ($Tunnel) in background..."
Start-Process -FilePath (Get-Command "cloudflared").Source `
  -ArgumentList @("tunnel", "--no-autoupdate", "--config", $ConfigPath, "run", $Tunnel) `
  -WindowStyle Hidden

Write-Host ""
Write-Host "[scope] Generating a single-use 10-minute login link for https://${Domain}:"
& scope token --url "https://$Domain" --state-dir $StateDir
Write-Host ""
Write-Host "[scope] Recommended: Enable Cloudflare Zero Trust Access (Emails-only Include policy, Session Duration: 1 month)."
