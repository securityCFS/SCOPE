import { readFile } from "node:fs/promises";
import { LOCAL_HOST } from "../../lib/execution-host.js";

const REMOTE_EMAIL_TOOL_PATH = new URL(
  "../../scripts/remote-email-tool.py",
  import.meta.url,
);

const DEFAULT_REMOTE_PORT = 4922;

function validPort(value) {
  const port = Number(value || DEFAULT_REMOTE_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("远端端口必须在 1024 到 65535 之间");
  }
  return port;
}

function buildInspectScript() {
  return String.raw`
import json, os, pwd, shutil, subprocess
from pathlib import Path

def _extend_path():
    extra = [Path.home() / ".local" / "bin", Path.home() / ".cargo" / "bin"]
    nvm_root = Path.home() / ".nvm" / "versions" / "node"
    if nvm_root.is_dir():
        extra.extend(sorted(nvm_root.glob("*/bin"), reverse=True))
    extra.append(Path("/usr/local/bin"))
    current = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p]
    for candidate in reversed(extra):
        text = str(candidate)
        if candidate.is_dir() and text not in current:
            current.insert(0, text)
    os.environ["PATH"] = os.pathsep.join(current)

_extend_path()

def which_cmd(name):
    found = shutil.which(name)
    if found:
        return found
    nvm_candidates = sorted((Path.home() / ".nvm" / "versions" / "node").glob(f"*/bin/{name}"), reverse=True)
    for candidate in (Path.home() / ".local" / "bin" / name, Path.home() / ".cargo" / "bin" / name, *nvm_candidates, Path("/usr/local/bin") / name):
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None

def run(args, timeout=8):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "").strip(), (r.stderr or "").strip()
    except Exception as exc:
        return 1, "", str(exc)

def cli_info(name):
    exe = which_cmd(name)
    if not exe:
        return {"installed": False, "executable": None, "version": None}
    code, out, err = run([exe, "--version"], timeout=10)
    return {
        "installed": True,
        "executable": exe,
        "version": (out or err).splitlines()[0][:120] if (out or err) else None,
    }

home = Path.home()
user = os.environ.get("USER") or pwd.getpwuid(os.getuid()).pw_name
path_entries = [os.path.realpath(p) for p in os.environ.get("PATH", "").split(os.pathsep) if p]
local_bin = os.path.realpath(str(home / ".local" / "bin"))
local_bin_in_path = local_bin in path_entries

py_ver = run(["python3", "--version"])
node_exe = which_cmd("node")
node_ver = run([node_exe, "--version"])[1] if node_exe else None
npm_exe = which_cmd("npm")
tmux_exe = which_cmd("tmux")
gpu_code, gpu_out, _ = run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], timeout=5)
gpu_count = len([line for line in gpu_out.splitlines() if line.strip()]) if gpu_code == 0 else 0

systemd_code, _, _ = run(["systemctl", "--user", "show-environment"], timeout=5)
systemd_user_available = systemd_code == 0
systemd_service_active = False
if systemd_user_available:
    sc, sout, _ = run(["systemctl", "--user", "is-active", "scope-notify.service"], timeout=5)
    systemd_service_active = sc == 0 and sout.strip() == "active"

notify_exe = which_cmd("scope-notify")
notify_status = None
if notify_exe:
    nc, nout, _ = run([notify_exe, "status"], timeout=6)
    if nc == 0 and nout:
        try:
            notify_status = json.loads(nout)
        except Exception:
            notify_status = None

lock_active = False
lock_file = home / ".local" / "state" / "scope-email" / "service.lock"
if lock_file.exists():
    import fcntl
    try:
        with lock_file.open("r", encoding="utf-8") as fh:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
    except BlockingIOError:
        lock_active = True
    except Exception:
        pass

codex_exe = which_cmd("codex")
claude_exe = which_cmd("claude")
codex_mcp = False
claude_mcp = False
if codex_exe:
    codex_mcp = run([codex_exe, "mcp", "get", "scope-email"], timeout=8)[0] == 0
if claude_exe:
    claude_mcp = run([claude_exe, "mcp", "get", "scope-email"], timeout=8)[0] == 0

report = {
    "user": user,
    "isRoot": os.geteuid() == 0,
    "home": str(home),
    "python3": py_ver[1] if py_ver[0] == 0 else None,
    "node": node_ver,
    "npm": bool(npm_exe),
    "tmux": bool(tmux_exe),
    "gpuCount": gpu_count,
    "localBinInPath": local_bin_in_path,
    "systemdUserAvailable": systemd_user_available,
    "clis": {
        "codex": cli_info("codex"),
        "claude": cli_info("claude"),
        "antigravity": cli_info("agy"),
        "dsh": cli_info("dsh"),
    },
    "scopeNotify": {
        "installed": bool(notify_exe and (home / ".config" / "scope-email" / "config.json").exists()),
        "executable": notify_exe,
        "daemonActive": systemd_service_active or lock_active,
        "systemdServiceActive": systemd_service_active,
        "relayReachable": bool(notify_status and notify_status.get("relayReachable")),
        "queued": int(notify_status.get("queued", 0)) if notify_status else 0,
        "lastDeliveredAt": notify_status.get("lastDeliveredAt") if notify_status else None,
        "codexMcp": codex_mcp,
        "claudeMcp": claude_mcp,
    },
}
print("SCOPE_BOOTSTRAP_REPORT=" + json.dumps(report, ensure_ascii=False))
`;
}

