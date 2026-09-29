import { useEffect, useRef, useState } from "react";

function prefersStaticMotion() {
  if (typeof window.requestAnimationFrame !== "function" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Eases a displayed number towards `target` (ease-out cubic). Jumps straight to the
 * target under reduced motion or when requestAnimationFrame/matchMedia are missing (tests).
 */
export function useAnimatedNumber(target: number, duration = 600) {
  const [value, setValue] = useState(target);
  const shown = useRef(target);

  useEffect(() => {
    const from = shown.current;
    if (from === target) return;
    if (prefersStaticMotion()) {
      shown.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const next = from + (target - from) * (1 - (1 - t) ** 3);
      shown.current = next;
      setValue(next);
      if (t < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [duration, target]);

  return value;
}
