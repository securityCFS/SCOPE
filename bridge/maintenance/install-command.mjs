import { shellQuote } from "../transport/ssh-command.mjs";

export const AGENT_PACKAGES = {
  codex: "@openai/codex",
  claude: "@anthropic-ai/claude-code",
  dsh: "@deepseek-ai/dsh",
};

export const MAINTAINED_PROVIDERS = ["codex", "claude", "antigravity", "dsh"];

/** Fixed vendor channels; user input only selects an agent and optional pre-launch command. */
export function installCommand(provider, action, settings = {}) {
  if (
    !MAINTAINED_PROVIDERS.includes(provider) ||
    !["check", "install", "update"].includes(action)
  )
    throw new Error("未知安装操作");
  if (provider === "antigravity" && action !== "check") {
    throw new Error("Antigravity CLI 请使用官方安装包或本地渠道安装与更新");
  }
  const config = JSON.stringify({
    provider,
    action,
    package: AGENT_PACKAGES[provider] || null,
    executable: settings.executable || (provider === "antigravity" ? "agy" : provider),
  });
  const script = String.raw`
import json, os, re, shutil, subprocess, tempfile, fcntl
from pathlib import Path
config = json.loads(${JSON.stringify(config)})
provider, action, package = config['provider'], config['action'], config['package']
def extend_path():
    extra = [Path.home() / '.local/bin', Path.home() / '.cargo/bin']
    nvm_root = Path.home() / '.nvm/versions/node'
    if nvm_root.is_dir():
        extra.extend(sorted(nvm_root.glob('*/bin'), reverse=True))
    extra.append(Path('/usr/local/bin'))
    current = [p for p in os.environ.get('PATH', '').split(os.pathsep) if p]
    for candidate in reversed(extra):
        text = str(candidate)
        if candidate.is_dir() and text not in current:
            current.insert(0, text)
    os.environ['PATH'] = os.pathsep.join(current)
extend_path()
def run(args, timeout=60):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode: raise RuntimeError((result.stderr or result.stdout)[-3000:])
    return result.stdout.strip()
def emit(info):
    print('SCOPE_INSTALL_RESULT=' + json.dumps(info), flush=True)
state = Path.home() / '.local/state/scope/install-locks'
state.mkdir(parents=True, exist_ok=True)
with open(state / (provider + '.lock'), 'a') as lock:
    try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: raise RuntimeError('此 Agent 已有安装任务，请等待完成')
    executable = shutil.which(config['executable'])
    raw_exe = Path(executable) if executable else None
    resolved = raw_exe.resolve() if raw_exe else None
    installed = None
    if executable:
        try:
            ver_out = run([executable, '--version'], 20)
            installed = (ver_out.splitlines()[0] if ver_out else '').strip()[:120] or None
        except Exception:
            if action != 'check':
                raise
            installed = 'installed'
    if provider == 'antigravity':
        emit(dict(installed=installed, latest=None, executable=executable, supported=False, channel='native' if executable else 'not-installed'))
        raise SystemExit(0)
    npm = shutil.which('npm')
    root = None
    if npm:
        try: root = Path(run([npm, 'root', '-g'], 20)).resolve()
        except Exception: root = None
    package_root = root / package if (root and package) else None
    npm_owned = bool(resolved and package_root and package_root in resolved.parents)
    native_claude = bool(provider == 'claude' and executable and (
        raw_exe == Path.home() / '.local/bin/claude'
        or '.claude' in str(resolved or '')
        or (resolved and (Path.home() / '.local/share/claude') in resolved.parents)
    ))
    supported = (not executable and (provider == 'claude' or bool(npm))) or npm_owned or native_claude
    latest = None
    latest_error = None
    if package:
        if npm:
            try:
                raw_latest = run([npm, 'view', package, 'version', '--json', '--fetch-timeout=15000', '--fetch-retries=1'], 25)
                candidate_latest = json.loads(raw_latest)
                if isinstance(candidate_latest, str) and re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', candidate_latest):
                    latest = candidate_latest
            except Exception as exc:
                latest = None
                latest_error = str(exc).splitlines()[-1][:200] if str(exc).strip() else 'npm view failed'
        if not latest:
            try:
                import urllib.request
                req = urllib.request.Request(f'https://registry.npmjs.org/{package.replace("/", "%2F")}/latest', headers={'Accept': 'application/json'})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    payload = json.loads(resp.read().decode('utf-8', 'replace'))
                candidate_latest = payload.get('version') if isinstance(payload, dict) else None
                if isinstance(candidate_latest, str) and re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?', candidate_latest):
                    latest = candidate_latest
                    latest_error = None
            except Exception as exc:
                if not latest_error:
                    latest_error = str(exc).splitlines()[-1][:200] if str(exc).strip() else 'registry check failed'
    info = dict(installed=installed, latest=latest, latestError=latest_error, executable=executable, supported=supported, channel='npm' if npm_owned else 'native' if native_claude else 'not-installed' if not executable else 'external')
    if action != 'check':
        if not supported: raise RuntimeError('现有安装由其他渠道管理，或缺少 npm；请按原渠道配置，未覆盖安装')
        if action == 'install' and executable: raise RuntimeError('已经安装，请使用更新')
        if action == 'update' and not executable: raise RuntimeError('尚未安装，请先安装')
        current_version = re.search(r'(\d+)\.(\d+)\.(\d+)', installed or '')
        if latest and current_version and tuple(map(int, current_version.groups())) > tuple(map(int, latest.split('-')[0].split('.'))): raise RuntimeError('已安装版本高于当前发布版本，拒绝降级；请检查安装渠道')
        print('正在安装' if action == 'install' else '正在更新', provider, f'({package}@{latest or "latest"})' if package else '', '— 下载安装包可能需要 30–120 秒，请稍候…', flush=True)
        if provider == 'claude' and not executable:
            with tempfile.TemporaryDirectory(prefix='scope-claude-install-') as temporary:
                installer = str(Path(temporary) / 'install.sh')
                run(['curl', '-fsSL', '--connect-timeout', '15', '--max-time', '120', 'https://claude.ai/install.sh', '-o', installer], 130)
                run(['bash', installer], 600)
            executable = str(Path.home() / '.local/bin/claude')
        elif native_claude:
            out = run([executable, 'update'], 600)
            if out:
                print(out[-1000:], flush=True)
        else:
            target = latest or 'latest'
            out = run([npm, 'install', '-g', package + '@' + target, '--fetch-timeout=60000', '--fetch-retries=1', '--no-audit', '--no-fund'], 600)
            if out:
                print(out[-1000:], flush=True)
            executable = shutil.which(config['executable'])
        if not executable: raise RuntimeError('安装完成但 PATH 中找不到命令，请检查 npm prefix 和 PATH')
        new_ver_out = run([executable, '--version'], 30)
        info.update(installed=(new_ver_out.splitlines()[0] if new_ver_out else '').strip()[:120] or new_ver_out, executable=executable, latestError=None)
        if latest and provider != 'claude' and not re.search(r'(?<![\d.])' + re.escape(latest) + r'(?![\d.])', info['installed']): raise RuntimeError('PATH 中的版本与安装目标不一致，请检查路径优先级')
    emit(info)
`;
  const bootstrap = (settings.updatePreCommand || settings.preLaunchCommand || "").trim();
  return `${bootstrap ? `${bootstrap}\nscope_setup_status=$?\nif [ "$scope_setup_status" -ne 0 ]; then exit "$scope_setup_status"; fi\n` : ""}exec python3 -c ${shellQuote(script)}`;
}
