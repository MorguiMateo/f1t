import { Suspense, lazy } from "react";
import { Link } from "react-router";
import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/page-header";
import { SkeletonGroup, SkeletonLine } from "../components/skeleton";
import { ErrorNote } from "../components/status";
import { StepsToday } from "../features/activity/steps-today";
import { useFoodDay } from "../features/foods/queries";
import { useLocalToday } from "../features/foods/local-today";
import { fromDateKey } from "../lib/heatmap";
import { useActiveRoutine } from "../features/routines/queries";
import { nextTrainingDay, todayWeekday, whenLabel } from "../features/routines/weekdays";
import { useSessionForDate } from "../features/sessions/queries";
import { selectTodayDay, todayWorkoutProgress } from "./today-selection";

// Keep exercise catalog/images out of the initial Today chunk.
const TodayWorkout = lazy(() => import("../features/routines/today-workout").then((m) => ({ default: m.TodayWorkout })));

function TodayWorkoutSkeleton() {
  return (
    <SkeletonGroup className="rounded-xl border border-line bg-surface p-5">
      <SkeletonLine className="w-28 text-lg" />
      <SkeletonLine className="mt-2 w-40 text-sm" />
      <SkeletonLine className="mt-4 h-12 w-full rounded-xl" />
    </SkeletonGroup>
  );
}

const FORMATTER = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" });
const KCAL = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const PRIMARY = "mt-4 block min-h-12 rounded-xl border border-accent bg-accent px-5 py-3 text-center text-sm font-medium text-accent-ink transition-opacity hover:opacity-90";

export function TodayFoodSummary({ date }: { date: string }) {
  const { data, isPending, error, refetch, isFetching } = useFoodDay(date);
  // Only saved entry calories and this date's stored snapshot; never recompute energy here.
  const intake = data?.entries.reduce((total, entry) => total + entry.kcal, 0) ?? 0;
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-5" aria-label="Comidas de hoy">
      <h2 className="font-semibold">Comidas de hoy</h2>
      {isPending ? <p className="mt-2 text-sm text-muted">Consultando registros…</p> : data ? <>
        <p className="mt-2 font-semibold tnum">{KCAL.format(intake)} kcal registradas</p>
        <p className="mt-1 text-sm text-muted">{data.day?.target_kcal != null
          ? `Objetivo de hoy: ${KCAL.format(data.day.target_kcal)} kcal`
          : data.day ? "Este día se registró sin objetivo calculable."
            : "El objetivo se fija al registrar la primera comida."}</p>
        {error ? <p className="mt-2 text-xs text-muted">Últimos registros disponibles; no se pudieron actualizar.</p> : null}
      </> : null}
      {error && !data ? <>
        <p className="mt-2 text-sm text-muted">No se pudieron consultar las comidas.</p>
        <button type="button" className="mt-1 min-h-11 text-sm text-accent disabled:opacity-50" disabled={isFetching} onClick={() => { void refetch(); }}>Reintentar</button>
      </> : null}
      <Link to="/comidas" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent">{data?.entries.length ? "Ver o registrar comidas" : "Registrar comida"}</Link>
    </section>
  );
}

export function TodayPage() {
  const todayKey = useLocalToday();
  const now = fromDateKey(todayKey);
  const routineQuery = useActiveRoutine();
  const sessionQuery = useSessionForDate(todayKey);
  const routine = routineQuery.data;
  const session = sessionQuery.data;
  const waiting = (routineQuery.isPending && !routine) || (sessionQuery.isPending && session === undefined);
  const error = (routine === undefined ? routineQuery.error : null) ?? (session === undefined ? sessionQuery.error : null);
  const weekday = todayWeekday(now);
  const day = selectTodayDay(routine?.days ?? [], weekday, session);
  const next = routine ? nextTrainingDay(routine.days, weekday) : null;
  const progress = day ? todayWorkoutProgress(day, session?.sets ?? []) : null;
  const today = FORMATTER.format(now);

  return (
    <>
      <PageHeader title="Hoy" subtitle={today.charAt(0).toUpperCase() + today.slice(1)} />
      {waiting ? <TodayWorkoutSkeleton /> : error ? <>
        <ErrorNote error={error} title="No se pudo consultar el entrenamiento de hoy" />
        <button type="button" className="min-h-11 text-sm text-accent" onClick={() => { void routineQuery.refetch(); void sessionQuery.refetch(); }}>Reintentar</button>
      </> : <>
        {session && !day ? (
          <EmptyState title="Ya hay un entrenamiento registrado hoy" description="Su día no está disponible en la rutina activa. Tus series siguen guardadas; revisalas en Progreso." action={<Link to="/progreso" className="text-sm font-medium text-accent">Revisar registros</Link>} />
        ) : !routine ? (
          <EmptyState title="Todavía no hay rutina activa" description="Armá una rutina, asignale días de la semana y acá va a aparecer lo que te toca entrenar." action={<Link to="/rutinas" className="text-sm font-medium text-accent">Ir a mis rutinas</Link>} />
        ) : !routine.days.length ? (
          <EmptyState title={`"${routine.name}" no tiene días`} description="Elegí en qué días de la semana entrenás y qué toca en cada uno." action={<Link to={`/rutinas/${routine.id}`} className="text-sm font-medium text-accent">Armar la semana</Link>} />
        ) : day ? (
          <section className="rounded-xl border border-line bg-surface p-5" aria-label="Entrenamiento de hoy">
            <h2 className="text-lg font-semibold">{day.label}</h2>
            {day.exercises.length ? <>
              <p className="mt-1 text-sm text-muted tnum">{day.exercises.length} {day.exercises.length === 1 ? "ejercicio" : "ejercicios"} · {progress?.planned} series previstas</p>
              {session ? <p className="mt-2 text-sm tnum">{progress?.finished ? "Todas las series previstas registradas" : `${progress?.completed} de ${progress?.planned} series previstas registradas`}</p> : null}
              <Link to={`/entrenar?dia=${encodeURIComponent(day.id)}`} className={PRIMARY}>{progress?.finished ? "Revisar entrenamiento" : session?.sets.length ? "Retomar entrenamiento" : "Empezar entrenamiento"}</Link>
            </> : null}
            <Suspense fallback={<p className="mt-3 text-sm text-muted">Cargando detalle del plan…</p>}><TodayWorkout day={day} routineId={routine.id} /></Suspense>
          </section>
        ) : (
          <section className="rounded-xl border border-line bg-surface p-5 text-center">
            <h2 className="text-lg font-semibold">Hoy toca descansar</h2>
            <p className="mx-auto mt-1 max-w-[34ch] text-sm text-muted">{next ? `Lo próximo es ${next.day.label}, ${whenLabel(next.inDays, next.day.weekday)}.` : "No hay más días cargados en esta rutina."}</p>
            {next ? <Link to={`/entrenar?dia=${encodeURIComponent(next.day.id)}`} className="mt-4 block min-h-11 rounded-xl border border-line bg-surface-2 px-5 py-3 text-sm font-medium">Entrenar {next.day.label} igual</Link> : null}
            <Link to={`/rutinas/${routine.id}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent">Ver la rutina</Link>
          </section>
        )}
        {routineQuery.error || sessionQuery.error ? <p className="mt-2 text-xs text-muted">Mostrando los últimos datos disponibles. No se pudieron actualizar.</p> : null}
      </>}
      <TodayFoodSummary date={todayKey} />
      <StepsToday />
    </>
  );
}
