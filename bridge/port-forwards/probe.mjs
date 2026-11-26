const IGNORED_PORTS = new Set([22, 53, 4922]);

const IGNORED_PROC_PATTERNS = [
  /^sshd$/i,
  /^systemd-/i,
  /^cupsd$/i,
  /^rpcbind$/i,
  /^avahi-/i,
  /^chronyd$/i,
  /^ntpd$/i,
  /^dnsmasq$/i,
  /^tailscaled$/i,
  /^containerd/i,
  /^dbus-daemon$/i,
  /^code-[0-9a-f]+$/i,
  /^agy$/i,
  /^codex$/i,
  /^clash/i,
  /^mihomo$/i,
  /^v2ray$/i,
  /^xray$/i,
  /^sing-box$/i,
  /^privoxy$/i,
  /^tinyproxy$/i,
  /^qq$/i,
];

const INTERNAL_CMD_PATTERNS = [
  /\bipykernel_launcher\b/i,
  /\bdebugpy\b/i,
  /\bpylsp\b/i,
  /\bpyright\b/i,
  /\btypescript-language-server\b/i,
  /\bapp-server\b/i,
  /\bvscode-server\b/i,
  /\bantigravity\b/i,
];

const KNOWN_DEV_PROC_PATTERN =
  /(?:python|node|vite|next|nuxt|webpack|esbuild|jupyter|tensorboard|gradio|streamlit|viser|uvicorn|gunicorn|flask|django|ray|mlflow|vllm|sglang|ollama|docker-proxy|nginx|caddy|httpd|ruby|rails|go|cargo|php|java|deno|bun|http-server|serve)/i;

export function detectServiceLabel(procName = "", cmdline = "", port = 0) {
  const hay = `${procName} ${cmdline}`.toLowerCase();
  if (/\btensorboard\b/.test(hay) || port === 6006) return "TensorBoard";
  if (/\bjupyter(?:-lab|-notebook|hub)?\b/.test(hay) || port === 8888) {
    return "Jupyter";
  }
  if (/\bgradio\b/.test(hay) || port === 7860) return "Gradio";
  if (/\bstreamlit\b/.test(hay) || port === 8501) return "Streamlit";
  if (/\bviser\b/.test(hay)) return "Viser";
  if (/\brerun\b/.test(hay)) return "Rerun";
  if (/\bmlflow\b/.test(hay) || port === 5000 && /mlflow/.test(hay)) {
    return "MLflow";
  }
  if (/\bray\b/.test(hay) && (port === 8265 || /dashboard/.test(hay))) {
    return "Ray Dashboard";
  }
  if (/\bvllm\b/.test(hay)) return "vLLM";
  if (/\bsglang\b/.test(hay)) return "SGLang";
  if (/\bollama\b/.test(hay) || port === 11434) return "Ollama";
  if (/\bvite\b/.test(hay) || port === 5173) return "Vite";
  if (/\bnext(?:-server|\s+dev|\s+start)\b/.test(hay)) return "Next.js";
  if (/\buvicorn\b/.test(hay) || /\bfastapi\b/.test(hay)) return "FastAPI";
  if (/\bgunicorn\b/.test(hay)) return "Gunicorn";
  if (/\bflask\b/.test(hay)) return "Flask";
  if (/\bhttp\.server\b/.test(hay)) return "Python HTTP";
  if (/\bwandb\b/.test(hay)) return "W&B";
  if (/\bcaddy\b/.test(hay)) return "Caddy";
  if (/\bnginx\b/.test(hay)) return "Nginx";
  if (/\bdocker-proxy\b/.test(hay)) return "Docker";
  if (/^python/i.test(procName)) return "Python";
  if (/^node/i.test(procName)) return "Node.js";
  return procName || `Port ${port}`;
}

function normalizePosix(value) {
  if (!value || typeof value !== "string") return "";
  const cleaned = value.trim().replace(/\/+$/, "");
  return cleaned || "/";
}

function cwdMatchesProject(procCwd, sessionCwd) {
  const p = normalizePosix(procCwd);
  const s = normalizePosix(sessionCwd);
  if (!p || !s || s === "/") return false;
  return p === s || p.startsWith(`${s}/`);
}

export function shouldIncludeDiscoveredPort({
  port,
  procName = "",
  cmdline = "",
  inProject = false,
}) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return false;
  if (IGNORED_PORTS.has(port)) return false;
  if (IGNORED_PROC_PATTERNS.some((re) => re.test(procName))) return false;
  if (INTERNAL_CMD_PATTERNS.some((re) => re.test(cmdline))) return false;
  // High ephemeral ports are noisy unless clearly a dev/research server or in current project.
  if (port >= 32_768) {
    return inProject || KNOWN_DEV_PROC_PATTERN.test(`${procName} ${cmdline}`);
  }
  // Low privileged ports (< 1024) other than standard HTTP/HTTPS are usually OS daemons.
  if (port < 1024 && port !== 80 && port !== 443) return false;
  return true;
}

