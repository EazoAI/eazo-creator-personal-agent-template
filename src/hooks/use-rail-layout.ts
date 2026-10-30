"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const RAIL_MIN = 180;
const RAIL_MAX = 420;
export const RAIL_DEFAULT = 220;

export function useRailLayout() {
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT);
  const [railAnim, setRailAnim] = useState(true);
  const draggingRef = useRef(false);

  useEffect(() => {
    try {
      const w = Number(localStorage.getItem("muse.railWidth"));
      if (w >= RAIL_MIN && w <= RAIL_MAX) setRailWidth(w);
      setRailCollapsed(localStorage.getItem("muse.railCollapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("muse.railCollapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const resetRailWidth = useCallback(() => {
    setRailWidth(RAIL_DEFAULT);
    try {
      localStorage.setItem("muse.railWidth", String(RAIL_DEFAULT));
    } catch {
      /* ignore */
    }
  }, []);

  const startRailDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    setRailAnim(false);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      const w = Math.min(RAIL_MAX, Math.max(RAIL_MIN, ev.clientX));
      setRailWidth(w);
    };
    const onUp = () => {
      draggingRef.current = false;
      setRailAnim(true);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setRailWidth((w) => {
        try {
          localStorage.setItem("muse.railWidth", String(w));
        } catch {
          /* ignore */
        }
        return w;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  return {
    railCollapsed,
    railWidth,
    railAnim,
    setRailAnim,
    toggleRailCollapsed,
    resetRailWidth,
    startRailDrag,
  };
}
