"use client";
import { bridgeUrl } from "@/features/workspace/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkbenchState } from "./types";

export function useWorkbench() {
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const current = ++sequence.current;
    const response = await fetch(bridgeUrl("/api/workbench"), {
      cache: "no-store",
      signal,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "无法连接工作台");
    if (mounted.current && current === sequence.current) {
      setState(value);
      setError("");
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        await refresh(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      mounted.current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);
  async function mutate(path: string, body: unknown) {
    setBusy(true);
    setActionError("");
    try {
      const response = await fetch(bridgeUrl(`/api/workbench/${path}`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "操作失败");
      // A successful write stays successful even if the following refresh disconnects.
      try {
        await refresh();
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
      }
      return result;
    } catch (e) {
      if (mounted.current) setActionError((e as Error).message);
      throw e;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return { state, error: actionError || error, busy, mutate };
}
export type WorkbenchClient = ReturnType<typeof useWorkbench>;
