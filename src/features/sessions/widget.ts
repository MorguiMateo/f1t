/**
 * Pure on purpose: the caller resolves exercise names because the catalog
 * lives in a `lazy()` chunk, so this is testable without loading it.
 */

import type { WidgetPayload } from "../../lib/device";
import { buildLevels, currentStreak, type HeatmapSession } from "../../lib/heatmap";

/** The most that fits a medium iOS widget without squares dropping below touch-target size. */
export const WIDGET_WEEKS = 26;

/** How many exercises fit in the large widget without being clipped. */
export const WIDGET_EXERCISE_LIMIT = 6;

export function buildWidgetPayload(input: {
  days: readonly HeatmapSession[];
  todayLabel: string | null;
  todayExercises: readonly { name: string; detail: string }[];
  now?: Date;
}): WidgetPayload {
  const now = input.now ?? new Date();
  return {
    levels: buildLevels(input.days, { weeks: WIDGET_WEEKS, endDate: now }),
    todayLabel: input.todayLabel,
    todayExercises: input.todayExercises.slice(0, WIDGET_EXERCISE_LIMIT).map(
      // Explicit copy so extra caller fields don't leak into the serialised payload.
      ({ name, detail }) => ({ name, detail }),
    ),
    streak: currentStreak(input.days, now),
  };
}
