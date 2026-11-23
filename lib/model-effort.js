export const EFFORT_LABELS = {
  none: "无",
  minimal: "最少",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最大",
  ultra: "超高",
};
export function compatibleEffort(model, effort) {
  return model?.supportedReasoningEfforts?.includes(effort) ? effort : "";
}
