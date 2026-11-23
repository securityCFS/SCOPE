"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type UIEvent,
} from "react";

/** Follow the latest messages until the reader deliberately scrolls into history. */
export function useNativeScroll({
  history,
  turns,
  ready,
  working,
}: {
  history: unknown;
  turns: unknown;
  ready: boolean;
  working: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const settled = useRef(false);
  const lastScrollTop = useRef(0);
  const anchor = useRef<{
    height: number;
    top: number;
    history: unknown;
  } | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const syncToBottom = useCallback(() => {
    const element = scroll.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    lastScrollTop.current = element.scrollTop;
    setAtBottom((prev) => (prev ? prev : true));
  }, []);

  useLayoutEffect(() => {
    const element = scroll.current;
    const hasTurns = Array.isArray(turns) ? turns.length > 0 : Boolean(turns);
    if (!element || (!ready && !hasTurns)) return;
    if (ready) settled.current = true;
    if (anchor.current) {
      if (anchor.current.history !== history) {
        element.scrollTop =
          anchor.current.top + element.scrollHeight - anchor.current.height;
        lastScrollTop.current = element.scrollTop;
        anchor.current = null;
      }
      return;
    }
    if (follow.current) {
      syncToBottom();
      const frame = requestAnimationFrame(() => {
        if (follow.current && !anchor.current) syncToBottom();
      });
      return () => {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(frame);
        }
      };
    }
  }, [history, turns, ready, working, syncToBottom]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (settled.current && follow.current && !anchor.current) {
        syncToBottom();
      }
    });
    if (content.current) observer.observe(content.current);
    if (scroll.current) observer.observe(scroll.current);
    return () => observer.disconnect();
  }, [syncToBottom]);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    if (!settled.current) return;
    const element = event.currentTarget;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (nearBottom) {
      follow.current = true;
      setAtBottom((prev) => (prev ? prev : true));
    } else if (element.scrollTop < lastScrollTop.current - 4) {
      // Only break bottom-follow on actual upward scrolling, not async layout growth.
      follow.current = false;
      setAtBottom((prev) => (!prev ? prev : false));
    }
    lastScrollTop.current = element.scrollTop;
  }
  function toBottom() {
    follow.current = true;
    anchor.current = null;
    syncToBottom();
  }
  async function older(load: () => Promise<void>) {
    const element = scroll.current;
    if (element)
      anchor.current = {
        height: element.scrollHeight,
        top: element.scrollTop,
        history,
      };
    follow.current = false;
    setAtBottom((prev) => (!prev ? prev : false));
    try {
      await load();
    } finally {
      requestAnimationFrame(() => {
        anchor.current = null;
      });
    }
  }
  return { scroll, content, onScroll, toBottom, older, atBottom };
}
