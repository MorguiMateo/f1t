import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "../components/Button";
import { ConfirmButton } from "../components/ConfirmButton";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { ErrorNote, LoadingNote } from "../components/Status";
import { useActiveRoutine } from "../features/routines/queries";
import { dayForWeekday, todayWeekday } from "../features/routines/weekdays";
import { today } from "../features/sessions/api";
import { ExerciseLog } from "../features/sessions/ExerciseLog";
import { planWorkout, progressLabel, workoutTotals } from "../features/sessions/plan";
import {
  useDeleteSession,
  usePreviousSession,
  useSessionForDate,
} from "../features/sessions/queries";

/**
 * Registrar el entrenamiento de hoy.
 *
 * Es una pantalla con URL propia y no un bloque dentro de Hoy por dos
 * motivos: Hoy es la ruta índice y meter acá el catálogo —hace falta para la
 * foto y el nombre de cada ejercicio— la volvería pesada, y porque entrenar
 * y ver qué toca son dos momentos distintos. El gesto de volver del teléfono
 * sale del entrenamiento sin perder nada: todo está guardado serie a serie.
 *
 * `?dia=` permite entrenar un día que no es el de hoy, que es lo que pasa
 * cuando se corre la semana: el martes toca Pierna pero se hizo el miércoles.
 * Sin el parámetro, es el día que la rutina activa marca para hoy.
 */
export function WorkoutPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const dayParam = params.get("dia");

  const performedOn = today();
  const routineQuery = useActiveRoutine();
  const routine = routineQuery.data;

  const day = routine
    ? (dayParam
        ? (routine.days.find((d) => d.id === dayParam) ?? null)
        : dayForWeekday(routine.days, todayWeekday()))
    : null;

  const sessionQuery = useSessionForDate(performedOn);
  const previousQuery = usePreviousSession(day?.id, performedOn);
  const deleteSession = useDeleteSession();

  const session = sessionQuery.data ?? null;
  // `isLoading` y no `isPending` para la vez pasada: sin día la query está
  // deshabilitada, y una query deshabilitada se queda en `pending` para
  // siempre. Esperarla igual es lo correcto: las filas tienen que aparecer
  // ya con el peso sugerido, porque un input que se completa solo un
  // segundo después pisa lo que se estaba tecleando.
  const isPending =
    routineQuery.isPending || sessionQuery.isPending || previousQuery.isLoading;
  const error = routineQuery.error ?? sessionQuery.error;

  const plans = planWorkout({
    items: day?.exercises ?? [],
    logged: session?.sets ?? [],
    // Mientras la consulta de la vez pasada viaja, las sugerencias salen del
    // objetivo. Llega y los campos vacíos se completan solos; los que ya se
    // tocaron no, porque el input remonta por `key` y esa no cambió.
    previous: previousQuery.data?.sets ?? [],
  });

  const totals = workoutTotals(plans);

  if (isPending) {
    return (
      <>
        <PageHeader title="Entrenar" onBack={() => navigate(-1)} />
        <LoadingNote />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Entrenar" onBack={() => navigate(-1)} />
        <ErrorNote error={error} />
      </>
    );
  }

  if (!day) {
    return (
      <>
        <PageHeader title="Entrenar" onBack={() => navigate(-1)} />
        <EmptyState
          title="No hay nada que registrar"
          description={
            routine
              ? "Hoy es descanso y no elegiste otro día para entrenar."
              : "Necesitás una rutina activa con días cargados."
          }
          action={
            <Link to="/rutinas" className="text-sm font-medium text-accent">
              Ir a mis rutinas
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={day.label}
        subtitle={
          totals.volumeKg
            ? `${progressLabel(totals)} · ${Math.round(totals.volumeKg)} kg de volumen`
            : progressLabel(totals)
        }
        onBack={() => navigate(-1)}
      />

      {day.exercises.length ? (
        <ul className="flex flex-col gap-2">
          {plans.map((plan) => (
            <ExerciseLog
              key={plan.id}
              plan={plan}
              // Sin sesión todavía, la crea la primera serie que se marque.
              sessionId={session?.id ?? null}
              performedOn={performedOn}
              routineDayId={day.id}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          title={`${day.label} está vacío`}
          description="Agregale ejercicios y después volvé a registrarlos."
          action={
            <Link
              to={`/rutinas/${day.routine_id}/dias/${day.id}`}
              className="text-sm font-medium text-accent"
            >
              Editar el día
            </Link>
          }
        />
      )}

      {/* No hay botón de "guardar": cada serie ya está en la base cuando se
          marcó. Terminar es simplemente volver. */}
      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={() => navigate("/", { replace: true })}
      >
        Terminar
      </Button>

      {session ? (
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Borrar el entrenamiento de hoy quita sus {session.set_count}{" "}
            {session.set_count === 1 ? "serie" : "series"} del calendario.
          </p>
          <ConfirmButton
            label="Borrar"
            confirmLabel="¿Seguro?"
            disabled={deleteSession.isPending}
            className="shrink-0"
            onConfirm={() => deleteSession.mutate(session.id)}
          />
        </div>
      ) : null}
    </>
  );
}
