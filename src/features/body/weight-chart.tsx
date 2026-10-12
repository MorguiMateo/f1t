import { chartSampleCount, hasWeightGaps } from "./weight-context";
import { useMemo } from "react";
import { Link } from "react-router";
import { Skeleton, SkeletonGroup } from "../../components/skeleton";
import { fromDateKey, toDateKey } from "../../lib/heatmap";
import { useBodyProfile, useWeightEntries } from "./queries";
import { formatDelta, formatKg } from "./weight";
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
      <g className="text-[12px]" aria-hidden="true">
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
        d={chart.points.map((point, index) => `${index > 0 && !hasWeightGaps([chart.points[index - 1].date, point.date]) ? "L" : "M"}${point.x} ${point.trendY}`).join(" ")}
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
        <h2 className="font-semibold">Evolución del peso</h2>
        <Skeleton className="mt-3 aspect-[2/1] w-full" />
      </SkeletonGroup>
    );
  }

  // No measurements at all: the log below already says so, with the form.
  if (!entries?.length) return null;

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Evolución del peso</h2>
        {chart ? <span className="text-xs text-muted">{formatDay(chart.points.at(-1)!.date)}</span> : null}
      </div>

      {!chart ? (
        <p className="mt-4 text-sm text-muted">
          No anotaste ningún peso en las últimas {weeks ?? 26} semanas.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-2xl font-bold tnum">{formatKg(chart.points.at(-1)!.kg)} <span className="text-sm font-normal text-muted">kg</span></p>
            {chart.points.length > 1 ? (
              <p className="text-xs text-muted tnum">
                {formatDelta(chart.points.at(-1)!.kg - chart.points[0].kg)} kg desde {formatDay(chart.points[0].date)}
              </p>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-muted">{formatDay(chart.points[0].date)} – {formatDay(chart.points.at(-1)!.date)} · {chart.points.length} {chart.points.length === 1 ? "medición" : "mediciones"} en las últimas {weeks ?? 26} semanas</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted" aria-label="Leyenda del peso">
            <span>● Peso registrado</span><span>━ Media {TREND_DAYS} días</span>{chart.target ? <span>┄ Meta {formatKg(chart.target.kg)} kg</span> : null}
          </div>
          <Drawing chart={chart} />
          <p className="mt-2 text-sm text-muted tnum">Media {TREND_DAYS} días · {formatKg(chart.points.at(-1)!.trend)} kg · {chartSampleCount(entries ?? [], chart.points.at(-1)!.date)} mediciones disponibles</p>
          {chartSampleCount(entries ?? [], chart.points.at(-1)!.date) < 2 ? <p className="mt-2 text-sm text-muted">La media actual tiene una sola medición; todavía no permite distinguir una tendencia.</p> : null}
          {hasWeightGaps(chart.points.map((point) => point.date)) ? <p className="mt-2 text-sm text-muted">Hay intervalos de más de 7 días sin registros. No se midió el peso entre los puntos.</p> : null}
          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer content-center text-sm text-muted">Detalle de la curva</summary>
            <p className="text-xs text-muted">Puntos: pesos registrados. Línea: promedio de los registros disponibles en {TREND_DAYS} días.</p>
            {chart.target ? (
              <p className="mt-2 text-xs text-muted tnum">Línea discontinua: meta {formatKg(chart.target.kg)} kg.</p>
            ) : profile !== undefined && target === null ? (
              <Link to="/perfil#objetivo-corporal" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent">Definir meta en Perfil</Link>
            ) : null}
            <table className="mt-3 w-full text-left text-sm tnum"><caption className="text-left font-medium">Valores de la curva</caption><thead><tr><th scope="col" className="py-2">Fecha</th><th scope="col">Peso (kg)</th><th scope="col">Media (kg)</th></tr></thead><tbody>{chart.points.slice(-12).reverse().map((point) => <tr key={point.date}><th scope="row" className="py-2 font-normal">{fromDateKey(point.date).toLocaleDateString("es")}</th><td>{formatKg(point.kg)}</td><td>{formatKg(point.trend)}</td></tr>)}</tbody></table>
            <p className="mt-2 text-sm text-muted">Últimas 12 mediciones de la curva; el historial completo está en Peso.</p>
          </details>
        </>
      )}
    </section>
  );
}
