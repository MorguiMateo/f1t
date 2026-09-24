import { describe, expect, it } from "vitest";
import { fromDateKey } from "../../lib/heatmap";
import {
  buildWeightChart,
  MIN_SPAN_KG,
  withTrend,
  yScale,
} from "./weight-trend";

const entry = (measured_on: string, weight_kg: number) => ({
  measured_on,
  weight_kg,
});

const TODAY = fromDateKey("2026-09-24");

describe("withTrend", () => {
  it("averages the measurements of the last seven calendar days", () => {
    const rows = withTrend([
      entry("2026-09-20", 80),
      entry("2026-09-22", 81),
      entry("2026-09-24", 82),
    ]);
    expect(rows.map((row) => row.trend)).toEqual([80, 80.5, 81]);
  });

  it("counts the window in days, not in entries", () => {
    // Seven days after the first weigh-in it has left the window.
    const rows = withTrend([
      entry("2026-09-01", 90),
      entry("2026-09-08", 80),
    ]);
    expect(rows[1].trend).toBe(80);
  });

  it("keeps a measurement six days back inside the window", () => {
    const rows = withTrend([
      entry("2026-09-02", 90),
      entry("2026-09-08", 80),
    ]);
    expect(rows[1].trend).toBe(85);
  });

  it("leaves a lone measurement as its own average", () => {
    expect(withTrend([entry("2026-09-24", 79.4)])[0].trend).toBe(79.4);
  });
});

describe("yScale", () => {
  it("widens a flat series to the minimum span", () => {
    const { min, max } = yScale([80, 80.2, 79.9]);
    expect(max - min).toBeGreaterThanOrEqual(MIN_SPAN_KG);
  });

  it("snaps to round gridlines that contain every value", () => {
    const { min, max, ticks } = yScale([78.3, 83.7]);
    expect(min).toBeLessThanOrEqual(78.3);
    expect(max).toBeGreaterThanOrEqual(83.7);
    expect(ticks.every((tick) => Number.isInteger(tick))).toBe(true);
    expect(ticks.length).toBeLessThanOrEqual(6);
  });

  it("uses a coarser step for a wide range", () => {
    const { ticks } = yScale([60, 95]);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks[1] - ticks[0]).toBe(10);
  });
});

