import { Suspense, lazy } from "react";
import { Link } from "react-router";
import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/page-header";
import { ErrorNote, LoadingNote } from "../components/status";
import { useActiveRoutine } from "../features/routines/queries";
import {
  dayForWeekday,
  nextTrainingDay,
  todayWeekday,
  whenLabel,
} from "../features/routines/weekdays";
import { useSessionForDate } from "../features/sessions/queries";

/**
 * The block with the exercises loads separately because it needs the catalog
 * — each exercise's photo and name — and this is the index route: importing
 * it statically would drag `catalog.json` into the whole app's initial
 * chunk, which is exactly what Phase 2 avoided. The header paints right away
 * and the list shows up while Supabase is still being waited on.
 */
const TodayWorkout = lazy(() =>
  import("../features/routines/today-workout").then((m) => ({
    default: m.TodayWorkout,
  })),
);

/**
 * Same thing, for the same reason: it builds the `WidgetPayload` names from
 * the catalog. It draws nothing, so its `Suspense` shows nothing.
 */
const WidgetSync = lazy(() =>
  import("../features/sessions/widget-sync").then((m) => ({
    default: m.WidgetSync,
  })),
);

const FORMATTER = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function TodayPage() {
  const { data: routine, isPending, error } = useActiveRoutine();
  const { data: session } = useSessionForDate();

  const today = FORMATTER.format(new Date());
  const weekday = todayWeekday();
  const day = routine ? dayForWeekday(routine.days, weekday) : null;
  const next = routine ? nextTrainingDay(routine.days, weekday) : null;

  const logged = session?.set_count ?? 0;

  return (
    <>
      <PageHeader
        title="Hoy"
        subtitle={today.charAt(0).toUpperCase() + today.slice(1)}
      />

      {isPending ? <LoadingNote /> : null}
      {error ? <ErrorNote error={error} /> : null}

      {/* With no active routine there are two distinct cases: there is no
          routine at all, or there are routines but none marked active. The
          copy is the same but the path forward isn't, and both end in
          /rutinas. */}
      {!isPending && !error && !routine ? (
        <EmptyState
          title="Todavía no hay rutina activa"
          description="Armá una rutina, asignale días de la semana y acá va a aparecer lo que te toca entrenar."
          action={
            <Link to="/rutinas" className="text-sm font-medium text-accent">
              Ir a mis rutinas
            </Link>
          }
        />
      ) : null}

      {routine && !routine.days.length ? (
        <EmptyState
          title={`"${routine.name}" no tiene días`}
          description="Elegí en qué días de la semana entrenás y qué toca en cada uno."
          action={
            <Link
              to={`/rutinas/${routine.id}`}
              className="text-sm font-medium text-accent"
            >
              Armar la semana
            </Link>
          }
        />
      ) : null}

      {routine && routine.days.length && day ? (
        <Suspense fallback={<LoadingNote />}>
          <TodayWorkout day={day} routineId={routine.id} />
        </Suspense>
      ) : null}

      {/* A day with no row in routine_days is a rest day: that is the data
          model talking, not an error state. */}
      {routine && routine.days.length && !day ? (
        <div className="rounded-xl border border-line bg-surface p-5 text-center">
          <p className="text-lg font-semibold">Hoy toca descansar</p>
          <p className="mx-auto mt-1 max-w-[34ch] text-sm text-muted">
            {next
              ? `Lo próximo es ${next.day.label}, ${whenLabel(next.inDays, next.day.weekday)}.`
              : "No hay más días cargados en esta rutina."}
          </p>
          <Link
            to={`/rutinas/${routine.id}`}
            className="mt-3 inline-block text-sm font-medium text-accent"
          >
            Ver la rutina
          </Link>
          {/* Slipping the week by a day is the most common thing that
              happens to a routine, so pulling the next day forward has to be
              one tap and not an edit. */}
          {next ? (
            <Link
              to={`/entrenar?dia=${next.day.id}`}
              className="mt-4 block rounded-xl border border-line bg-surface-2 px-5 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface"
            >
              Entrenar {next.day.label} igual
            </Link>
          ) : null}
        </div>
      ) : null}

      {routine && day?.exercises.length ? (
        <Link
          to="/entrenar"
          className="mt-4 block rounded-xl border border-accent bg-accent px-5 py-3 text-center text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          {logged
            ? `Seguir entrenando · ${logged} ${logged === 1 ? "serie" : "series"}`
            : "Empezar entrenamiento"}
        </Link>
      ) : null}

      {/* Also with no active routine: the heatmap and the streak belong to
          the user, not to the routine, and the widget shows them either
          way. */}
      {!isPending && !error ? (
        <Suspense fallback={null}>
          <WidgetSync day={day} />
        </Suspense>
      ) : null}
    </>
  );
}
