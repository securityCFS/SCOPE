"use client";
import { useState } from "react";
import { bridgeUrl } from "@/features/workspace/shared";

export type ArchiveRecord = {
  host: string;
  sessionId: string;
  title: string;
  cwd: string;
  phase: "archiving" | "archived" | "restoring" | "restored";
  archivedAt?: string;
  error?: string | null;
};
export function useSessionArchives(
  onArchived: (host: string, id: string) => void,
) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function change(
    host: string,
    sessionId: string,
    action: "archive" | "restore",
  ) {
    if (busy) return;
    setBusy(`${host}:${sessionId}`);
    setError("");
    try {
      const response = await fetch(bridgeUrl("/api/session/archives"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host, sessionId, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "归档操作失败");
      if (action === "archive") onArchived(host, sessionId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return { busy, error, change };
}
export type ArchiveClient = ReturnType<typeof useSessionArchives>;
