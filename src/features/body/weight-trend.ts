/**
 * The weight chart's geometry, with no React and no network.
 *
 * Same split as `heatmap.ts` → `heatmap.tsx`: every number the chart needs is
 * computed here, in SVG coordinates, and `weight-chart.tsx` only draws. That
 * keeps the maths testable, and keeps it portable to the widget in Phase 6,
 * where a React component is worth nothing but an array of points is not.
 *
 * Three layers go on the chart:
 *
 * - **The measurements**, faint. A single weigh-in swings ±1 kg with water,
 *   salt and the last meal, so it is the least trustworthy thing on screen.
 * - **The trend**, a trailing average over calendar days. It is the line to
 *   read.
 * - **The target**, a horizontal line at the profile's `target_weight_kg`.
 */

import { fromDateKey, toDateKey } from "../../lib/heatmap";
import { round1, type WeightPoint } from "./weight";

/** The drawing's own units. The SVG scales them to whatever width it gets. */
export const CHART_WIDTH = 320;
export const CHART_HEIGHT = 160;

/** Room for the kg labels on the left and the month labels below. */
const PLOT = { left: 30, right: CHART_WIDTH - 6, top: 10, bottom: CHART_HEIGHT - 18 };

/** How many calendar days the trend averages over, the day itself included. */
export const TREND_DAYS = 7;

/**
 * The smallest vertical range the chart will show. Without it a flat series
 * — 80.0, 80.2, 79.9 — stretches 0.3 kg of scale noise across the full
 * height and draws a mountain range.
 */
export const MIN_SPAN_KG = 2;

/**
 * The smallest horizontal range. A shorter history is centred inside it
 * instead of stretched across it: two weigh-ins three days apart shouldn't be
 * pinned to opposite edges as if they spanned the whole chart. Two weeks, so
 * a few days of data still take up a readable fifth of the width.
 */
export const MIN_SPAN_DAYS = 14;

/** Candidate gaps between kg gridlines, smallest first. */
const STEPS = [0.5, 1, 2, 5, 10, 20, 50];

/** At most this many gaps between gridlines, so their labels don't crowd. */
const MAX_TICK_GAPS = 5;

/** A month label needs this much room before the right edge, or it clips. */
const MONTH_LABEL_ROOM = 20;

const DAY_MS = 86_400_000;

export type ChartPoint = {
  date: string;
  kg: number;
  /** The trailing average at this date. */
  trend: number;
  x: number;
  y: number;
  trendY: number;
};

export type WeightChart = {
  plot: typeof PLOT;
  /**
   * First and last day on the x axis, YYYY-MM-DD. `end` is today once the
   * history spans `MIN_SPAN_DAYS`; before that it is a day in the future.
   */
  start: string;
  end: string;
  today: string;
  /** Oldest to newest, only those inside the window. */
  points: ChartPoint[];
  /** The `d` of the trend's <path>. */
  trendPath: string;
  target: { kg: number; y: number } | null;
  yTicks: { kg: number; y: number }[];
  /**
   * Month starts when the range crosses at least two, otherwise the first
   * measurement and today — one label if they are the same day. A two-week
   * chart with a single "sept" under it says nothing about where it starts.
   */
  xTicks: { date: string; x: number }[];
  xTickFormat: "month" | "day";
};

export type WeightChartOptions = {
  /** How far back the chart reaches. Defaults to the heatmap's half year. */
  weeks?: number;
  /** The right edge. Defaults to today. */
  endDate?: Date;
};

/**
 * Whole days from `a` to `b`. Rounded because a daylight-saving change makes
 * one day 23 or 25 hours long, and a floor would lose it.
 */
function daysBetween(a: string, b: string): number {
  return Math.round((fromDateKey(b).getTime() - fromDateKey(a).getTime()) / DAY_MS);
}

function addDays(key: string, days: number): string {
  const date = fromDateKey(key);
  return toDateKey(
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + days),
  );
}

/**
 * Pairs each measurement with the mean of every measurement in the
 * `TREND_DAYS` calendar days ending on it.
 *
 * The window is counted in days, not in entries: weighing in three times one
 * week and then not for a month, "the last three entries" would average
 * weights from different months as if they were back to back. A measurement
 * with nothing else in its window is its own average.
 */
export function withTrend<T extends WeightPoint>(
  oldestFirst: readonly T[],
  days = TREND_DAYS,
): (T & { trend: number })[] {
  let from = 0;
  let sum = 0;
  return oldestFirst.map((entry, index) => {
    sum += entry.weight_kg;
    while (daysBetween(oldestFirst[from].measured_on, entry.measured_on) >= days) {
      sum -= oldestFirst[from].weight_kg;
      from++;
    }
    return { ...entry, trend: sum / (index - from + 1) };
  });
}

/**
 * The kg range and its gridlines: the data plus the target, widened to
 * `MIN_SPAN_KG`, padded so no point sits on the frame, and snapped outwards
 * to a round step so the labels read 78 · 80 · 82 and not 78.37.
 */
