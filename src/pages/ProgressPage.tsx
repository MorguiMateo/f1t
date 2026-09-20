import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { ErrorNote, LoadingNote } from "../components/Status";
import { Heatmap } from "../features/sessions/Heatmap";
import { useSessionDays } from "../features/sessions/queries";
import { WIDGET_WEEKS } from "../features/sessions/widget";
import { currentStreak } from "../lib/heatmap";

/**
 * El calendario de actividad y lo poco que se puede decir con él.
 *
 * Las mismas 26 semanas que el widget mediano de iOS: no es casualidad, es
 * la constante `WIDGET_WEEKS` compartida. Si acá se ve medio año, en la
 * pantalla de inicio del teléfono también, y las dos pintan el mismo array.
 *
 * El peso y su gráfico llegan en la Fase 5.
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
    </>
  );
}
