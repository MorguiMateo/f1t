import { Suspense, lazy } from "react";
import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { ErrorNote, LoadingNote } from "../components/Status";
import { useActiveRoutine } from "../features/routines/queries";
import {
  dayForWeekday,
  nextTrainingDay,
  todayWeekday,
  whenLabel,
} from "../features/routines/weekdays";

/**
 * El bloque con los ejercicios se carga aparte porque necesita el catálogo
 * —foto y nombre de cada ejercicio— y esta es la ruta índice: importarlo de
 * forma estática metería `catalog.json` en el chunk inicial de toda la app,
 * que es justo lo que se evitó en la Fase 2. El header se pinta enseguida y
 * la lista aparece mientras todavía se está esperando a Supabase.
 */
const TodayWorkout = lazy(() =>
  import("../features/routines/TodayWorkout").then((m) => ({
    default: m.TodayWorkout,
  })),
);

const FORMATTER = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function TodayPage() {
  const { data: routine, isPending, error } = useActiveRoutine();

  const today = FORMATTER.format(new Date());
  const weekday = todayWeekday();
  const day = routine ? dayForWeekday(routine.days, weekday) : null;
  const next = routine ? nextTrainingDay(routine.days, weekday) : null;

  return (
    <>
      <PageHeader
        title="Hoy"
        subtitle={today.charAt(0).toUpperCase() + today.slice(1)}
      />

      {isPending ? <LoadingNote /> : null}
      {error ? <ErrorNote error={error} /> : null}

      {/* Sin rutina activa hay dos casos distintos: no hay ninguna rutina, o
          hay rutinas pero ninguna marcada como activa. El texto es el mismo
          pero el camino a seguir no, y los dos terminan en /rutinas. */}
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

      {/* Un día sin fila en routine_days es descanso: es el modelo de datos
          hablando, no un estado de error. */}
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
        </div>
      ) : null}

      {routine && day ? (
        <p className="mt-4 text-center text-xs text-muted">
          Registrar series, reps y peso llega en la Fase 4.
        </p>
      ) : null}
    </>
  );
}
