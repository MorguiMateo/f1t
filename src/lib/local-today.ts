import { useEffect, useState } from "react";
import { toDateKey } from "./heatmap";

/** Calendar midnight, not 24 hours: also works on daylight-saving boundaries. */
export function millisecondsToLocalMidnight(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

export function watchLocalToday(update: (key: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  function refresh() {
    const now = new Date();
    update(toDateKey(now));
    clearTimeout(timer);
    timer = setTimeout(refresh, millisecondsToLocalMidnight(now) + 100);
  }
  function onVisible() {
    if (document.visibilityState === "visible") refresh();
  }
  refresh();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export function useLocalToday(): string {
  const [today, setToday] = useState(() => toDateKey(new Date()));
  useEffect(() => watchLocalToday(setToday), []);
  return today;
}