const COMPLETION_BLOCK = [
  "<!-- SCOPE_COMPLETION_EMAIL_BEGIN -->",
  "## Completion email notifications",
  "",
  "For long-running or unattended work, use the `send_completion_email` MCP tool exactly once when the task completes, fails, or needs the operator's attention. Do not email routine progress updates or ordinary chat replies. Include a concise result and the experiment or session identifier when available. If MCP is unavailable, run `~/.local/bin/scope-notify send --status completed|failed|needs_attention --title ... --summary ...`.",
  "<!-- SCOPE_COMPLETION_EMAIL_END -->",
].join("\n");

function buildDeployScript({ toolSourceBase64, remotePort, token, registerMcp }) {
  const configJson = JSON.stringify({
    endpoint: `http://127.0.0.1:${remotePort}/v1/notify`,
    token,
  });
  return String.raw`
import base64, json, os, shutil, subprocess, sys
from pathlib import Path

TOOL_B64 = ${JSON.stringify(toolSourceBase64)}
CONFIG = json.loads(${JSON.stringify(configJson)})
BLOCK = json.loads(${JSON.stringify(JSON.stringify(COMPLETION_BLOCK))})
REGISTER_MCP = ${registerMcp ? "True" : "False"}

home = Path.home()
share_dir = home / ".local" / "share" / "scope-email"
bin_dir = home / ".local" / "bin"
config_dir = home / ".config" / "scope-email"
state_dir = home / ".local" / "state" / "scope-email"
outbox_dir = state_dir / "outbox"
for directory in (share_dir, bin_dir, config_dir, state_dir, outbox_dir):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)

tool_path = share_dir / "scope_notify.py"
tool_bytes = base64.b64decode(TOOL_B64).replace(b"\r\n", b"\n")
tool_path.write_bytes(tool_bytes)
os.chmod(tool_path, 0o755)

bin_link = bin_dir / "scope-notify"
if bin_link.exists() or bin_link.is_symlink():
    bin_link.unlink()
bin_link.symlink_to(tool_path)

if os.geteuid() == 0 and os.access("/usr/local/bin", os.W_OK):
    sys_link = Path("/usr/local/bin/scope-notify")
    try:
        if sys_link.exists() or sys_link.is_symlink():
            sys_link.unlink()
        sys_link.symlink_to(tool_path)
    except Exception:
        pass

config_path = config_dir / "config.json"
fd = os.open(config_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as fh:
    json.dump(CONFIG, fh, indent=2)
    fh.write("\n")
os.chmod(config_path, 0o600)

BEGIN = "<!-- SCOPE_COMPLETION_EMAIL_BEGIN -->"
END = "<!-- SCOPE_COMPLETION_EMAIL_END -->"

targets = [home / ".codex" / "AGENTS.md", home / ".claude" / "CLAUDE.md"]
profiles_dir = home / ".codex" / "scope-auth-profiles"
if profiles_dir.is_dir():
    for profile_home in profiles_dir.glob("*/home"):
        if (profile_home / "config.toml").exists():
            targets.append(profile_home / "AGENTS.md")

for filename in targets:
    filename.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    current = filename.read_text(encoding="utf-8") if filename.exists() else ""
    if BEGIN in current and END in current:
        prefix, remainder = current.split(BEGIN, 1)
        _, suffix = remainder.split(END, 1)
        updated = prefix.rstrip() + "\n\n" + BLOCK + suffix
    else:
        updated = (current.rstrip() + "\n\n" + BLOCK + "\n") if current.strip() else (BLOCK + "\n")
    filename.write_text(updated, encoding="utf-8")

def which_cmd(name):
    found = shutil.which(name)
    if found:
        return found
    for candidate in (bin_dir / name, Path("/usr/local/bin") / name):
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None

def run(args, timeout=15):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)

if REGISTER_MCP:
    codex_exe = which_cmd("codex")
    if codex_exe:
        run([codex_exe, "mcp", "remove", "scope-email"])
        run([codex_exe, "mcp", "add", "scope-email", "--", str(bin_link), "mcp"])
    claude_exe = which_cmd("claude")
    if claude_exe:
        run([claude_exe, "mcp", "remove", "--scope", "user", "scope-email"])
        run([claude_exe, "mcp", "add", "--scope", "user", "--transport", "stdio", "scope-email", "--", str(bin_link), "mcp"])

systemd_ok = run(["systemctl", "--user", "show-environment"], timeout=5).returncode == 0
daemon_mode = "nohup"
if systemd_ok:
    unit_dir = home / ".config" / "systemd" / "user"
    unit_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    unit_path = unit_dir / "scope-notify.service"
    unit_path.write_text(
        "[Unit]\nDescription=SCOPE Completion Email Retry Daemon\nAfter=network.target\n\n"
        "[Service]\nType=simple\n"
        f"ExecStart={sys.executable} {tool_path} service\n"
        "Restart=on-failure\nRestartSec=5\n\n"
        "[Install]\nWantedBy=default.target\n",
        encoding="utf-8",
    )
    run(["systemctl", "--user", "daemon-reload"], timeout=10)
    res = run(["systemctl", "--user", "enable", "--now", "scope-notify.service"], timeout=10)
    if res.returncode == 0:
        daemon_mode = "systemd-user"
if daemon_mode != "systemd-user":
    log_path = state_dir / "service.log"
    with log_path.open("a", encoding="utf-8") as log_file:
        subprocess.Popen(
            [sys.executable, str(tool_path), "service"],
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=log_file,
            start_new_session=True,
            close_fds=True,
        )

status_res = run([str(bin_link), "status"], timeout=8)
print("SCOPE_DEPLOY_OK=" + json.dumps({"daemonMode": daemon_mode, "statusCode": status_res.returncode, "statusRaw": status_res.stdout.strip()}))
`;
}

