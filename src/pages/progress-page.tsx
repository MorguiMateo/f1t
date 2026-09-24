import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/page-header";
import { ErrorNote, LoadingNote } from "../components/status";
import { WeightLog } from "../features/body/weight-log";
import { Heatmap } from "../features/sessions/heatmap";
import { useSessionDays } from "../features/sessions/queries";
import { WIDGET_WEEKS } from "../features/sessions/widget";
import { currentStreak } from "../lib/heatmap";

/**
 * The activity calendar, the weight log, and the little that can be said with
 * them.
 *
 * The heatmap's 26 weeks are the same as the medium iOS widget: not a
 * coincidence, it is the shared `WIDGET_WEEKS` constant. If half a year shows
 * here, half a year shows on the phone's home screen too, and both paint the
 * same array.
 *
 * The weight chart (Phase 5.3) lands below the log; today the series is the
 * list.
 */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-surface p-4 text-center">
      <p className="text-2xl font-bold tnum">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </div>
  );
}

export function ProgressPage() {
  const { data: days, isPending, error } = useSessionDays();

  const streak = days ? currentStreak(days) : 0;
  const trained = days?.length ?? 0;
  const sets = days?.reduce((total, day) => total + day.set_count, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Progreso"
        subtitle="Tu actividad, tu peso y tu evolución"
      />

      {isPending ? <LoadingNote /> : null}
      {error ? <ErrorNote error={error} /> : null}

      {days && !days.length ? (
        <EmptyState
          title="Nada que mostrar por ahora"
          description="El calendario de actividad se llena solo a medida que registres entrenamientos."
        />
      ) : null}

      {days && days.length ? (
        <>
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Últimas {WIDGET_WEEKS} semanas
            </h2>
            <Heatmap sessions={days} weeks={WIDGET_WEEKS} />
          </section>

          <div className="mt-3 flex gap-2">
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
        </>
      ) : null}

      {/* The weight log stands on its own query, so it shows even for an
          account that has never trained. */}
      <div className="mt-4">
        <WeightLog />
      </div>
    </>
  );
}
