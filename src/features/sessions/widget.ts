/**
 * The `WidgetPayload` the iOS widget reads.
 *
 * There is no widget yet: on the web, `device.syncWidget()` only drops the
 * payload into localStorage. It is built anyway, and built complete, from
 * Phase 4 — rather than waiting until Phase 6 — for two reasons: it forces
 * `buildLevels()` to have a real consumer from day one, and by the time
 * Capacitor lands the web side is already done. See PLAN.md §5.3.
 *
 * It is a pure function on purpose: exercise names are resolved by the
 * caller — the catalog lives in a `lazy()` chunk — so this can be tested
 * without loading 209 KB of JSON.
 */

import type { WidgetPayload } from "../../lib/device";
import { buildLevels, currentStreak, type HeatmapSession } from "../../lib/heatmap";

/**
 * 26 weeks: half a year, which is what fits in a medium iOS widget without
 * pushing the squares below the minimum touch target.
 */
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
      // An explicit copy: the payload is serialised to JSON and has no
      // business dragging along whatever else the caller's objects carry.
      ({ name, detail }) => ({ name, detail }),
    ),
    streak: currentStreak(input.days, now),
  };
}
