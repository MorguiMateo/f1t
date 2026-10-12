import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ErrorNote } from "../../components/status";
import { supabase } from "../../lib/supabase";
import { unwrap } from "../../lib/postgrest";
import { fromDateKey, heatmapStart, toDateKey } from "../../lib/heatmap";
import { getExercise } from "../exercises/catalog";
import { exerciseSamples, type ExerciseHistoryRow, type ExerciseMetric, exerciseMetricValue } from "./exercise-trend";

const METRICS: { value: ExerciseMetric; label: string; unit: string; explanation: string }[] = [
  { value: "load", label: "Carga", unit: "kg", explanation: "Carga máxima anotada en una serie de cada sesión. Más carga no implica por sí sola una mejor sesión." },
  { value: "repetitions", label: "Repeticiones", unit: "rep", explanation: "Total de repeticiones anotadas. Si cambia el número de series, la comparación también cambia." },
  { value: "volume", label: "Volumen", unit: "kg × rep", explanation: "Suma de carga × repeticiones. Solo se comparan sesiones con ambos datos en todas las series. No representa calorías." },
];
const number = new Intl.NumberFormat("es", { maximumFractionDigits: 2 });
const name = (id: string) => getExercise(id)?.name ?? id.replaceAll("_", " ");

async function fetchExerciseHistory(since: string): Promise<ExerciseHistoryRow[]> {
  const rows: ExerciseHistoryRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = unwrap(await supabase.from("sessions").select("id, performed_on, session_sets(exercise_id, reps, weight_kg)")
      .gte("performed_on", since).lte("performed_on", toDateKey(new Date())).gt("set_count", 0).order("performed_on", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 499)) ?? [];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

function ExerciseChart({ samples, metric, label, unit }: { samples: ReturnType<typeof exerciseSamples>; metric: ExerciseMetric; label: string; unit: string }) {
  const visible = samples.slice(-12);
  const values = visible.flatMap((sample) => { const value = exerciseMetricValue(sample, metric); return value === null ? [] : [value]; });
  if (values.length < 2) return <p className="mt-3 text-sm text-muted">Se necesitan al menos dos sesiones con datos comparables para mostrar la curva.</p>;
  const lo = Math.min(...values), hi = Math.max(...values), span = Math.max(hi - lo, 1);
  const x = (index: number) => 48 + index / Math.max(visible.length - 1, 1) * 254;
  const y = (value: number) => 146 - (value - lo) / span * 112;
  const path = visible.map((sample, index) => {
    const value = exerciseMetricValue(sample, metric);
    if (value === null) return "";
    const previous = visible[index - 1];
    const command = previous && exerciseMetricValue(previous, metric) !== null ? "L" : "M";
    return `${command}${x(index)} ${y(value)}`;
  }).join(" ");
  return <svg viewBox="0 0 320 180" role="img" aria-label={`${label} (${unit}) por sesión: ${visible.length} sesiones registradas. Valores y fechas en Detalle por fecha.`} className="mt-3 block w-full">
    {[lo, lo + span / 2, lo + span].map((tick) => <g key={tick} aria-hidden="true"><line x1="48" x2="302" y1={y(tick)} y2={y(tick)} className="stroke-line" /><text x="42" y={y(tick)} textAnchor="end" dominantBaseline="middle" className="fill-muted text-[12px]">{number.format(tick)}</text></g>)}
    <path d={path} fill="none" className="stroke-accent" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    {visible.map((sample, index) => { const value = exerciseMetricValue(sample, metric); return value === null ? null : <circle key={sample.id} cx={x(index)} cy={y(value)} r="3" className="fill-accent"><title>{`${fromDateKey(sample.date).toLocaleDateString("es")}: ${number.format(value)} ${unit}`}</title></circle>; })}
    <text x="48" y="174" className="fill-muted text-[12px]" aria-hidden="true">{fromDateKey(visible[0].date).toLocaleDateString("es", { day: "numeric", month: "short" })}</text>
    <text x="302" y="174" textAnchor="end" className="fill-muted text-[12px]" aria-hidden="true">{fromDateKey(visible.at(-1)!.date).toLocaleDateString("es", { day: "numeric", month: "short" })}</text>
  </svg>;
}

export function ExerciseProgress({ selectedExercise }: { selectedExercise: string }) {
  const since = heatmapStart({ weeks: 26 });
  // A descendant of allDays: ordinary set registration invalidates this view too.
  const history = useQuery({ queryKey: ["sessions", "days", since, "exercise-progress"], queryFn: () => fetchExerciseHistory(since) });
  const [selection, setSelection] = useState({ requested: selectedExercise, id: selectedExercise });
  const [metric, setMetric] = useState<ExerciseMetric>("load");
  const ids = [...new Set([...(history.data ?? []).flatMap((row) => row.session_sets.map((set) => set.exercise_id)), ...(selectedExercise ? [selectedExercise] : [])])].sort((a, b) => name(a).localeCompare(name(b), "es"));
  const requested = selection.requested === selectedExercise ? selection.id : selectedExercise;
  const exercise = ids.includes(requested) ? requested : ids[0] ?? "";
  const samples = exerciseSamples(history.data ?? [], exercise);
  const latest = samples.at(-1);
  const previous = samples.at(-2);
  const option = METRICS.find((item) => item.value === metric)!;
  const value = latest ? exerciseMetricValue(latest, metric) : null;
  const previousValue = previous ? exerciseMetricValue(previous, metric) : null;

  return <section className="rounded-xl border border-line bg-surface p-5">
    <h2 className="font-semibold">Evolución por ejercicio</h2>
    <p className="mt-1 text-sm text-muted">Sesiones registradas en las últimas 26 semanas.</p>
    {history.isPending ? <p role="status" className="mt-3 text-sm text-muted">Cargando sesiones…</p> : null}
    {history.error ? <ErrorNote error={history.error} /> : null}
    {!history.isPending && !history.error && !ids.length ? <p className="mt-3 text-sm text-muted">Registrá repeticiones o carga desde Hoy para comparar sesiones.</p> : null}
    {ids.length ? <>
      <label className="mt-4 block text-sm font-medium">Ejercicio
        <select value={exercise} onChange={(event) => setSelection({ requested: selectedExercise, id: event.target.value })} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 py-3">{ids.map((id) => <option key={id} value={id}>{name(id)}</option>)}</select>
      </label>
      <div role="group" aria-label="Medida de evolución" className="mt-3 flex flex-wrap gap-2">{METRICS.map((item) => <button key={item.value} type="button" aria-pressed={metric === item.value} onClick={() => setMetric(item.value)} className={`min-h-11 rounded-xl border px-3 py-2 text-sm ${metric === item.value ? "border-accent bg-accent text-accent-ink" : "border-line"}`}>{item.label}</button>)}</div>
      {latest ? <>
        <p className="mt-4 text-2xl font-bold tnum">{value === null ? "Sin dato comparable" : `${number.format(value)} ${option.unit}`}</p>
        <p className="mt-1 text-sm text-muted">{fromDateKey(latest.date).toLocaleDateString("es")} · {latest.setCount} series{metric === "volume" ? ` · ${latest.volumeSetCount} con carga y repeticiones` : ""}</p>
        <p className="mt-1 text-sm text-muted">{value !== null && previousValue !== null ? `${value - previousValue > 0 ? "+" : ""}${number.format(value - previousValue)} ${option.unit} · sesión anterior` : "Sin comparación disponible"}</p>
        <p className="mt-3 text-sm text-muted">● {option.label} ({option.unit}) · puntos por sesión, no predicciones</p>
        <ExerciseChart samples={samples} metric={metric} label={option.label} unit={option.unit} />
        <details className="mt-3"><summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Detalle por fecha</summary>
          <p className="mb-3 text-sm text-muted">{option.explanation}</p>
          <ul className="divide-y divide-line">{samples.slice(-12).reverse().map((sample) => {
            const sampleValue = exerciseMetricValue(sample, metric);
            return <li key={sample.id} className="py-3"><Link to={`/entrenar?fecha=${encodeURIComponent(sample.date)}`} state={{ section: "/progreso", returnTo: `/progreso?seccion=entrenamiento&ejercicio=${encodeURIComponent(exercise)}` }} className="inline-flex min-h-11 items-center text-sm font-medium text-accent">{fromDateKey(sample.date).toLocaleDateString("es")}</Link><p className="text-sm tnum">{sampleValue === null ? "Sin dato comparable" : `${number.format(sampleValue)} ${option.unit}`} · {sample.setCount} series</p></li>;
          })}</ul>
        </details>
      </> : !history.isPending && !history.error ? <p className="mt-4 text-sm text-muted">Este ejercicio todavía no tiene sesiones registradas en este período.</p> : null}
    </> : null}
  </section>;
}
