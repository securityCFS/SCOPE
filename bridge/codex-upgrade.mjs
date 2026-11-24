import { shellQuote } from "./transport/ssh-command.mjs";

// Upgrade installation, then reuse the guarded account-preserving restart.
export function stableVersion(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error("无效的 Codex 稳定版本");
  return value;
}

export function wrapCodexUpgradeCommand(script, preCommand = "") {
  const setup = String(preCommand || "").trim();
  if (!setup) {
    return { command: "python3 -", stdin: script };
  }
  const encoded = Buffer.from(script, "utf8").toString("base64");
  const inner = [
    setup,
    "scope_setup_status=$?",
    'if [ "$scope_setup_status" -ne 0 ]; then exit "$scope_setup_status"; fi',
    `exec python3 -c ${shellQuote(`import base64; exec(compile(base64.b64decode(${JSON.stringify(encoded)}).decode("utf-8"), "<scope-codex-upgrade>", "exec"))`)}`,
  ].join("\n");
  // Interactive bash loads ~/.bashrc aliases/functions; stdin is closed so
  // bash -i never blocks waiting for a terminal.
  return { command: `bash -ic ${shellQuote(inner)} </dev/null`, stdin: "" };
}

export function parseCodexUpgradeOutput(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const marked = lines.findLast((line) => line.startsWith("SCOPE_CODEX_UPGRADE_RESULT="));
  if (marked) return JSON.parse(marked.slice("SCOPE_CODEX_UPGRADE_RESULT=".length));
  const jsonLine = lines.findLast((line) => line.startsWith("{") && line.endsWith("}"));
  return JSON.parse(jsonLine || String(stdout || "").trim());
}

export function remoteCodexUpgradeScript(target = null, knownLatest = null) {
  if (target !== null) stableVersion(target);
  if (knownLatest !== null) stableVersion(knownLatest);
  return [
    "import json, os, re, shutil, subprocess, tempfile, fcntl, signal",
    "from pathlib import Path",
    "def _extend_path():",
    "    extra = [Path.home() / '.local/bin', Path.home() / '.cargo/bin']",
    "    nvm_root = Path.home() / '.nvm/versions/node'",
    "    if nvm_root.is_dir():",
    "        extra.extend(sorted(nvm_root.glob('*/bin'), reverse=True))",
    "    extra.append(Path('/usr/local/bin'))",
    "    current = [p for p in os.environ.get('PATH', '').split(os.pathsep) if p]",
    "    for candidate in reversed(extra):",
    "        text = str(candidate)",
    "        if candidate.is_dir() and text not in current:",
    "            current.insert(0, text)",
    "    os.environ['PATH'] = os.pathsep.join(current)",
    "_extend_path()",
    "target = " + (target === null ? "None" : JSON.stringify(target)),
    "def run(args, timeout=30):",
    "    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)",
    "    try: out, err = p.communicate(timeout=timeout)",
    "    except subprocess.TimeoutExpired:",
    "        os.killpg(p.pid, signal.SIGTERM)",
    "        try: p.communicate(timeout=5)",
    "        except subprocess.TimeoutExpired:",
    "            os.killpg(p.pid, signal.SIGKILL)",
    "            p.communicate()",
    "        raise RuntimeError('Codex 更新命令超时；未重启任何会话，请检查安装状态')",
    "    if p.returncode: raise RuntimeError('命令失败: ' + args[0] + ': ' + (err or out)[-2000:])",
    "    return out.strip()",
    "def version():",
    "    raw = run(['codex', '--version'])",
    "    match = re.fullmatch(r'codex-cli (\\d+\\.\\d+\\.\\d+)', raw)",
    "    if not match: raise RuntimeError('不是可识别的稳定版 Codex: ' + raw)",
    "    return match.group(1)",
    "installed = version()",
    "latest = " + (knownLatest === null
      ? "json.loads(run(['npm', 'view', '@openai/codex', 'version', '--json', '--registry=https://registry.npmjs.org', '--fetch-timeout=15000', '--fetch-retries=1'], 45)) if target is None else target"
      : JSON.stringify(knownLatest)),
    "if not re.fullmatch(r'\\d+\\.\\d+\\.\\d+', latest): raise RuntimeError('注册表未返回稳定版本')",
    "root = Path(run(['npm', 'root', '-g'])).resolve()",
    "package = root / '@openai' / 'codex'",
    "codex_bin = shutil.which('codex')",
    "if not codex_bin: raise RuntimeError('PATH 中未找到 codex 可执行文件')",
    "executable = Path(codex_bin).resolve()",
    "supported = package.is_dir() and (executable == package / 'bin' / 'codex.js' or package in executable.parents)",
    "backup = None",
    "if target is not None:",
    "    if not supported: raise RuntimeError('当前 Codex 不是 npm 全局安装，拒绝覆盖；请按原安装渠道更新')",
    "    with open(root / '.scope-codex-upgrade.lock', 'a') as lock:",
    "        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)",
    "        except BlockingIOError: raise RuntimeError('远端已有安装任务，请等待后检查版本')",
    "        installed = version()",
    "        if tuple(map(int, installed.split('.'))) > tuple(map(int, target.split('.'))): raise RuntimeError('拒绝降级 Codex；请重新检查版本')",
    "        if installed != target:",
    "            backup = tempfile.mkdtemp(prefix='scope-codex-' + installed + '-', dir=str(root))",
    "            shutil.copytree(package, Path(backup) / 'codex', symlinks=True)",
    "            run(['npm', 'install', '-g', '@openai/codex@' + target, '--registry=https://registry.npmjs.org', '--fetch-timeout=60000', '--fetch-retries=1', '--no-audit', '--no-fund'], 240)",
    "            installed = version()",
    "            if installed != target: raise RuntimeError('安装后 PATH 版本不匹配，未切换会话')",
    "print('SCOPE_CODEX_UPGRADE_RESULT=' + json.dumps(dict(installed=installed, latest=latest, executable=str(executable), supported=supported, backup=backup)))",
  ].join("\n") + "\n";
}

