import { useMemo } from "react";
import { Link } from "react-router";
import { Skeleton, SkeletonGroup } from "../../components/skeleton";
import { fromDateKey, toDateKey } from "../../lib/heatmap";
import { useBodyProfile, useWeightEntries } from "./queries";
import { formatKg } from "./weight";
import {
  buildWeightChart,
  CHART_HEIGHT,
  CHART_WIDTH,
  TREND_DAYS,
  type WeightChart as Chart,
} from "./weight-trend";

/**
 * The weight curve, drawn by hand in SVG.
 *
 * No chart library (PLAN.md, Phase 5.3): Recharts or Chart.js would add
 * 150–400 KB to draw a polyline, and none of it would travel to the widget.
 * Every coordinate comes from `weight-trend.ts`; this file does no maths.
 *
 * The SVG has a fixed `viewBox` and stretches to the card's width, so there
 * is nothing to measure. Lines keep their thickness while scaling thanks to
 * `vector-effect`, and the text scales with the rest, which at phone widths
 * is roughly 1:1.
 *
 * As in the list, nothing is coloured as good or bad: whether the curve going
 * up is progress depends on the goal.
 */

const MONTH_FORMATTER = new Intl.DateTimeFormat("es", { month: "short" });
const DAY_FORMATTER = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
});

function formatMonth(date: string): string {
  return MONTH_FORMATTER.format(fromDateKey(date)).replace(".", "");
}

function formatDay(date: string): string {
  return DAY_FORMATTER.format(fromDateKey(date)).replace(".", "");
}

/** What a screen reader gets instead of the drawing. */
function describe(chart: Chart): string {
  const first = chart.points[0];
  const last = chart.points[chart.points.length - 1];
  const range =
    first === last
      ? `Peso ${formatKg(last.kg)} kg el ${formatDay(last.date)}.`
      : `Peso de ${formatKg(first.kg)} a ${formatKg(last.kg)} kg entre el ${formatDay(
          first.date,
        )} y el ${formatDay(last.date)}.`;
  return chart.target
    ? `${range} Meta ${formatKg(chart.target.kg)} kg.`
    : range;
}

function Drawing({ chart }: { chart: Chart }) {
  const { plot } = chart;
  return (
    <svg
      className="mt-3 block w-full overflow-visible"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-label={describe(chart)}
    >
      <g className="text-[9px]" aria-hidden="true">
        {chart.yTicks.map((tick) => (
          <g key={tick.kg}>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={tick.y}
              y2={tick.y}
              className="stroke-line"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={plot.left - 5}
              y={tick.y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted tnum"
            >
              {formatKg(tick.kg)}
            </text>
          </g>
        ))}

        {chart.xTicks.map((tick) => (
          <text
            key={tick.date}
            x={tick.x}
            y={CHART_HEIGHT - 4}
            // Months start at their gridline, like the heatmap's; the dates
            // of a short range sit centred under the point they name.
            textAnchor={chart.xTickFormat === "day" ? "middle" : "start"}
            className="fill-muted"
          >
            {chart.xTickFormat === "month"
              ? formatMonth(tick.date)
              : tick.date === chart.today
                ? "hoy"
                : formatDay(tick.date)}
          </text>
        ))}
      </g>

      {chart.target ? (
        <line
          x1={plot.left}
          x2={plot.right}
          y1={chart.target.y}
          y2={chart.target.y}
          className="stroke-muted"
          strokeWidth={1.25}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}

      {chart.points.map((point) => (
        <circle
          key={point.date}
          cx={point.x}
          cy={point.y}
          r={2.25}
          className="fill-accent"
          opacity={0.35}
        >
          <title>{`${formatDay(point.date)}: ${formatKg(point.kg)} kg`}</title>
        </circle>
      ))}

      <path
        d={chart.trendPath}
        fill="none"
        className="stroke-accent"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function WeightChart({ weeks }: { weeks?: number }) {
  const { data: entries, isPending } = useWeightEntries();
  // A profile that fails to load costs the target line, not the chart.
  const { data: profile } = useBodyProfile();
  const target = profile?.target_weight_kg ?? null;

  // Keyed on the date, not the instant: the chart only changes at midnight.
  const today = toDateKey(new Date());
  const chart = useMemo(
    () =>
      entries?.length
        ? buildWeightChart(entries, target, { weeks, endDate: fromDateKey(today) })
        : null,
    [entries, target, weeks, today],
  );

  if (isPending) {
    return (
      <SkeletonGroup className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Evolución</h2>
        <Skeleton className="mt-3 aspect-[2/1] w-full" />
      </SkeletonGroup>
    );
  }

  // No measurements at all: the log below already says so, with the form.
  if (!entries?.length) return null;

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Evolución</h2>
        <span className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 rounded bg-accent" />
            Media {TREND_DAYS} días
          </span>
          {chart?.target ? (
            <span className="flex items-center gap-1">
              <span className="w-3 border-t border-dashed border-muted" />
              Meta
            </span>
          ) : null}
        </span>
      </div>

      {!chart ? (
        <p className="mt-4 text-sm text-muted">
          No anotaste ningún peso en las últimas {weeks ?? 26} semanas.
        </p>
      ) : (
        <>
          <Drawing chart={chart} />

          {chart.points.length === 1 ? (
            <p className="mt-2 text-xs text-muted">
              Con un peso más ya se ve la curva.
            </p>
          ) : null}

          {/* The target lives in Perfil; this is the way back, as the energy
              card links here for a missing weight. `undefined` is a profile
              still loading or failed, which shouldn't nag. */}
          {profile !== undefined && target === null ? (
            <Link
              to="/perfil"
              className="mt-2 inline-block text-xs font-medium text-accent"
            >
              Poné un peso objetivo para ver la meta
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}
