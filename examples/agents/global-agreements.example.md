# Global Working Agreements (Example)

Use this template in `~/.codex/AGENTS.md` or `~/.claude/CLAUDE.md` on your GPU hosts.

## Safe Execution & Resource Hygiene

- Inspect the working directory, git branch, active jobs, and GPU memory (`nvidia-smi`) before launching training or evaluation runs.
- Run long jobs inside a durable scheduler or named `tmux` session, never in an unmonitored foreground shell.
- Never kill or restart unrelated processes, VS Code terminals, or shared tmux sessions owned by other users.
- Keep run-specific parameters, checkpoint paths, and metrics in a dedicated project log rather than bloating global instruction files.
