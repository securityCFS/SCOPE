export const DEFAULT_HOST_RUNTIME_CONFIG = Object.freeze({
  preLaunchCommand: "",
  yolo: true,
  residentSessionLimit: null,
  updatedAt: null,
});

export function normalizePreLaunchCommand(value, fallback = "") {
  const candidate = typeof value === "string" ? value : fallback;
  return String(candidate || "")
    .replaceAll("\0", "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, 4_000);
}

export function normalizeResidentSessionLimit(value, fallback = null) {
  const defaultLimit =
    Number.isInteger(fallback) && fallback >= 0 && fallback <= 64
      ? fallback
      : null;
  if (value === undefined) return defaultLimit;
  if (value === null || value === "") return null;
  const numeric =
    typeof value === "number" ? value : Number(String(value).trim());
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 64
    ? numeric
    : defaultLimit;
}

export function normalizeHostRuntimeConfig(value, fallback = {}) {
  const base = {
    ...DEFAULT_HOST_RUNTIME_CONFIG,
    ...(fallback && typeof fallback === "object" ? fallback : {}),
  };
  return {
    preLaunchCommand: normalizePreLaunchCommand(
      value?.preLaunchCommand,
      base.preLaunchCommand,
    ),
    yolo: typeof value?.yolo === "boolean" ? value.yolo : base.yolo !== false,
    residentSessionLimit: normalizeResidentSessionLimit(
      value?.residentSessionLimit,
      base.residentSessionLimit,
    ),
    updatedAt:
      typeof value?.updatedAt === "string" ? value.updatedAt : base.updatedAt || null,
  };
}

export function runtimePolicy(yolo = true) {
  return yolo === false
    ? {
        yolo: false,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        sandboxPolicy: { type: "workspaceWrite" },
      }
    : {
        yolo: true,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
}