export function filterDiscoveredPorts(rawEntries = [], { cwd = "" } = {}) {
  const byPort = new Map();
  for (const item of rawEntries) {
    const port = Number(item?.port);
    const procName = String(item?.procName || "").trim();
    const cmdline = String(item?.cmdline || "").trim();
    const procCwd = String(item?.cwd || "").trim();
    const bind = String(item?.bind || "").trim();
    const pid = Number.isInteger(Number(item?.pid)) && Number(item.pid) > 0
      ? Number(item.pid)
      : null;
    const inProject = cwdMatchesProject(procCwd, cwd);
    if (!shouldIncludeDiscoveredPort({ port, procName, cmdline, inProject })) {
      continue;
    }
    const label = detectServiceLabel(procName, cmdline, port);
    const existing = byPort.get(port);
    const candidate = {
      port,
      bind: bind || "127.0.0.1",
      pid,
      procName,
      label,
      cmdline: cmdline.slice(0, 200),
      cwd: procCwd,
      inProject,
    };
    if (
      !existing ||
      (candidate.inProject && !existing.inProject) ||
      (!existing.procName && candidate.procName)
    ) {
      byPort.set(port, candidate);
    }
  }
  return [...byPort.values()].sort((a, b) => {
    if (a.inProject !== b.inProject) return a.inProject ? -1 : 1;
    return a.port - b.port;
  });
}

export function buildRemotePortProbeScript() {
  return `
import json, os, re, subprocess

def read_proc(pid):
    cmdline = ""
    cwd = ""
    comm = ""
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmdline = f.read().replace(b"\\x00", b" ").decode("utf-8", "replace").strip()
    except Exception:
        pass
    try:
        cwd = os.readlink(f"/proc/{pid}/cwd")
    except Exception:
        pass
    try:
        with open(f"/proc/{pid}/comm", "r", encoding="utf-8", errors="replace") as f:
            comm = f.read().strip()
    except Exception:
        pass
    return comm, cmdline, cwd

entries = []
try:
    out = subprocess.check_output(["ss", "-tlnpH"], text=True, stderr=subprocess.DEVNULL, timeout=5)
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        local = parts[3]
        if local.startswith("["):
            m = re.match(r"^\\[([^\\]]+)\\]:(\\d+)$", local)
            bind, port_s = (m.group(1), m.group(2)) if m else ("", "")
        else:
            idx = local.rfind(":")
            bind, port_s = (local[:idx], local[idx+1:]) if idx >= 0 else ("", "")
        if not port_s.isdigit():
            continue
        port = int(port_s)
        rest = " ".join(parts[5:]) if len(parts) > 5 else ""
        pm = re.search(r'"([^"]+)",pid=(\\d+)', rest)
        proc_name = pm.group(1) if pm else ""
        pid = int(pm.group(2)) if pm else None
        cmdline = ""
        cwd = ""
        if pid:
            comm, cmdline, cwd = read_proc(pid)
            if not proc_name:
                proc_name = comm
        entries.append({
            "port": port,
            "bind": bind,
            "pid": pid,
            "procName": proc_name,
            "cmdline": cmdline[:240],
            "cwd": cwd,
        })
except Exception:
    # Fallback to /proc/net/tcp and /proc/net/tcp6 if ss is unavailable
    inode_to_port = {}
    for path in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                next(f, None)
                for line in f:
                    cols = line.split()
                    if len(cols) < 10 or cols[3] != "0A":
                        continue
                    addr_hex, port_hex = cols[1].split(":")
                    port = int(port_hex, 16)
                    inode = cols[9]
                    bind = "127.0.0.1" if addr_hex.endswith("0100007F") else "0.0.0.0"
                    inode_to_port[inode] = (port, bind)
        except Exception:
            pass
    matched = set()
    if inode_to_port:
        for name in os.listdir("/proc"):
            if not name.isdigit():
                continue
            pid = int(name)
            fd_dir = f"/proc/{pid}/fd"
            try:
                fds = os.listdir(fd_dir)
            except Exception:
                continue
            for fd in fds:
                try:
                    target = os.readlink(f"{fd_dir}/{fd}")
                except Exception:
                    continue
                if target.startswith("socket:[") and target.endswith("]"):
                    inode = target[8:-1]
                    if inode in inode_to_port:
                        port, bind = inode_to_port[inode]
                        matched.add(inode)
                        comm, cmdline, cwd = read_proc(pid)
                        entries.append({
                            "port": port,
                            "bind": bind,
                            "pid": pid,
                            "procName": comm,
                            "cmdline": cmdline[:240],
                            "cwd": cwd,
                        })
        for inode, (port, bind) in inode_to_port.items():
            if inode not in matched:
                entries.append({
                    "port": port,
                    "bind": bind,
                    "pid": None,
                    "procName": "",
                    "cmdline": "",
                    "cwd": "",
                })

print(json.dumps({"ports": entries}))
`.trim();
}

export async function discoverRemotePorts({ host, cwd = "", run }) {
  const result = await run(
    host,
    "python3 -",
    buildRemotePortProbeScript(),
    10_000,
    200_000,
  );
  if (result.code !== 0) {
    throw new Error(
      (result.stderr || result.stdout || "远端监听端口扫描失败").trim().slice(-400),
    );
  }
  const text = (result.stdout || "").trim();
  const parsed = text ? JSON.parse(text) : { ports: [] };
  const raw = Array.isArray(parsed?.ports) ? parsed.ports : [];
  return filterDiscoveredPorts(raw, { cwd });
}