describe("buildWeightChart", () => {
  const series = [
    entry("2026-09-24", 80),
    entry("2026-08-20", 82),
    entry("2026-07-15", 84),
  ];

  it("has nothing to draw with no measurement in the window", () => {
    expect(buildWeightChart([], null, { endDate: TODAY })).toBeNull();
    expect(
      buildWeightChart([entry("2025-01-10", 80)], null, { endDate: TODAY }),
    ).toBeNull();
  });

  it("orders the points oldest to newest, left to right", () => {
    const chart = buildWeightChart(series, null, { endDate: TODAY })!;
    expect(chart.points.map((point) => point.date)).toEqual([
      "2026-07-15",
      "2026-08-20",
      "2026-09-24",
    ]);
    const xs = chart.points.map((point) => point.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("starts at the first measurement and ends today", () => {
    const chart = buildWeightChart(series, null, { endDate: TODAY })!;
    expect(chart.start).toBe("2026-07-15");
    expect(chart.end).toBe("2026-09-24");
    expect(chart.points[0].x).toBe(chart.plot.left);
    expect(chart.points[2].x).toBe(chart.plot.right);
  });

  it("places points by date, so a gap in weigh-ins is a gap on screen", () => {
    const chart = buildWeightChart(
      [entry("2026-09-24", 80), entry("2026-09-23", 80), entry("2026-08-01", 81)],
      null,
      { endDate: TODAY },
    )!;
    const [a, b, c] = chart.points.map((point) => point.x);
    expect(b - a).toBeGreaterThan((c - b) * 10);
  });

  const middle = (chart: { plot: { left: number; right: number } }) =>
    (chart.plot.left + chart.plot.right) / 2;

  it("centres a short history inside two weeks", () => {
    const chart = buildWeightChart(
      [entry("2026-09-24", 80), entry("2026-09-22", 81)],
      null,
      { endDate: TODAY },
    )!;
    expect(chart.start).toBe("2026-09-17");
    expect(chart.end).toBe("2026-09-30");
    expect(chart.today).toBe("2026-09-24");
    const [a, b] = chart.points.map((point) => point.x);
    expect((a + b) / 2).toBeCloseTo(middle(chart), 0);
  });

  it("puts a single weigh-in today in the exact middle", () => {
    const chart = buildWeightChart([entry("2026-09-24", 80)], null, {
      endDate: TODAY,
    })!;
    expect(chart.points[0].x).toBeCloseTo(middle(chart), 1);
  });

  it("stops centring once the history spans two weeks", () => {
    const chart = buildWeightChart(
      [entry("2026-09-24", 80), entry("2026-09-11", 81)],
      null,
      { endDate: TODAY },
    )!;
    expect(chart.start).toBe("2026-09-11");
    expect(chart.end).toBe("2026-09-24");
    expect(chart.points[0].x).toBe(chart.plot.left);
    expect(chart.points[1].x).toBe(chart.plot.right);
  });

  it("keeps the days since the last weigh-in, centring up to today", () => {
    const chart = buildWeightChart([entry("2026-09-20", 80)], null, {
      endDate: TODAY,
    })!;
    // The 20th through the 24th is what gets centred, so the point sits left
    // of the middle by two days' worth.
    expect(chart.points[0].x).toBeLessThan(middle(chart));
  });

  it("drops what falls outside the window but still averages it in", () => {
    const chart = buildWeightChart(
      // One week back from the 24th starts on the 18th.
      [entry("2026-09-18", 80), entry("2026-09-17", 90)],
      null,
      { endDate: TODAY, weeks: 1 },
    )!;
    expect(chart.points).toHaveLength(1);
    expect(chart.points[0].trend).toBe(85);
  });

  it("keeps the target inside the scale, even far from the data", () => {
    const chart = buildWeightChart(series, 65, { endDate: TODAY })!;
    expect(chart.target?.kg).toBe(65);
    expect(chart.target!.y).toBeLessThanOrEqual(chart.plot.bottom);
    expect(chart.target!.y).toBeGreaterThanOrEqual(chart.plot.top);
  });

  it("draws no target line without a target", () => {
    expect(buildWeightChart(series, null, { endDate: TODAY })!.target).toBeNull();
  });

  it("draws the trend as one path through every point", () => {
    const chart = buildWeightChart(series, null, { endDate: TODAY })!;
    expect(chart.trendPath.match(/[ML]/g)).toEqual(["M", "L", "L"]);
  });

  it("labels months when the range crosses two, and the data's ends otherwise", () => {
    const long = buildWeightChart(series, null, { endDate: TODAY })!;
    expect(long.xTickFormat).toBe("month");
    expect(long.xTicks.map((tick) => tick.date)).toEqual([
      "2026-08-01",
      "2026-09-01",
    ]);

    const fromFirst = buildWeightChart(
      [entry("2026-09-24", 80), entry("2026-07-01", 84)],
      null,
      { endDate: TODAY },
    )!;
    expect(fromFirst.xTicks.map((tick) => tick.date)).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);

    const short = buildWeightChart(
      [entry("2026-09-24", 80), entry("2026-09-22", 81)],
      null,
      { endDate: TODAY },
    )!;
    expect(short.xTickFormat).toBe("day");
    expect(short.xTicks.map((tick) => tick.date)).toEqual([
      "2026-09-22",
      "2026-09-24",
    ]);
    expect(short.xTicks.map((tick) => tick.x)).toEqual(
      short.points.map((point) => point.x),
    );

    const single = buildWeightChart([entry("2026-09-24", 80)], null, {
      endDate: TODAY,
    })!;
    expect(single.xTicks.map((tick) => tick.date)).toEqual(["2026-09-24"]);
  });
});
