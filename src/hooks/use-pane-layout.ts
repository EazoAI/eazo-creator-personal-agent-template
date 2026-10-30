"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const BROWSER_MIN = 380;
const CHAT_MIN = 340;

export function usePaneLayout(opts: {
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const { onDragStart, onDragEnd } = opts;
  const [browserWidth, setBrowserWidth] = useState<number | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef = useRef(onDragEnd);
  onDragStartRef.current = onDragStart;
  onDragEndRef.current = onDragEnd;

  useEffect(() => {
    try {
      const w = Number(localStorage.getItem("muse.browserWidth"));
      if (w >= BROWSER_MIN) setBrowserWidth(w);
    } catch {
      /* ignore */
    }
  }, []);

  const startPaneDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const shellLeft = shellRef.current?.getBoundingClientRect().left ?? 0;
    let last: number | null = null;
    onDragStartRef.current?.();
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    // Iframes swallow pointer events mid-drag; disable them while dragging.
    document.body.classList.add("is-pane-dragging");

    const onMove = (ev: PointerEvent) => {
      const max = window.innerWidth - shellLeft - CHAT_MIN;
      const w = Math.round(Math.min(max, Math.max(BROWSER_MIN, window.innerWidth - ev.clientX)));
      last = w;
      setBrowserWidth(w);
    };
    const onUp = () => {
      onDragEndRef.current?.();
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.body.classList.remove("is-pane-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (last !== null) {
        try {
          localStorage.setItem("muse.browserWidth", String(last));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const resetPaneWidth = useCallback(() => {
    setBrowserWidth(null);
    try {
      localStorage.removeItem("muse.browserWidth");
    } catch {
      /* ignore */
    }
  }, []);

  return {
    browserWidth,
    shellRef,
    startPaneDrag,
    resetPaneWidth,
  };
}
