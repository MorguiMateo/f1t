import { fromDateKey, toDateKey } from "../../lib/heatmap";
import type { WeightPoint } from "./weight";

export function chartSampleCount(entries: readonly WeightPoint[], end: string): number {
  const date = fromDateKey(end);
  date.setDate(date.getDate() - 6);
  const start = toDateKey(date);
  return entries.filter((entry) => entry.measured_on >= start && entry.measured_on <= end).length;
}
export function hasWeightGaps(dates: readonly string[]): boolean {
  return [...dates].sort().some((date, index, sorted) => {
    if (!index) return false;
    const previous = fromDateKey(sorted[index - 1]);
    previous.setDate(previous.getDate() + 7);
    return date > toDateKey(previous);
  });
}