function buildRemoveScript() {
  return String.raw`
import json, os, shutil, subprocess
from pathlib import Path

home = Path.home()
def run(args, timeout=10):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    except Exception:
        return None

if run(["systemctl", "--user", "show-environment"], timeout=5):
    run(["systemctl", "--user", "disable", "--now", "scope-notify.service"], timeout=10)
unit_path = home / ".config" / "systemd" / "user" / "scope-notify.service"
if unit_path.exists():
    unit_path.unlink()
    run(["systemctl", "--user", "daemon-reload"], timeout=8)

for cmd_args in (["codex", "mcp", "remove", "scope-email"], ["claude", "mcp", "remove", "--scope", "user", "scope-email"]):
    exe = shutil.which(cmd_args[0]) or (str(home / ".local" / "bin" / cmd_args[0]) if (home / ".local" / "bin" / cmd_args[0]).exists() else None)
    if exe:
        run([exe, *cmd_args[1:]], timeout=10)

BEGIN = "<!-- SCOPE_COMPLETION_EMAIL_BEGIN -->"
END = "<!-- SCOPE_COMPLETION_EMAIL_END -->"
targets = [home / ".codex" / "AGENTS.md", home / ".claude" / "CLAUDE.md"]
profiles_dir = home / ".codex" / "scope-auth-profiles"
if profiles_dir.is_dir():
    for profile_home in profiles_dir.glob("*/home"):
        targets.append(profile_home / "AGENTS.md")
for filename in targets:
    if filename.exists():
        text = filename.read_text(encoding="utf-8")
        if BEGIN in text and END in text:
            prefix, remainder = text.split(BEGIN, 1)
            _, suffix = remainder.split(END, 1)
            cleaned = (prefix.rstrip() + "\n" + suffix.lstrip()).strip()
            filename.write_text((cleaned + "\n") if cleaned else "", encoding="utf-8")

for target in (
    home / ".config" / "scope-email" / "config.json",
    home / ".local" / "bin" / "scope-notify",
    Path("/usr/local/bin/scope-notify"),
):
    try:
        if target.exists() or target.is_symlink():
            target.unlink()
    except Exception:
        pass

print("SCOPE_REMOVE_OK=" + json.dumps({"removed": True}))
`;
}

