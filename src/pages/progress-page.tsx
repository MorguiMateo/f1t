import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ExerciseProgress } from "../features/body/exercise-progress";
import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/page-header";
import { Skeleton, SkeletonGroup, SkeletonLine } from "../components/skeleton";
import { ErrorNote } from "../components/status";
import { WeightChart } from "../features/body/weight-chart";
import { WeightLog } from "../features/body/weight-log";
import { Heatmap } from "../features/sessions/heatmap";
import { useSessionDays } from "../features/sessions/queries";
import { WIDGET_WEEKS } from "../features/sessions/widget";
import { currentStreak } from "../lib/heatmap";

/**
 * The activity calendar, the weight log, and the little that can be said with
 * them.
 *
 * The heatmap uses `WIDGET_WEEKS`, the range planned for the future medium iOS
 * widget. Keeping the range shared lets that widget use the same level array.
 *
 * The weight chart reaches back the same half year, so the calendar and the
 * curve below it cover one stretch of time and can be read against each
 * other.
 */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-surface p-4 text-center">
      <p className="text-2xl font-bold tnum">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </div>
  );
}

/**
 * The heatmap card and the three stats. The grid is a single block with its
 * proportions: 26 columns by 7 rows, plus the month labels and the legend.
 */
function ActivitySkeleton() {
  return (
    <SkeletonGroup>
      <div className="rounded-xl border border-line bg-surface p-4">
        <SkeletonLine className="mb-3 w-36 text-sm" />
        <Skeleton className="aspect-[26/8] w-full" />
        <SkeletonLine className="mt-2 ml-auto w-24 text-[0.625rem]" />
      </div>
      <div className="mt-3 flex gap-2">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface p-4"
          >
            <SkeletonLine className="mx-auto w-8 text-2xl" />
            <SkeletonLine className="mx-auto mt-0.5 w-3/4 max-w-16 text-xs" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

export function ProgressPage() {
  const { data: days, isPending, error } = useSessionDays();
  const [params, setParams] = useSearchParams();
  const section = params.get("seccion") === "cuerpo" ? "cuerpo" : "entrenamiento";
  const [focusRequest, setFocusRequest] = useState(0);

  function choose(next: string) {
    const updated = new URLSearchParams(params);
    updated.set("seccion", next); updated.delete("anotar");
    setParams(updated, { replace: true });
  }
  function logWeight() {
    const updated = new URLSearchParams(params); updated.set("seccion", "cuerpo"); updated.set("anotar", "1");
    setParams(updated, { replace: true }); setFocusRequest((value) => value + 1);
  }

  const streak = days ? currentStreak(days) : 0;
  const trained = days?.length ?? 0;
  const sets = days?.reduce((total, day) => total + day.set_count, 0) ?? 0;

  return (
    <>
      <PageHeader title="Progreso" subtitle="Entrenamiento y evolución corporal, por separado" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Tipo de progreso" className="flex gap-2">
          {[ ["entrenamiento", "Entrenamiento"], ["cuerpo", "Cuerpo"] ].map(([value, label]) => <button key={value} type="button" aria-pressed={section === value} onClick={() => choose(value)} className={`min-h-11 rounded-xl border px-4 py-3 text-sm font-medium ${section === value ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface"}`}>{label}</button>)}
        </div>
        <button type="button" onClick={logWeight} className="min-h-11 rounded-xl border border-accent px-4 py-3 text-sm font-medium text-accent">Anotar peso</button>
      </div>
      <div hidden={section !== "entrenamiento"} className="space-y-4">

      {isPending ? <ActivitySkeleton /> : null}
      {error ? <ErrorNote error={error} /> : null}

      {days && !days.length ? (
        // Scoped to the activity: the weight sections below still show.
        <EmptyState
          title="Todavía no entrenaste"
          description="Registrá tu primer entrenamiento desde Hoy."
        />
      ) : null}

      {days && days.length ? (
        <>
          <div className="flex gap-2">
            <Stat
              value={String(streak)}
              label={streak === 1 ? "día de racha" : "días de racha"}
            />
            <Stat
              value={String(trained)}
              label={trained === 1 ? "día entrenado" : "días entrenados"}
            />
            <Stat value={String(sets)} label="series" />
          </div>
          <section className="mt-3 rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-3 flex justify-between gap-2 text-sm font-semibold">
              Actividad
              <span className="font-normal text-muted">{WIDGET_WEEKS} semanas</span>
            </h2>
            <Heatmap sessions={days} weeks={WIDGET_WEEKS} />
          </section>
        </>
      ) : null}

      <ExerciseProgress selectedExercise={params.get("ejercicio") ?? ""} />
      </div>
      <div hidden={section !== "cuerpo"}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Evolución corporal</h2>
          <Link to="/perfil#objetivo-corporal" className="inline-flex min-h-11 items-center text-sm font-medium text-accent">Ver o editar objetivo</Link>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <WeightLog focusRequest={section === "cuerpo" ? focusRequest + (params.get("anotar") === "1" ? 1 : 0) : 0} />
          <WeightChart weeks={WIDGET_WEEKS} />
        </div>
      </div>
    </>
  );
}