export class CodexUpgrades {
  constructor({ inspect, install, restart, running }) {
    Object.assign(this, { inspect, install, restart, running });
    this.jobs = new Map();
  }
  view(host) {
    const job = this.jobs.get(host);
    if (!job) return null;
    const { done, ...view } = job;
    return { ...view, runningVersions: this.running(host) };
  }
  start(host, action) {
    if (!["check", "upgrade"].includes(action)) throw new Error("未知更新操作");
    const previous = this.jobs.get(host);
    if (previous?.status === "running") return previous;
    const job = { host, action, status: "running", phase: "checking", info: previous?.info || null, error: null, results: [], startedAt: new Date().toISOString() };
    this.jobs.set(host, job);
    job.done = this.run(job);
    return job;
  }
  async run(job) {
    try {
      const checked = await this.inspect(job.host);
      job.info = { ...checked, backup: checked.backup || job.info?.backup };
      const target = stableVersion(job.info.latest);
      if (job.action === "check") { job.status = "completed"; return; }
      if (!job.info.supported) throw new Error("仅支持 npm 全局安装；未修改该主机");
      job.phase = "installing";
      const installed = await this.install(job.host, target);
      job.info = { ...installed, backup: installed.backup || job.info.backup };
      if (installed.installed !== target) throw new Error("安装版本验证失败，未切换会话");
      job.phase = "switching";
      const restart = await this.restart(job.host);
      job.results = restart.results || [];
      if (restart.status !== "completed") {
        job.status = "pending-switch";
        job.error = restart.error || "部分会话未恢复，请查看逐会话结果后重试";
        return;
      }
      if (this.running(job.host).some((r) => r.version !== target || r.status !== "connected")) {
        job.status = "pending-switch";
        job.error = "安装已完成，但部分托管连接尚未验证为目标版本";
        return;
      }
      job.status = "completed";
    } catch (error) {
      job.status = job.phase === "switching" ? "pending-switch" : "failed";
      job.error = error.message;
    } finally { job.finishedAt = new Date().toISOString(); }
  }
}
