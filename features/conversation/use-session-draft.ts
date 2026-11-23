"use client";
import { useCallback, useState, type SetStateAction } from "react";

/** Drafts belong to a chat, so changing projects never overwrites another draft. */
export function useSessionDraft(sessionId: string | null) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const key = sessionId || "new";
  const setDraft = useCallback(
    (value: SetStateAction<string>) => {
      setDrafts((current) => ({
        ...current,
        [key]: typeof value === "function" ? value(current[key] || "") : value,
      }));
    },
    [key],
  );
  return [drafts[key] || "", setDraft] as const;
}
