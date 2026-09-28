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
 * The heatmap's 26 weeks are the same as the medium iOS widget: not a
 * coincidence, it is the shared `WIDGET_WEEKS` constant. If half a year shows
 * here, half a year shows on the phone's home screen too, and both paint the
 * same array.
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

  const streak = days ? currentStreak(days) : 0;
  const trained = days?.length ?? 0;
  const sets = days?.reduce((total, day) => total + day.set_count, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Progreso"
        subtitle="Tu actividad, tu peso y tu evolución"
      />

      {isPending ? <ActivitySkeleton /> : null}
      {error ? <ErrorNote error={error} /> : null}

      {days && !days.length ? (
        // Scoped to the activity: the weight sections below still show.
        <EmptyState
          title="Todavía no entrenaste"
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

      {/* The weight sections stand on their own queries, so they show even
          for an account that has never trained. The chart hides itself until
          there is a first weight; the log is where that weight gets typed. */}
      <div className="mt-4 space-y-4">
        <WeightChart weeks={WIDGET_WEEKS} />
        <WeightLog />
      </div>
    </>
  );
}
