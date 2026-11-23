import { projectIdentity } from "./projects.js";
/** Plans are proposals only. Parsing never dispatches a task. */
export function managerPlans(text) {
  const blocks = String(text).matchAll(/```scope-plan\s*\n([\s\S]*?)```/g);
  for (const block of blocks) {
    try {
      const value = JSON.parse(block[1]);
      if (!Array.isArray(value)) continue;
      return value
        .slice(0, 8)
        .filter(
          (item) =>
            item &&
            ["codex", "claude", "dsh"].includes(item.provider) &&
            typeof item.host === "string" &&
            typeof item.cwd === "string" &&
            projectIdentity(item.host, item.cwd) &&
            typeof item.prompt === "string" &&
            item.prompt.trim() &&
            item.prompt.length <= 16000,
        )
        .map((item) => ({
          provider: item.provider,
          host: item.host,
          cwd: projectIdentity(item.host, item.cwd).cwd,
          prompt: item.prompt,
          gpuCount: Number.isInteger(item.gpuCount) ? item.gpuCount : 0,
          minMemoryMiB: Number.isInteger(item.minMemoryMiB)
            ? item.minMemoryMiB
            : 0,
        }));
    } catch {
      /* Invalid model output remains visible as ordinary text. */
    }
  }
  return [];
}
