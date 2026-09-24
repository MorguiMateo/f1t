/**
 * The weight series, with no React and no network.
 *
 * Same role as `heatmap.ts` and `plan.ts`: the maths lives here with tests and
 * the component only draws. Two jobs. One is the delta each measurement shows
 * against the one before it — the number you actually read off the list. The
 * other is the *current* weight, which is derived from the newest entry and
 * never stored as its own column: a copy in `body_profile` would be a second
 * source of truth that contradicts the series the day the second write fails.
 *
 * The parsing of what gets typed is not here: it is `parseMeasure` with
 * `WEIGHT_RANGE` in `profile.ts`. The target weight and a logged weight are the
 * same magnitude, and two parsers are two ways to disagree about "81,5".
 */

import type { Tables } from "../../lib/database.types";

export type WeightEntry = Tables<"weight_entries">;

/**
 * Rounds to one decimal: the precision weights are shown with, and the one
 * the chart's coordinates need (`weight-trend.ts`).
 */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The fields the maths needs, so the helpers stay testable without a row. */
export type WeightPoint = { measured_on: string; weight_kg: number };

export type WithDelta<T> = T & { delta: number | null };

/**
 * Pairs each measurement with the change from the previous one.
 *
 * Entries arrive newest-first (the order the list is shown in), so an entry's
 * delta is its weight minus the *next* element's — the older measurement. The
 * oldest one has nothing to compare against and gets `null`.
 *
 * The subtraction is rounded because `81.3 - 80.9` is `0.3999…` in floating
 * point, and a weight list is the last place a stray tail of nines belongs.
 */
export function withDeltas<T extends WeightPoint>(
  newestFirst: readonly T[],
): WithDelta<T>[] {
  return newestFirst.map((entry, index) => {
    const older = newestFirst[index + 1];
    return {
      ...entry,
      delta: older ? round1(entry.weight_kg - older.weight_kg) : null,
    };
  });
}

/** The current weight: the newest measurement, or null before there is one. */
export function latestWeight(newestFirst: readonly WeightPoint[]): number | null {
  return newestFirst[0]?.weight_kg ?? null;
}

/**
 * A weight for display: at most one decimal, with the comma a Spanish reader
 * expects. `81` stays `81`, `81.5` becomes `81,5`.
 */
export function formatKg(value: number): string {
  return round1(value).toString().replace(".", ",");
}

/**
 * A delta with its sign, for the list. Up or down and by how much — never a
 * colour that calls it good or bad, because whether gaining is progress
 * depends on the goal, and the list doesn't know it. Uses the real minus sign
 * (U+2212), which lines up with digits better than a hyphen.
 */
export function formatDelta(delta: number): string {
  if (delta === 0) return "±0";
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${formatKg(Math.abs(delta))}`;
}
