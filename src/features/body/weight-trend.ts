/**
 * Chart geometry without React so its calculations stay testable. A single
 * weigh-in can swing with water and salt, so the trailing-average trend is
 * the line to read.
 */

import { fromDateKey, toDateKey } from "../../lib/heatmap";
import { round1, type WeightPoint } from "./weight";

export const CHART_WIDTH = 320;
export const CHART_HEIGHT = 160;

/** Room for the kg labels on the left and the month labels below. */
const PLOT = { left: 30, right: CHART_WIDTH - 6, top: 10, bottom: CHART_HEIGHT - 18 };

/** Calendar days, the day itself included. */
export const TREND_DAYS = 7;

/**
 * Without it a flat series (80.0, 80.2, 79.9) stretches 0.3 kg of scale
 * noise across the full height.
 */
export const MIN_SPAN_KG = 2;

/**
 * A shorter history is centred, not stretched: two weigh-ins three days apart
 * shouldn't sit at opposite edges.
 */
export const MIN_SPAN_DAYS = 14;

const STEPS = [0.5, 1, 2, 5, 10, 20, 50];

/** More gaps than this and the kg labels crowd. */
const MAX_TICK_GAPS = 5;

/** A month label needs this much room before the right edge, or it clips. */
const MONTH_LABEL_ROOM = 20;

const DAY_MS = 86_400_000;

export type ChartPoint = {
  date: string;
  kg: number;
  trend: number;
  x: number;
  y: number;
  trendY: number;
};

export type WeightChart = {
  plot: typeof PLOT;
  /** `end` is in the future until the history spans `MIN_SPAN_DAYS`. */
  start: string;
  end: string;
  today: string;
  /** Oldest first, only those inside the window. */
  points: ChartPoint[];
  trendPath: string;
  target: { kg: number; y: number } | null;
  yTicks: { kg: number; y: number }[];
  /**
   * Month starts when the range crosses at least two, otherwise the first
   * measurement and today: a lone "sept" says nothing about where it starts.
   */
  xTicks: { date: string; x: number }[];
  xTickFormat: "month" | "day";
};

export type WeightChartOptions = {
  /** Defaults to the heatmap's half year. */
  weeks?: number;
  endDate?: Date;
};

/** Rounded because a DST day is 23 or 25 hours long and a floor would lose it. */
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
 * The window is counted in calendar days, not entries, or sparse weigh-ins
 * from different months would be averaged as if back to back.
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

/** Snapped outwards to a round step so labels read 78 · 80 · 82, not 78.37. */
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
  // Built from an index: a running sum of steps drifts to 80.49999.
  for (let i = 0; min + i * step <= max + 1e-9; i++) ticks.push(min + i * step);
  return { min, max, ticks };
}

/**
 * Entries older than the window still feed the trend, so it doesn't start
 * cold at the left edge. The x axis runs by date so gaps show, from the first
 * visible measurement (not the window's edge, or a new user's history gets
 * squeezed right) through today. Short histories are padded on both sides;
 * the padding reaches zero at `MIN_SPAN_DAYS`, so nothing jumps.
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
  // Can be a half day, which centres an odd gap; the axis ends round it outwards.
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
  // `setMonth(m, 1)` pins the day, or January 31st plus a month overflows
  // into March.
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
