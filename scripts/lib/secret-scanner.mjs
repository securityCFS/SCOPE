import { readFile } from "node:fs/promises";

/**
 * Built-in generic secret detectors for open-source safety checks.
 * Never commit personal IPs, hostnames, usernames, or internal codenames here;
 * place private organization/machine denylists in git-ignored
 * `.scope/leak-denylist.json` (or point `SCOPE_EXPORT_DENYLIST` to a JSON file).
 */
export const SECRET_HEURISTICS = [
  {
    id: "private-key",
    label: "Private key PEM block",
    regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/,
  },
  {
    id: "openai-or-anthropic-key",
    label: "API secret key (sk-*)",
    regex: /\bsk-(?:proj-[A-Za-z0-9_-]{20,}|ant-api\d*-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})\b/,
  },
  {
    id: "github-token",
    label: "GitHub personal/fine-grained token",
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  },
  {
    id: "aws-access-key",
    label: "AWS access key ID",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: "slack-token",
    label: "Slack token",
    regex: /\bxox[baprs]-[0-9A-Za-z-]{24,}\b/,
  },
  {
    id: "google-api-key",
    label: "Google API key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: "credential-url",
    label: "URL with embedded non-local credentials",
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@"']{1,64}:[^/\s@"']{6,128}@(?!localhost\b|127\.0\.0\.1\b|example\.com\b|host\b|smtp\.example)[a-z0-9.-]+\.[a-z]{2,}/i,
  },
];

function escapeRegexLiteral(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileDenylistRegex(patterns = []) {
  if (!Array.isArray(patterns) || !patterns.length) return null;
  const parts = [];
  for (const item of patterns) {
    if (typeof item === "string" && item.trim()) {
      parts.push(item.trim());
    } else if (item && typeof item === "object") {
      if (typeof item.regex === "string" && item.regex.trim()) {
        parts.push(item.regex.trim());
      } else if (typeof item.literal === "string" && item.literal.trim()) {
        parts.push(escapeRegexLiteral(item.literal.trim()));
      }
    }
  }
  if (!parts.length) return null;
  return new RegExp(`(${parts.join("|")})`, "i");
}

export async function loadDenylistPatterns(filePath) {
  if (!filePath) return [];
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
      const patterns = [];
      if (Array.isArray(raw.literals)) {
        for (const literal of raw.literals) {
          if (typeof literal === "string" && literal.trim()) {
            patterns.push({ literal });
          }
        }
      }
      if (Array.isArray(raw.patterns)) {
        for (const pattern of raw.patterns) {
          if (typeof pattern === "string" && pattern.trim()) {
            patterns.push({ regex: pattern });
          }
        }
      }
      return patterns;
    }
    return [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function redactSecret(token) {
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export function scanContentForLeaks(content, relativePath = "", extraPatterns = []) {
  const violations = [];
  const customRegex =
    extraPatterns instanceof RegExp
      ? extraPatterns
      : extraPatterns
        ? compileDenylistRegex(extraPatterns)
        : null;
  const lines = String(content || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (customRegex) {
      const forbidden = line.match(customRegex);
      if (forbidden) {
        violations.push({
          file: relativePath,
          line: i + 1,
          rule: "custom-denylist",
          token: redactSecret(forbidden[0]),
        });
      }
    }
    for (const rule of SECRET_HEURISTICS) {
      const secret = line.match(rule.regex);
      if (secret) {
        violations.push({
          file: relativePath,
          line: i + 1,
          rule: rule.id,
          token: redactSecret(secret[0]),
        });
      }
    }
  }
  return violations;
}
