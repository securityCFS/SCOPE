import { PROVIDERS } from "@/lib/workbench-config";

/** Local assets: rendering a project never sends requests to an agent vendor. */
export function AgentLogo({ provider = "codex", size = 16 }: {
  provider?: string;
  size?: number;
}) {
  const id = provider === "agy" ? "antigravity" : provider;
  if (!Object.hasOwn(PROVIDERS, id)) return null;
  const name = PROVIDERS[id as keyof typeof PROVIDERS].name;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`agent-logo agent-logo-${id}`} src={`/agents/${id}.svg`}
      width={size} height={size} alt={name} title={name} draggable={false}
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
  );
}
