import { useEffect, useState } from "react";

/**
 * `value` once `key` stopped changing for `delay` ms (the first value right away). Keeps
 * expensive work, like redrawing the generated cover, from running on every keystroke.
 */
export function useSettledValue<T>(value: T, key: string, delay: number): T {
  const [settled, setSettled] = useState({ key, value });
  useEffect(() => {
    if (key === settled.key) return;
    const timer = window.setTimeout(() => setSettled({ key, value }), delay);
    return () => window.clearTimeout(timer);
    // `value` is identified by `key`: a new object with the same key is the same value.
  }, [key, delay, settled.key]);
  return settled.value;
}
