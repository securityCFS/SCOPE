param(
  [int]$GatewayPort = 4820
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$StateFile = Join-Path $RepoRoot ".scope\private-access.json"
$UrlFile = Join-Path $RepoRoot ".scope\private-access-url.txt"

function Test-LocalHttp {
  param(
    [string]$Uri,
    [int[]]$AcceptedStatus = @(200)
  )
  try {
    $StatusCode = (Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2).StatusCode
    return $AcceptedStatus -contains $StatusCode
  } catch {
    if ($_.Exception.Response) {
      return $AcceptedStatus -contains [int]$_.Exception.Response.StatusCode
    }
    return $false
  }
}

$TailscaleCommand = Get-Command "tailscale.exe" -ErrorAction SilentlyContinue
if (-not $TailscaleCommand) {
  $Candidate = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path -LiteralPath $Candidate) {
    $TailscaleCommand = Get-Item -LiteralPath $Candidate
  }
}
if (-not $TailscaleCommand) {
  throw "Tailscale is not installed. Install it on this PC and phone, sign both into your private tailnet, then rerun this script."
}

$TailscaleExe = $TailscaleCommand.Source
if (-not $TailscaleExe) {
  $TailscaleExe = $TailscaleCommand.FullName
}

$Status = (& $TailscaleExe status --json | ConvertFrom-Json)
if (-not $Status.Self.Online) {
  throw "Tailscale is installed but this PC is not online. Sign in first, then rerun this script."
}

$UiReady = Test-LocalHttp -Uri "http://127.0.0.1:3000/"
$BridgeReady = Test-LocalHttp -Uri "http://127.0.0.1:4815/api/snapshot"
if (-not $UiReady -and -not $BridgeReady) {
  $NpmCommand = Get-Command "npm.cmd"
  Start-Process `
    -FilePath $NpmCommand.Source `
    -ArgumentList @("run", "scope") `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden
  for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
    Start-Sleep -Milliseconds 750
    $UiReady = Test-LocalHttp -Uri "http://127.0.0.1:3000/"
    $BridgeReady = Test-LocalHttp -Uri "http://127.0.0.1:4815/api/snapshot"
    if ($UiReady -and $BridgeReady) {
      break
    }
  }
}
if (-not $UiReady -or -not $BridgeReady) {
  throw "The Monitor UI and Bridge are not both healthy. Run 'npm run scope' and resolve any port conflict first."
}

$GatewayReady = Test-LocalHttp `
  -Uri "http://127.0.0.1:$GatewayPort/" `
  -AcceptedStatus @(401)
if (-not $GatewayReady) {
  Start-Process `
    -FilePath (Get-Command node.exe).Source `
    -ArgumentList @("bridge/private-start.mjs") `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden
  for ($Attempt = 0; $Attempt -lt 10; $Attempt++) {
    Start-Sleep -Milliseconds 500
    $GatewayReady = Test-LocalHttp `
      -Uri "http://127.0.0.1:$GatewayPort/" `
      -AcceptedStatus @(401)
    if ($GatewayReady) {
      break
    }
  }
}
if (-not $GatewayReady) {
  throw "The private gateway did not become healthy on 127.0.0.1:$GatewayPort."
}

& $TailscaleExe serve --bg "http://127.0.0.1:$GatewayPort"
if ($LASTEXITCODE -ne 0) {
  throw "tailscale serve failed with exit code $LASTEXITCODE"
}

$Status = (& $TailscaleExe status --json | ConvertFrom-Json)
$DnsName = [string]$Status.Self.DNSName
if (-not $DnsName) {
  throw "Tailscale did not report a MagicDNS name."
}
$DnsName = $DnsName.TrimEnd(".")
$PrivateState = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
$BootstrapUrl = "https://$DnsName/?token=$($PrivateState.token)"
Set-Content -LiteralPath $UrlFile -Value $BootstrapUrl -Encoding utf8

Write-Host "SCOPE is available inside your tailnet at https://$DnsName/"
Write-Host "The one-time bootstrap URL was written to $UrlFile"
Write-Host "Open that file locally and send the URL to your phone through a private channel."
