import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeAccountQuota } from "../lib/account-quota.js";
import { LOCAL_HOST } from "../lib/execution-host.js";
import { JsonlAppServerConnection } from "./app-server-client.mjs";
import { runLocalPython } from "./local/python-probe.mjs";

const QUOTA_CACHE_TTL_MS = 45_000;

export const PROVIDER_AUTH_PROBE_PY = `
import base64, concurrent.futures, datetime, glob, json, os, pathlib, re, shutil, subprocess, sys, time, urllib.error, urllib.request

cfg = json.loads(base64.urlsafe_b64decode(sys.argv[1] + "=="))
home = pathlib.Path.home()

def find_exe(preferred):
    if preferred and (os.path.sep in preferred or "/" in preferred):
        if os.path.isfile(preferred) and os.access(preferred, os.X_OK):
            return preferred
    hit = shutil.which(preferred) if preferred else None
    if hit:
        return hit
    candidates = [
        home / ".local/bin" / preferred,
        home / ".npm-global/bin" / preferred,
        pathlib.Path("/usr/local/bin") / preferred,
        pathlib.Path("/opt/homebrew/bin") / preferred,
    ]
    for node_bin in sorted(glob.glob(str(home / ".nvm/versions/node/*/bin")), reverse=True):
        candidates.append(pathlib.Path(node_bin) / preferred)
    for c in candidates:
        if c.is_file():
            return str(c)
    return ""

def parse_json_object(raw):
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except ValueError:
        pass
    decoder = json.JSONDecoder()
    idx = 0
    best = None
    while True:
        pos = raw.find("{", idx)
        if pos < 0:
            break
        try:
            obj, _ = decoder.raw_decode(raw, pos)
            if isinstance(obj, dict):
                if any(k in obj for k in ("loggedIn", "email", "authMethod", "command")):
                    return obj
                best = obj
        except ValueError:
            pass
        idx = pos + 1
    return best

def parse_iso_epoch(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        return int(dt.timestamp())
    except Exception:
        return None

def read_claude_oauth():
    cred_path = home / ".claude/.credentials.json"
    if cred_path.is_file():
        try:
            data = json.loads(cred_path.read_text(encoding="utf-8", errors="replace"))
            oauth = data.get("claudeAiOauth") if isinstance(data, dict) else None
            if isinstance(oauth, dict) and oauth.get("accessToken"):
                return oauth
        except Exception:
            pass
    if sys.platform == "darwin":
        try:
            proc = subprocess.run(
                ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=4,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                data = json.loads(proc.stdout.strip())
                oauth = data.get("claudeAiOauth") if isinstance(data, dict) else None
                if isinstance(oauth, dict) and oauth.get("accessToken"):
                    return oauth
        except Exception:
            pass
    return None

def probe_claude_quota(out):
    oauth = read_claude_oauth()
    if not isinstance(oauth, dict):
        return
    token = str(oauth.get("accessToken") or "").strip()
    if not token:
        return
    expires = oauth.get("expiresAt")
    if isinstance(expires, (int, float)) and expires > 0:
        exp_ms = expires if expires > 1e12 else expires * 1000
        if exp_ms < time.time() * 1000:
            out["quotaError"] = "Claude OAuth 令牌已过期，请刷新登录或发起一次对话"
            return
    if not out.get("subscriptionType") and oauth.get("subscriptionType"):
        out["subscriptionType"] = str(oauth.get("subscriptionType"))[:80]
    if not out.get("planTier") and oauth.get("rateLimitTier"):
        out["planTier"] = str(oauth.get("rateLimitTier")).replace("default_claude_", "")[:80]
    test_url = os.environ.get("SCOPE_TEST_CLAUDE_USAGE_URL", "").strip()
    url = test_url if test_url.startswith("http://127.0.0.1:") else "https://api.anthropic.com/api/oauth/usage"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "anthropic-beta": "oauth-2025-04-20",
            "Accept": "application/json",
            "User-Agent": "claude-code",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            body = json.loads(resp.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as err:
        if err.code in (401, 403):
            out["quotaError"] = "Claude OAuth 令牌已失效或无权限，请重新登录"
        elif err.code == 429:
            out["quotaError"] = "Claude 用量接口触发限流，请稍后再试"
        else:
            out["quotaError"] = f"Claude 用量接口返回 HTTP {err.code}"
        return
    except Exception:
        out["quotaError"] = "无法连接 Anthropic 用量接口（请检查主机代理或网络配置）"
        return
    if not isinstance(body, dict):
        return
    def make_win(raw, mins):
        if not isinstance(raw, dict):
            return None
        util = raw.get("utilization")
        if util is None:
            return None
        try:
            used = max(0, min(100, round(float(util))))
        except (TypeError, ValueError):
            return None
        return {
            "usedPercent": used,
            "windowDurationMins": mins,
            "resetsAt": parse_iso_epoch(raw.get("resets_at")),
        }
    primary = make_win(body.get("five_hour"), 300)
    secondary = make_win(body.get("seven_day"), 10080)
    groups = []
    for key, label in (("seven_day_sonnet", "Sonnet"), ("seven_day_opus", "Opus")):
        sub_win = make_win(body.get(key), 10080)
        if sub_win:
            groups.append({"name": label, "primary": None, "secondary": sub_win})
    credits = None
    extra = body.get("extra_usage")
    if isinstance(extra, dict) and extra.get("is_enabled"):
        used_c = extra.get("used_credits")
        limit_c = extra.get("monthly_limit")
        currency = str(extra.get("currency") or "USD").upper()
        bal = None
        if isinstance(used_c, (int, float)) and isinstance(limit_c, (int, float)) and limit_c > 0:
            rem_c = max(0.0, float(limit_c) - float(used_c))
            bal = f"{rem_c:.2f} / {float(limit_c):.2f} {currency}"
        elif isinstance(used_c, (int, float)):
            bal = f"已用 {float(used_c):.2f} {currency}"
        credits = {
            "hasCredits": True,
            "unlimited": limit_c is None,
            "balance": bal,
        }
    if primary or secondary or credits or groups:
        quota = {
            "planType": out.get("planTier") or out.get("subscriptionType") or None,
            "primary": primary,
            "secondary": secondary,
            "credits": credits,
        }
        if groups:
            quota["groups"] = [
                {"name": "全部模型", "primary": primary, "secondary": secondary},
                *groups,
            ]
        out["quota"] = quota

def probe_claude(exe_name):
    exe = find_exe(exe_name or "claude")
    out = {
        "installed": bool(exe),
        "executable": exe,
        "loggedIn": False,
        "email": "",
        "authMethod": "",
        "subscriptionType": "",
        "planTier": "",
        "orgName": "",
        "loginExpiresAt": "",
        "quota": None,
        "quotaError": None,
        "error": None,
    }
    if exe:
        try:
            proc = subprocess.run(
                [exe, "auth", "status"],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=8,
            )
            data = (
                parse_json_object((proc.stdout or "").strip())
                or parse_json_object((proc.stderr or "").strip())
            )
            if isinstance(data, dict) and any(
                k in data for k in ("loggedIn", "email", "authMethod")
            ):
                method = str(data.get("authMethod") or "")[:80]
                if method.lower() == "none":
                    method = ""
                out.update({
                    "loggedIn": bool(data.get("loggedIn")),
                    "email": str(data.get("email") or "")[:320],
                    "authMethod": method,
                    "subscriptionType": str(data.get("subscriptionType") or "")[:80],
                    "planTier": str(data.get("planTier") or "")[:80],
                    "orgName": str(data.get("orgName") or "")[:160],
                    "loginExpiresAt": str(data.get("loginExpiresAt") or "")[:80],
                    "error": None,
                })
                if out["loggedIn"]:
                    probe_claude_quota(out)
                return out
        except Exception as err:
            out["error"] = str(err)[:200]
    try:
        claude_cfg = json.loads((home / ".claude.json").read_text(encoding="utf-8"))
        acct = claude_cfg.get("oauthAccount") if isinstance(claude_cfg, dict) else None
        if isinstance(acct, dict) and (acct.get("emailAddress") or acct.get("accountUuid")):
            out["loggedIn"] = True
            out["email"] = str(acct.get("emailAddress") or "")[:320]
            out["orgName"] = str(acct.get("organizationName") or "")[:160]
            out["authMethod"] = "claude.ai"
            out["error"] = None
            probe_claude_quota(out)
    except Exception:
        pass
    return out

def parse_agy_usage_text(raw_text):
    groups_map = {}
    order = []
    for line in (raw_text or "").splitlines():
        parts = [p.strip() for p in line.split("\\t")]
        if len(parts) < 3:
            continue
        gname, metric, pct_str = parts[0], parts[1].lower(), parts[2]
        m = re.search(r"(\\d+(?:\\.\\d+)?)%", pct_str)
        if not gname or not m:
            continue
        rem = max(0, min(100, round(float(m.group(1)))))
        used = max(0, min(100, 100 - rem))
        resets_at = parse_iso_epoch(parts[3]) if len(parts) >= 4 else None
        if gname not in groups_map:
            groups_map[gname] = {"name": gname[:120], "primary": None, "secondary": None}
            order.append(gname)
        if "five" in metric or "5h" in metric or "5-hour" in metric:
            groups_map[gname]["primary"] = {
                "usedPercent": used,
                "windowDurationMins": 300,
                "resetsAt": resets_at,
            }
        elif "week" in metric or "7d" in metric:
            groups_map[gname]["secondary"] = {
                "usedPercent": used,
                "windowDurationMins": 10080,
                "resetsAt": resets_at,
            }
    return [groups_map[k] for k in order if groups_map[k]["primary"] or groups_map[k]["secondary"]]

def probe_agy_quota(exe, out, extra_env=None):
    try:
        proc = subprocess.run(
            [exe, "-p", "/usage", "--output-format", "json"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=15,
            env=extra_env,
        )
    except subprocess.TimeoutExpired:
        out["quotaError"] = "查询 Antigravity /usage 超时（请检查主机网络或代理配置）"
        return
    except Exception as err:
        out["quotaError"] = f"执行 agy /usage 失败：{str(err)[:140]}"
        return
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    parsed = parse_json_object(stdout)
    groups = []
    if isinstance(parsed, dict):
        cmd_data = (parsed.get("command") or {}).get("data") if isinstance(parsed.get("command"), dict) else None
        raw_groups = cmd_data.get("groups") if isinstance(cmd_data, dict) else None
        if isinstance(raw_groups, list):
            for grp in raw_groups:
                if not isinstance(grp, dict):
                    continue
                gname = str(grp.get("name") or "").strip()[:120]
                if not gname:
                    continue
                gdesc = str(grp.get("description") or "").strip()[:240]
                g_primary = None
                g_secondary = None
                for bucket in grp.get("buckets") or []:
                    if not isinstance(bucket, dict):
                        continue
                    rem_frac = bucket.get("remaining_fraction")
                    if not isinstance(rem_frac, (int, float)):
                        continue
                    rem_pct = max(0, min(100, round(float(rem_frac) * 100)))
                    used_pct = max(0, min(100, 100 - rem_pct))
                    win_kind = str(bucket.get("window") or "").lower()
                    bid = str(bucket.get("id") or "").lower()
                    bname = str(bucket.get("name") or "").lower()
                    resets_at = parse_iso_epoch(bucket.get("reset_time"))
                    if win_kind == "5h" or "5h" in bid or "five hour" in bname:
                        g_primary = {
                            "usedPercent": used_pct,
                            "windowDurationMins": 300,
                            "resetsAt": resets_at,
                        }
                    elif win_kind == "weekly" or "weekly" in bid or "week" in bname:
                        g_secondary = {
                            "usedPercent": used_pct,
                            "windowDurationMins": 10080,
                            "resetsAt": resets_at,
                        }
                if g_primary or g_secondary:
                    item = {"name": gname, "primary": g_primary, "secondary": g_secondary}
                    if gdesc:
                        item["description"] = gdesc
                    groups.append(item)
        if not groups and isinstance(parsed.get("response"), str):
            groups = parse_agy_usage_text(parsed.get("response"))
    if not groups and stdout:
        groups = parse_agy_usage_text(stdout)
    if not groups:
        if proc.returncode != 0:
            err_line = (stderr.splitlines()[-1] if stderr else f"退出码 {proc.returncode}")[:160]
            out["quotaError"] = f"查询 Antigravity 额度失败：{err_line}"
        else:
            out["quotaError"] = "当前 Antigravity CLI 未返回额度分组数据"
        return
    default_model = str(out.get("defaultModel") or "").lower()
    chosen = groups[0]
    if any(tok in default_model for tok in ("claude", "gpt")):
        for grp in groups:
            if any(tok in grp["name"].lower() for tok in ("claude", "gpt")):
                chosen = grp
                break
    out["quota"] = {
        "planType": None,
        "primary": chosen.get("primary"),
        "secondary": chosen.get("secondary"),
        "credits": {"hasCredits": True, "unlimited": False, "balance": "G1 Credits 已启用"} if out.get("useG1Credits") else None,
        "groups": groups,
    }

def _probe_agy_dir(exe, agy_dir, extra_env=None, profile_name=""):
    out = {
        "installed": bool(exe),
        "executable": exe,
        "loggedIn": False,
        "email": "",
        "authMethod": "",
        "defaultModel": "",
        "useG1Credits": False,
        "quota": None,
        "quotaError": None,
        "error": None,
    }
    if profile_name:
        out["profile"] = profile_name
    tok_path = agy_dir / "antigravity-oauth-token"
    if tok_path.is_file():
        try:
            tok = json.loads(tok_path.read_text(encoding="utf-8", errors="replace"))
            if isinstance(tok, dict):
                has_tok = isinstance(tok.get("token"), str) and bool(tok.get("token").strip())
                email = str(tok.get("id_token_email") or tok.get("email") or "")[:320]
                out["loggedIn"] = bool(has_tok or email)
                out["email"] = email
                out["authMethod"] = str(tok.get("auth_method") or "")[:80]
        except Exception as err:
            out["error"] = str(err)[:200]
    cfg_path = agy_dir / "settings.json"
    if cfg_path.is_file():
        try:
            scfg = json.loads(cfg_path.read_text(encoding="utf-8", errors="replace"))
            if isinstance(scfg, dict):
                out["defaultModel"] = str(scfg.get("model") or "")[:120]
                out["useG1Credits"] = bool(scfg.get("useG1Credits"))
        except Exception:
            pass
    if exe and out["loggedIn"]:
        probe_agy_quota(exe, out, extra_env=extra_env)
    return out

def probe_agy(exe_name):
    exe = find_exe(exe_name or "agy")
    agy_dir = home / ".gemini/antigravity-cli"
    out = _probe_agy_dir(exe, agy_dir)
    profiles = []
    profiles_dir = home / ".agy-profiles"
    if profiles_dir.is_dir():
        candidates = []
        try:
            for child in sorted(profiles_dir.iterdir(), key=lambda p: p.name):
                if not child.is_dir() or child.name.startswith("."):
                    continue
                if not re.fullmatch(r"[a-zA-Z0-9._-]{1,64}", child.name):
                    continue
                p_agy = child / ".gemini/antigravity-cli"
                if p_agy.is_dir():
                    candidates.append((child.name, child, p_agy))
        except OSError:
            candidates = []
        if candidates:
            def run_profile(item):
                pname, phome, pagy = item
                penv = dict(os.environ)
                for k in ("DBUS_SESSION_BUS_ADDRESS", "ANTIGRAVITY_APP_DATA_DIR", "ANTIGRAVITY_AGENTAPI_EXE", "ANTIGRAVITY_SOURCE_METADATA"):
                    penv.pop(k, None)
                penv["HOME"] = str(phome)
                penv["XDG_CONFIG_HOME"] = str(phome / ".config")
                penv["XDG_CACHE_HOME"] = str(phome / ".cache")
                penv["AGY_PROFILE"] = pname
                return _probe_agy_dir(exe, pagy, extra_env=penv, profile_name=pname)
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, len(candidates))) as ppool:
                profiles = list(ppool.map(run_profile, candidates))
    if profiles:
        out["profiles"] = profiles
    return out

wanted = cfg.get("providers") or ["claude", "antigravity"]
results = {}
tasks = {}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    if "claude" in wanted:
        tasks["claude"] = pool.submit(probe_claude, cfg.get("claudeExe") or "claude")
    if "antigravity" in wanted:
        tasks["antigravity"] = pool.submit(probe_agy, cfg.get("agyExe") or "agy")
    for key, fut in tasks.items():
        results[key] = fut.result()

print(json.dumps(results, ensure_ascii=False))
`.trim();