export function yScale(values: readonly number[]): {
  min: number;
  max: number;
  ticks: number[];
} {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < MIN_SPAN_KG) {
    const middle = (lo + hi) / 2;
    lo = middle - MIN_SPAN_KG / 2;
    hi = middle + MIN_SPAN_KG / 2;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;

  // The last step always fits: nothing in 20–400 kg spans more than 200.
  const step =
    STEPS.find(
      (s) => Math.ceil(hi / s) - Math.floor(lo / s) <= MAX_TICK_GAPS,
    ) ?? STEPS[STEPS.length - 1];
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  // Built from an index, not by adding `step` up: 0.5 is exact in binary,
  // but a running sum is still the habit that ends in 80.49999.
  for (let i = 0; min + i * step <= max + 1e-9; i++) ticks.push(min + i * step);
  return { min, max, ticks };
}

/**
 * Everything the chart draws, or null when no measurement falls inside the
 * window.
 *
 * `newestFirst` is the order `useWeightEntries` returns. Entries older than
 * the window still feed the trend, so its first value on screen is the real
 * average and not one that starts cold at the left edge.
 *
 * The x axis runs by date, not by index: a month without weighing in is a
 * gap you can see. It covers the first measurement inside the window through
 * today, so two weeks without a measurement show up as empty space on the
 * right — and it starts at that measurement, not at the window's edge, or
 * someone who started last week would get their whole history squeezed into
 * the last few pixels.
 *
 * A history shorter than `MIN_SPAN_DAYS` is centred: the missing days are
 * split half before the first measurement and half after today, which puts
 * days that haven't happened yet on the right. The padding shrinks as the
 * history grows and is zero from `MIN_SPAN_DAYS` on, so the day the
 * threshold is crossed nothing jumps.
 */
export function buildWeightChart(
  newestFirst: readonly WeightPoint[],
  target: number | null,
  options: WeightChartOptions = {},
): WeightChart | null {
  const weeks = options.weeks ?? 26;
  const today = toDateKey(options.endDate ?? new Date());
  const windowStart = addDays(today, -(weeks * 7 - 1));

  const series = withTrend([...newestFirst].reverse());
  const visible = series.filter(
    (entry) => entry.measured_on >= windowStart && entry.measured_on <= today,
  );
  if (!visible.length) return null;

  const first = visible[0].measured_on;
  const history = daysBetween(first, today);
  const spanDays = Math.max(history, MIN_SPAN_DAYS - 1);
  // Half the missing days on each side. It can be a half day, which is what
  // centres an odd gap exactly; the axis ends round it outwards.
  const pad = (spanDays - history) / 2;
  const start = addDays(first, -Math.floor(pad));
  const end = addDays(today, Math.ceil(pad));

  const kgValues = visible.flatMap((entry) => [entry.weight_kg, entry.trend]);
  if (target !== null) kgValues.push(target);
  const scale = yScale(kgValues);

  // Coordinates to a tenth: enough for a 320-wide drawing, and short paths.
  const x = (date: string) =>
    round1(
      PLOT.left + ((daysBetween(first, date) + pad) / spanDays) * (PLOT.right - PLOT.left),
    );
  const y = (kg: number) =>
    round1(
      PLOT.bottom - ((kg - scale.min) / (scale.max - scale.min)) * (PLOT.bottom - PLOT.top),
    );

  const points = visible.map((entry) => ({
    date: entry.measured_on,
    kg: entry.weight_kg,
    trend: entry.trend,
    x: x(entry.measured_on),
    y: y(entry.weight_kg),
    trendY: y(entry.trend),
  }));

  const trendPath = points
    .map((point, index) => `${index ? "L" : "M"}${point.x} ${point.trendY}`)
    .join(" ");

  const months: { date: string; x: number }[] = [];
  // Every 1st of a month from `start` to `end`, `start` included when it is
  // one. `setMonth(m, 1)` pins the day, or January 31st plus a month would
  // overflow into March.
  const cursor = fromDateKey(start);
  if (cursor.getDate() !== 1) cursor.setMonth(cursor.getMonth() + 1, 1);
  for (; toDateKey(cursor) <= end; cursor.setMonth(cursor.getMonth() + 1, 1)) {
    const key = toDateKey(cursor);
    const at = x(key);
    if (at <= PLOT.right - MONTH_LABEL_ROOM) months.push({ date: key, x: at });
  }
  const monthly = months.length >= 2;

  return {
    plot: PLOT,
    start,
    end,
    today,
    points,
    trendPath,
    target: target === null ? null : { kg: target, y: y(target) },
    yTicks: scale.ticks.map((kg) => ({ kg, y: y(kg) })),
    xTicks: monthly
      ? months
      : [...new Set([first, today])].map((date) => ({ date, x: x(date) })),
    xTickFormat: monthly ? "month" : "day",
  };
}
