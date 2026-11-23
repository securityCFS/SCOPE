/** Remote probe, kept independent of HTTP and local mutable state. */
export const TAKEOVER_PROBE = String.raw`
import glob
import json
import os
import shlex
import shutil
import subprocess
import sys
import time

pid = int(sys.argv[1])
expected_rollout = os.path.realpath(sys.argv[2])
expected_cwd = os.path.realpath(sys.argv[3])
executable = sys.argv[4] or "codex"
session_id = sys.argv[5]
tmux_name = sys.argv[6]
pre_launch_command = sys.argv[7] if len(sys.argv) > 7 else ""
model = sys.argv[8] if len(sys.argv) > 8 else ""
yolo = len(sys.argv) <= 9 or sys.argv[9] != "0"

def fail(message, code=1):
    print(message, file=sys.stderr)
    raise SystemExit(code)

def process_alive(target_pid):
    stat_path = f"/proc/{target_pid}/stat"
    try:
        with open(stat_path, "r", encoding="utf-8", errors="replace") as handle:
            fields = handle.read().split()
        return len(fields) > 2 and fields[2] != "Z"
    except Exception:
        return False

def rollout_owners():
    owners = []
    for fd_path in glob.glob("/proc/[0-9]*/fd/*"):
        try:
            target = os.path.realpath(os.readlink(fd_path))
        except Exception:
            continue
        if target == expected_rollout:
            try:
                owners.append(int(fd_path.split("/")[2]))
            except Exception:
                pass
    return sorted(set(owners))

if pid > 0:
    fail("安全策略禁止终止活动 CLI/VS Code Session", 23)
owners = rollout_owners()
if owners:
    fail(
        "该 Session 已由 PID " + ",".join(map(str, owners)) + " 打开；请刷新页面",
        17,
    )

if not os.path.isdir(expected_cwd):
    fail(f"工作目录不存在：{expected_cwd}", 18)

def pane_processes(root_pid):
    records = {}
    for stat_path in glob.glob("/proc/[0-9]*/stat"):
        try:
            process_pid = int(stat_path.split("/")[2])
            fields = open(
                stat_path, "r", encoding="utf-8", errors="replace"
            ).read().split()
            parent_pid = int(fields[3])
            cmdline = open(
                f"/proc/{process_pid}/cmdline", "rb"
            ).read().replace(b"\0", b" ").decode("utf-8", errors="replace")
            records[process_pid] = (parent_pid, cmdline)
        except Exception:
            continue
    descendants = []
    pending = [root_pid]
    seen = set()
    while pending:
        parent = pending.pop()
        if parent in seen:
            continue
        seen.add(parent)
        if parent in records:
            descendants.append((parent, records[parent][1]))
        pending.extend(
            process_pid
            for process_pid, (parent_pid, _) in records.items()
            if parent_pid == parent and process_pid not in seen
        )
    return descendants

def existing_tmux():
    checked = subprocess.run(
        [
            "tmux",
            "display-message",
            "-p",
            "-t",
            f"{tmux_name}:0.0",
            "#S:#I.#P\t#{pane_current_command}\t#{pane_pid}",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if checked.returncode != 0:
        return
    fields = checked.stdout.strip().split("\t")
    target = fields[0] if fields else f"{tmux_name}:0.0"
    command = fields[1] if len(fields) > 1 else ""
    try:
        pane_pid = int(fields[2]) if len(fields) > 2 else 0
    except Exception:
        pane_pid = 0
    processes = pane_processes(pane_pid)
    exact_session = any(
        session_id in cmdline
        and ("codex" in cmdline or os.path.basename(executable) in cmdline)
        for _, cmdline in processes
    )
    if not exact_session:
        fail(
            f"tmux {tmux_name} 已存在但不属于 Session {session_id}；为保护现有进程，拒绝覆盖或终止",
            28,
        )
    preview = subprocess.run(
        ["tmux", "capture-pane", "-p", "-S", "-20", "-t", target],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    ).stdout.strip()[-1600:]
    print(json.dumps({
        "ok": True,
        "killedPid": None,
        "forced": False,
        "reused": True,
        "tmux": tmux_name,
        "target": target,
        "paneCommand": command,
        "panePid": pane_pid,
        "readyInMs": 0,
        "cwdChoice": "existing",
        "preview": preview,
        "cwd": expected_cwd,
        "sessionId": session_id,
    }, ensure_ascii=False, separators=(",", ":")))
    raise SystemExit(0)

# Recovery is idempotent. Never kill an existing tmux to make room: that pane
# may own an active Codex turn or a child experiment.
existing_tmux()
resume_command = (
    "exec "
    + shlex.quote(executable)
    + (" --yolo" if yolo else " --ask-for-approval on-request --sandbox workspace-write")
    + ((" --model " + shlex.quote(model)) if model else "")
    + " resume "
    + shlex.quote(session_id)
)
create_args = [
    "tmux",
    "new-session",
    "-d",
    "-s",
    tmux_name,
    "-c",
    expected_cwd,
]
if pre_launch_command:
    zsh_handler = "; ".join([
        pre_launch_command,
        resume_command,
    ])
    bash_handler = "; ".join([
        "source ~/.bashrc >/dev/null 2>&1 || true",
        pre_launch_command,
        resume_command,
    ])
    if shutil.which("zsh"):
        create_args.append("exec zsh -ic " + shlex.quote(zsh_handler))
    else:
        create_args.append("exec bash -ic " + shlex.quote(bash_handler))
else:
    create_args.append(resume_command)
created = subprocess.run(
    create_args,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)
if created.returncode != 0:
    fail("tmux 创建失败：" + (created.stderr.strip() or created.stdout.strip()), 19)

# zsh startup can legitimately spend a few seconds in conda/plugin handlers
# before its final exec. Treat that shell as transitional instead of failing a
# healthy takeover at the old six-second boundary.
deadline = time.time() + 15.0
checked = None
target = ""
pane_command = ""
pane_pid = 0
pane_target = f"{tmux_name}:0.0"
ready_started_at = time.time()
while time.time() < deadline:
    checked = subprocess.run(
        [
            "tmux",
            "display-message",
            "-p",
            "-t",
            pane_target,
            "#S:#I.#P\t#{pane_current_command}\t#{pane_pid}",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if checked.returncode != 0:
        fail(
            "tmux 已创建但 Codex 立即退出："
            + (checked.stderr.strip() or "请检查远端 Codex CLI")
            + f"；已保留 tmux {tmux_name} 供检查",
            20,
        )
    checked_fields = checked.stdout.strip().split("\t")
    target = checked_fields[0] if checked_fields else ""
    pane_command = checked_fields[1] if len(checked_fields) > 1 else ""
    try:
        pane_pid = int(checked_fields[2]) if len(checked_fields) > 2 else 0
    except Exception:
        pane_pid = 0
    # npm/global Codex installations commonly exec a Node entrypoint, so tmux
    # reports node even though the pane is the intended Codex process.
    if pane_command in ("codex", "node"):
        break
    time.sleep(0.2)
if pane_command not in ("codex", "node"):
    fail(
        "tmux 已创建但 Codex 未在 15 秒内保持运行"
        + (f"（pane command: {pane_command}）" if pane_command else "")
        + f"；已保留 tmux {tmux_name} 供检查",
        25,
    )

# The Node process can exist before the TUI has finished restoring the thread.
# Inputs pasted during that gap are rendered briefly and then discarded by the
# final screen initialization, so do not report a usable tmux target yet.
ui_deadline = time.time() + 8.0
ui_ready = False
cwd_choice = "unchanged"
cwd_prompt_answered = False
preview = ""
while time.time() < ui_deadline:
    captured = subprocess.run(
        ["tmux", "capture-pane", "-p", "-t", pane_target, "-S", "-80"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    preview = captured.stdout
    cwd_prompt = "Choose working directory to resume this session"
    if (
        captured.returncode == 0
        and cwd_prompt in preview
        and not cwd_prompt_answered
    ):
        # Preserve the directory of the process being taken over. Rollouts are
        # often created under /tmp and later continued from the real project or
        # worktree, so choose option 2 (Current) instead of the original Session
        # directory.
        answered = subprocess.run(
            ["tmux", "send-keys", "-t", pane_target, "Down", "Enter"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if answered.returncode != 0:
            fail(
                "Codex 请求选择恢复目录，但无法确认当前工作目录："
                + (answered.stderr.strip() or "tmux send-keys 失败")
                + f"；已保留 tmux {tmux_name} 供检查",
                27,
            )
        cwd_prompt_answered = True
        cwd_choice = "current"
        time.sleep(0.5)
        continue
    if (
        captured.returncode == 0
        and "OpenAI Codex" in preview
        and cwd_prompt not in preview
    ):
        # Let the input editor finish replacing the startup screen.
        time.sleep(0.5)
        ui_ready = True
        break
    time.sleep(0.2)
if not ui_ready:
    fail(
        "tmux 已创建但 Codex TUI 未在 8 秒内就绪"
        + f"；已保留 tmux {tmux_name} 供检查",
        26,
    )

captured = subprocess.run(
    ["tmux", "capture-pane", "-p", "-S", "-8", "-t", target],
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True,
)
preview = captured.stdout.strip()[-1600:] if captured.returncode == 0 else ""

print(json.dumps({
    "ok": True,
    "killedPid": None,
    "forced": False,
    "tmux": tmux_name,
    "target": target,
    "paneCommand": pane_command,
    "panePid": pane_pid,
    "readyInMs": int((time.time() - ready_started_at) * 1000),
    "cwdChoice": cwd_choice,
    "preview": preview,
    "cwd": expected_cwd,
    "sessionId": session_id,
}, ensure_ascii=False, separators=(",", ":")))
`;
