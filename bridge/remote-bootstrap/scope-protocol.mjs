import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SCOPE_PROTOCOL_BEGIN = "<!-- SCOPE_PROTOCOL_BEGIN -->";
export const SCOPE_PROTOCOL_END = "<!-- SCOPE_PROTOCOL_END -->";

const GENERIC_OPERATOR_NAMES = new Set(["", "operator", "preview", "预览", "user"]);

export function sanitizeOperatorName(value) {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f\r\n`*_<>[\]]/g, "")
    .trim()
    .slice(0, 40);
  return GENERIC_OPERATOR_NAMES.has(cleaned.toLowerCase()) ? "" : cleaned;
}

export function buildScopeProtocolBlock({ operatorName = "" } = {}) {
  const operator = sanitizeOperatorName(operatorName);
  const lines = [
    SCOPE_PROTOCOL_BEGIN,
    "## SCOPE Output & Rich-Media Display Protocol",
    "",
    "When responding inside SCOPE (or generating reports meant to be read in SCOPE Web UI), follow these formatting rules so formulas, tables, media, and file links render natively:",
    "",
  ];
  if (operator) {
    lines.push(
      `0. **Operator / User Name**: Address the user as **${operator}** in direct replies and completion summaries.`,
    );
  }
  lines.push(
    "1. **LaTeX Math**: Use `$...$` for inline math and `$$...$$` (or fenced ```` ```latex ```` blocks) for display equations. Never spell out multi-term equations in plain ASCII text.",
    "2. **Markdown Tables (GFM)**: Present structured comparisons, metrics, and schedules using standard GitHub Flavored Markdown pipe tables (`| Column A | Column B |` followed by `| --- | --- |`). Do not use raw tab-separated text or space-padded ASCII tables.",
    "3. **Inline Images & Videos**: Embed generated charts, screenshots, and video rollouts using Markdown image syntax with absolute paths or `file://` URIs so SCOPE displays them inline:",
    "   - Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`): `![Caption](file:///abs/path/to/figure.png)` or `![Caption](/abs/path/to/figure.png)`",
    "   - Videos (`.mp4`, `.webm`, `.m4v`, `.ogv`, `.mov`): `![Caption](file:///abs/path/to/video.mp4)` or `[Caption](file:///abs/path/to/video.mp4)`",
    "   - Do not wrap visual asset paths solely in backticks when the user should inspect the rendered image or video.",
    "4. **Clickable File & Line Links**: Reference source files, configs, and logs as clickable Markdown links using `file://` or absolute paths with optional line anchors, e.g. `[train.py](file:///abs/path/to/train.py#L42-L68)` or `[train.py](/abs/path/to/train.py:42)`.",
    SCOPE_PROTOCOL_END,
  );
  return lines.join("\n");
}

export const SCOPE_PROTOCOL_BLOCK = buildScopeProtocolBlock();

export function upsertMarkedBlock(current, begin, end, block) {
  const source = String(current || "");
  if (source.includes(begin) && source.includes(end)) {
    const startIdx = source.indexOf(begin);
    const endIdx = source.indexOf(end, startIdx + begin.length);
    if (endIdx >= 0) {
      const prefix = source.slice(0, startIdx).trimEnd();
      const suffix = source.slice(endIdx + end.length);
      const joinedPrefix = prefix ? `${prefix}\n\n` : "";
      const joinedSuffix = suffix.startsWith("\n") ? suffix : suffix ? `\n${suffix}` : "\n";
      return `${joinedPrefix}${block}${joinedSuffix}`;
    }
  }
  return source.trim() ? `${source.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

export function removeMarkedBlock(current, begin, end) {
  const source = String(current || "");
  if (!source.includes(begin) || !source.includes(end)) return source;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end, startIdx + begin.length);
  if (endIdx < 0) return source;
  const prefix = source.slice(0, startIdx).trimEnd();
  const suffix = source.slice(endIdx + end.length).trimStart();
  const cleaned = [prefix, suffix].filter(Boolean).join("\n\n").trim();
  return cleaned ? `${cleaned}\n` : "";
}

/**
 * Sync SCOPE_PROTOCOL_BLOCK into local Codex, Claude Code, and Antigravity
 * instruction files without overwriting any existing user instructions.
 */
export async function syncLocalScopeProtocol(homeDir = os.homedir(), { operatorName = "" } = {}) {
  const block = buildScopeProtocolBlock({ operatorName });
  const candidates = [
    { client: "codex", file: path.join(homeDir, ".codex", "AGENTS.md") },
    { client: "claude", file: path.join(homeDir, ".claude", "CLAUDE.md") },
    { client: "antigravity", file: path.join(homeDir, ".gemini", "config", "GEMINI.md") },
  ];
  const seen = new Set();
  const updated = [];
  for (const item of candidates) {
    await mkdir(path.dirname(item.file), { recursive: true });
    let canonical = item.file;
    try {
      canonical = await realpath(item.file);
    } catch {
      /* File does not exist yet; canonicalize parent instead. */
      try {
        canonical = path.join(await realpath(path.dirname(item.file)), path.basename(item.file));
      } catch {
        canonical = path.resolve(item.file);
      }
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    let current = "";
    try {
      current = await readFile(item.file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const next = upsertMarkedBlock(
      current,
      SCOPE_PROTOCOL_BEGIN,
      SCOPE_PROTOCOL_END,
      block,
    );
    await writeFile(item.file, next, "utf8");
    updated.push({ client: item.client, path: item.file });
  }
  return {
    codex: true,
    claude: true,
    antigravity: true,
    operatorName: sanitizeOperatorName(operatorName) || null,
    files: updated,
  };
}