export class RemoteBootstrapService {
  constructor({
    run,
    getHost,
    tunnels,
    readRemoteTool = () => readFile(REMOTE_EMAIL_TOOL_PATH, "utf8"),
  }) {
    this.run = run;
    this.getHost = getHost;
    this.tunnels = tunnels;
    this.readRemoteTool = readRemoteTool;
    this.cache = new Map();
  }

  #requireRemoteHost(host) {
    if (!host || host === LOCAL_HOST) {
      throw new Error("请选择远端 SSH 主机");
    }
    const candidate = this.getHost(host);
    if (!candidate) throw new Error("找不到对应 SSH 主机");
    if (!candidate.reachable) throw new Error("主机当前离线");
    return candidate;
  }

  state(host) {
    const cached = host ? this.cache.get(host) || null : null;
    return {
      host: host || null,
      report: cached?.report || null,
      checkedAt: cached?.checkedAt || null,
      lastAction: cached?.lastAction || null,
      tunnel: host ? this.tunnels.hostStatus(host) : null,
      relay: this.tunnels.status(host),
    };
  }

  async inspect(host) {
    this.#requireRemoteHost(host);
    const result = await this.run(host, "python3 -", buildInspectScript(), 45_000, 1_000_000);
    if (result.code !== 0) {
      throw new Error(
        (result.stderr || result.stdout || "远端环境检查失败").trim().slice(-800),
      );
    }
    const line = result.stdout
      .split(/\r?\n/)
      .findLast((item) => item.startsWith("SCOPE_BOOTSTRAP_REPORT="));
    if (!line) {
      throw new Error("未收到远端环境检查结果（请确认远端已安装 Python 3）");
    }
    const report = JSON.parse(line.slice("SCOPE_BOOTSTRAP_REPORT=".length));
    this.cache.set(host, {
      report,
      checkedAt: new Date().toISOString(),
      lastAction: "inspect",
    });
    return this.state(host);
  }

  async deploy(host, { remotePort = DEFAULT_REMOTE_PORT, registerMcp = true } = {}) {
    this.#requireRemoteHost(host);
    const port = validPort(remotePort);
    const relay = await this.tunnels.enable(host, port);
    const toolSource = await this.readRemoteTool();
    const script = buildDeployScript({
      toolSourceBase64: Buffer.from(toolSource, "utf8").toString("base64"),
      remotePort: port,
      token: relay.token,
      registerMcp,
    });
    const result = await this.run(host, "python3 -", script, 60_000, 1_000_000);
    if (result.code !== 0) {
      throw new Error(
        (result.stderr || result.stdout || "远端部署失败").trim().slice(-1_000),
      );
    }
    // Wait briefly for reverse SSH port forwarding to bind before final inspection.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const refreshed = await this.inspect(host);
    this.cache.set(host, {
      ...this.cache.get(host),
      lastAction: "deploy",
    });
    return { ...refreshed, lastAction: "deploy" };
  }

  async remove(host) {
    this.#requireRemoteHost(host);
    const result = await this.run(host, "python3 -", buildRemoveScript(), 45_000, 1_000_000);
    if (result.code !== 0) {
      throw new Error(
        (result.stderr || result.stdout || "远端卸载失败").trim().slice(-800),
      );
    }
    await this.tunnels.disable(host);
    const refreshed = await this.inspect(host);
    this.cache.set(host, {
      ...this.cache.get(host),
      lastAction: "remove",
    });
    return { ...refreshed, lastAction: "remove" };
  }
}