function decodeJwtClaims(token) {
  if (typeof token !== "string") return {};
  const parts = token.split(".");
  if (parts.length < 2) return {};
  try {
    const segment = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

export async function readLocalAuthProfiles({ localCodex }) {
  const authPath = path.join(os.homedir(), ".codex", "auth.json");
  let currentAccount = null;
  let defaultAuthPresent = false;
  try {
    const data = JSON.parse(await readFile(authPath, "utf8"));
    defaultAuthPresent = Boolean(data && typeof data === "object");
    const tokens = data?.tokens && typeof data.tokens === "object" ? data.tokens : {};
    const claims =
      [tokens.id_token, data?.id_token, tokens.access_token]
        .map(decodeJwtClaims)
        .find((item) => item && Object.keys(item).length > 0) || {};
    const authClaims =
      claims["https://api.openai.com/auth"] &&
      typeof claims["https://api.openai.com/auth"] === "object"
        ? claims["https://api.openai.com/auth"]
        : {};
    const email = String(claims.email || authClaims.email || "").slice(0, 320);
    const planType = String(
      authClaims.chatgpt_plan_type ||
        claims.chatgpt_plan_type ||
        claims.plan_type ||
        "unknown",
    ).slice(0, 80);
    const mode = String(data?.auth_mode || "chatgpt").toLowerCase();
    const type = mode.includes("api") && !mode.includes("chatgpt") ? "apiKey" : "chatgpt";
    currentAccount = { type, email, planType };
  } catch {
    defaultAuthPresent = false;
  }
  const localHost = localCodex.host();
  return {
    host: LOCAL_HOST,
    local: true,
    profiles: [],
    defaultAuthPresent,
    activeProfile: null,
    currentAccount,
    runningSessions: (localHost?.agents || []).filter(
      (agent) => agent.rollout?.id && !agent.rollout.isSubagent,
    ).length,
    restartJob: null,
    automaticFailover: null,
  };
}

export function createAccountQuotaService({
  appServerManager,
  localCodex,
  listAuthProfiles,
  hostCodexExecutable,
  hostRuntimeConfig,
  wrapBootstrapAppServer,
  shellQuote,
  mapLimit,
  sshTimeoutMs,
  getSnapshot,
  runSshCommand = null,
  providerSettings = null,
  localPython = runLocalPython,
}) {
  const cache = new Map();
  const inflight = new Map();

  function getCached(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.fetchedAt > QUOTA_CACHE_TTL_MS) return null;
    return hit.value;
  }

  function setCached(key, value) {
    cache.set(key, { fetchedAt: Date.now(), value });
    return value;
  }

  async function runCoalesced(key, force, worker) {
    if (!force) {
      const hit = getCached(key);
      if (hit) return hit;
    }
    if (inflight.has(key)) return inflight.get(key);
    const job = Promise.resolve()
      .then(worker)
      .then((value) => setCached(key, value))
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  async function probeViaChild(host, connectionKey, child) {
    const connection = new JsonlAppServerConnection({
      host: `${host}:${connectionKey}:quota`,
      child,
      requestTimeoutMs: 15_000,
    });
    try {
      await connection.start();
      const [accountRes, rateLimitRes] = await Promise.all([
        connection.request("account/read", { refreshToken: false }).catch(() => null),
        connection.request("account/rateLimits/read", {}).catch(() => null),
      ]);
      return {
        account: accountRes?.account || null,
        quota: normalizeAccountQuota(rateLimitRes?.rateLimits || rateLimitRes),
        error: null,
      };
    } finally {
      connection.close();
      try {
        child.kill?.();
      } catch {
        /* ignore */
      }
    }
  }

  function spawnRemoteQuotaProbe(hostAlias, slug = "") {
    const hostEntry = getSnapshot().hosts.find((item) => item.alias === hostAlias);
    const executable = hostCodexExecutable(hostEntry);
    const runtime = hostRuntimeConfig(hostAlias);
    const envLines = slug
      ? [
          `export CODEX_HOME="$HOME/.codex/scope-auth-profiles/${slug}/home"`,
          `scope_quota_exe=$(command -v codex 2>/dev/null || printf '%s' ${shellQuote(executable)})`,
          `exec "$scope_quota_exe" -c cli_auth_credentials_store=file app-server --listen stdio://`,
        ]
      : [
          `scope_quota_exe=$(command -v codex 2>/dev/null || printf '%s' ${shellQuote(executable)})`,
          `exec "$scope_quota_exe" app-server --listen stdio://`,
        ];
    const remoteScript = wrapBootstrapAppServer(
      envLines.join("; "),
      runtime.preLaunchCommand,
    );
    return spawn(
      typeof process !== "undefined" && process.platform === "win32" ? "ssh.exe" : "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        `ConnectTimeout=${Math.ceil(sshTimeoutMs / 1000)}`,
        "--",
        hostAlias,
        remoteScript,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
  }

  async function readSingleQuota(
    hostAlias,
    { connectionKey = "active", force = false } = {},
  ) {
    const normalizedKey = connectionKey || "active";
    return runCoalesced(`${hostAlias}:single:${normalizedKey}`, force, async () => {
      const publicState = appServerManager.publicState();
      const liveConn = publicState.connections.find(
        (conn) =>
          conn.host === hostAlias &&
          (conn.connectionKey || "active") === normalizedKey &&
          conn.status === "connected",
      );
      if (liveConn) {
        if (!force && liveConn.rateLimits) {
          return {
            host: hostAlias,
            connectionKey: normalizedKey,
            quota: liveConn.rateLimits,
            source: "app-server",
            error: null,
          };
        }
        try {
          const hostEntry = getSnapshot().hosts.find((item) => item.alias === hostAlias);
          const quota = await appServerManager.getRateLimits(
            hostAlias,
            hostCodexExecutable(hostEntry),
            normalizedKey,
          );
          return {
            host: hostAlias,
            connectionKey: normalizedKey,
            quota,
            source: "app-server",
            error: null,
          };
        } catch (error) {
          return {
            host: hostAlias,
            connectionKey: normalizedKey,
            quota: null,
            source: "app-server",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      try {
        if (hostAlias === LOCAL_HOST) {
          const probed = await probeViaChild(
            hostAlias,
            normalizedKey,
            localCodex.probe(),
          );
          return {
            host: hostAlias,
            connectionKey: normalizedKey,
            quota: probed.quota,
            account: probed.account,
            source: "probe",
            error: null,
          };
        }
        const slug = normalizedKey.startsWith("profile:")
          ? normalizedKey.slice("profile:".length)
          : "";
        if (slug && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(slug)) {
          throw new Error("Profile 标识无效");
        }
        const probed = await probeViaChild(
          hostAlias,
          normalizedKey,
          spawnRemoteQuotaProbe(hostAlias, slug),
        );
        return {
          host: hostAlias,
          connectionKey: normalizedKey,
          quota: probed.quota,
          account: probed.account,
          source: "probe",
          error: null,
        };
      } catch (error) {
        return {
          host: hostAlias,
          connectionKey: normalizedKey,
          quota: null,
          source: "probe",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  async function readHostQuotas(hostAlias, { force = false } = {}) {
    return runCoalesced(`${hostAlias}:all`, force, async () => {
      if (hostAlias === LOCAL_HOST) {
        const [localAuth, single] = await Promise.all([
          readLocalAuthProfiles({ localCodex }),
          readSingleQuota(LOCAL_HOST, { connectionKey: "active", force }),
        ]);
        return {
          host: LOCAL_HOST,
          local: true,
          fetchedAt: new Date().toISOString(),
          currentAccount: single.account || localAuth.currentAccount,
          currentQuota: single.quota,
          profileQuotas: {},
          error: single.error,
        };
      }

      const profiles = await listAuthProfiles(hostAlias);
      const currentSingle = profiles.defaultAuthPresent
        ? await readSingleQuota(hostAlias, { connectionKey: "active", force })
        : { quota: null, account: null, error: null };

      const readyProfiles = (profiles.profiles || []).filter((p) => p.ready);
      const profileEntries = await mapLimit(readyProfiles, 3, async (profile) => {
        if (profile.active && currentSingle.quota) {
          return [profile.slug, { quota: currentSingle.quota, error: null }];
        }
        const res = await readSingleQuota(hostAlias, {
          connectionKey: `profile:${profile.slug}`,
          force,
        });
        return [profile.slug, { quota: res.quota, error: res.error }];
      });

      return {
        host: hostAlias,
        local: false,
        fetchedAt: new Date().toISOString(),
        currentAccount: profiles.currentAccount || currentSingle.account || null,
        currentQuota: currentSingle.quota,
        profileQuotas: Object.fromEntries(profileEntries),
        error: currentSingle.error,
      };
    });
  }

  function normalizeProviderEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const profiles = Array.isArray(entry.profiles)
      ? entry.profiles.map((item) => normalizeProviderEntry(item)).filter(Boolean)
      : undefined;
    return {
      ...entry,
      quota: entry.quota ? normalizeAccountQuota(entry.quota) : null,
      quotaError: entry.quotaError ? String(entry.quotaError) : null,
      ...(profiles ? { profiles } : {}),
    };
  }

  async function runProviderProbe(hostAlias, payload, preLaunch = "") {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const raw =
      hostAlias === LOCAL_HOST
        ? await localPython(PROVIDER_AUTH_PROBE_PY, [encoded], 25_000, 512_000)
        : await (async () => {
            if (!runSshCommand) {
              throw new Error("未配置远端 SSH 探测通道");
            }
            const trimmedPre = String(preLaunch || "").trim();
            const remoteCmd = trimmedPre
              ? wrapBootstrapAppServer(
                  `exec python3 - ${shellQuote(encoded)}`,
                  `{ ${trimmedPre}; } >&2 || exit $?`,
                )
              : `python3 - ${shellQuote(encoded)}`;
            return runSshCommand(
              hostAlias,
              remoteCmd,
              PROVIDER_AUTH_PROBE_PY,
              25_000,
              512_000,
            );
          })();
    if (raw.code !== 0) {
      throw new Error(raw.stderr || "探测 Agent 登录与额度状态失败");
    }
    const line = String(raw.stdout || "")
      .trim()
      .split(/\r?\n/)
      .findLast((item) => item.trim().startsWith("{"));
    if (!line) {
      throw new Error("未返回有效 Agent 登录与额度状态");
    }
    return JSON.parse(line);
  }

  async function readProviderAuthStatuses(hostAlias, { force = false } = {}) {
    return runCoalesced(`${hostAlias}:providers`, force, async () => {
      const claudeCfg = providerSettings?.("claude", hostAlias) || {};
      const agyCfg = providerSettings?.("antigravity", hostAlias) || {};
      const claudeExe = claudeCfg.executable || "claude";
      const agyExe = agyCfg.executable || "agy";
      const hostPre =
        hostAlias === LOCAL_HOST
          ? ""
          : String(hostRuntimeConfig?.(hostAlias)?.preLaunchCommand || "").trim();
      const claudePre =
        hostAlias === LOCAL_HOST
          ? ""
          : String(claudeCfg.preLaunchCommand || "").trim() || hostPre;
      const agyPre =
        hostAlias === LOCAL_HOST
          ? ""
          : String(agyCfg.preLaunchCommand || "").trim() || hostPre;

      let claudeRaw = null;
      let agyRaw = null;
      if (hostAlias === LOCAL_HOST || claudePre === agyPre) {
        const parsed = await runProviderProbe(
          hostAlias,
          { claudeExe, agyExe, providers: ["claude", "antigravity"] },
          claudePre,
        );
        claudeRaw = parsed.claude || null;
        agyRaw = parsed.antigravity || null;
      } else {
        const [claudeRes, agyRes] = await Promise.all([
          runProviderProbe(
            hostAlias,
            { claudeExe, providers: ["claude"] },
            claudePre,
          ).catch((err) => ({
            claude: {
              installed: false,
              executable: "",
              loggedIn: false,
              email: "",
              authMethod: "",
              subscriptionType: "",
              planTier: "",
              orgName: "",
              loginExpiresAt: "",
              quota: null,
              quotaError: null,
              error: err instanceof Error ? err.message : String(err),
            },
          })),
          runProviderProbe(
            hostAlias,
            { agyExe, providers: ["antigravity"] },
            agyPre,
          ).catch((err) => ({
            antigravity: {
              installed: false,
              executable: "",
              loggedIn: false,
              email: "",
              authMethod: "",
              defaultModel: "",
              useG1Credits: false,
              quota: null,
              quotaError: null,
              error: err instanceof Error ? err.message : String(err),
            },
          })),
        ]);
        claudeRaw = claudeRes?.claude || null;
        agyRaw = agyRes?.antigravity || null;
      }
      return {
        host: hostAlias,
        local: hostAlias === LOCAL_HOST,
        fetchedAt: new Date().toISOString(),
        claude: normalizeProviderEntry(claudeRaw),
        antigravity: normalizeProviderEntry(agyRaw),
      };
    });
  }

  return {
    readSingleQuota,
    readHostQuotas,
    readProviderAuthStatuses,
  };
}
