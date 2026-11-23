"use client";
import { AgentLogo } from "@/components/agent-logo";

export type NewAgent = "codex" | "claude" | "antigravity";
export function NewAgentChoice({ value, onChange }: { value: NewAgent; onChange: (value: NewAgent) => void }) {
  return <div className="new-agent-choice" role="group" aria-label="选择 Agent">
    {(["codex", "claude", "antigravity"] as const).map((provider) => <button type="button" key={provider} aria-pressed={value === provider} onClick={() => onChange(provider)}><AgentLogo provider={provider} /><span>{provider === "codex" ? "Codex" : provider === "claude" ? "Claude" : "Antigravity"}</span></button>)}
  </div>;
}
