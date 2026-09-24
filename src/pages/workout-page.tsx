import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "../components/button";
import { ConfirmButton } from "../components/confirm-button";
import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/page-header";
import { Skeleton, SkeletonGroup } from "../components/skeleton";
import { ErrorNote } from "../components/status";
import { ExerciseLineSkeleton } from "../features/routines/exercise-line-skeleton";
import { useActiveRoutine } from "../features/routines/queries";
import { dayForWeekday, todayWeekday } from "../features/routines/weekdays";
import { today } from "../features/sessions/api";
import { ExerciseLog } from "../features/sessions/exercise-log";
import { planWorkout, progressLabel, workoutTotals } from "../features/sessions/plan";
import {
  useDeleteSession,
  usePreviousSession,
  useSessionForDate,
} from "../features/sessions/queries";

/** A few `ExerciseLog` cards: the exercise and its rows of sets. */
function WorkoutSkeleton() {
  return (
    <SkeletonGroup>
      <ul className="flex flex-col gap-2">
        {[0, 1, 2].map((index) => (
          <li key={index} className="rounded-xl border border-line bg-surface p-2.5">
            <ExerciseLineSkeleton />
            <div className="mt-2 flex flex-col gap-1.5">
              {[0, 1, 2].map((set) => (
                <Skeleton key={set} className="h-9.5 rounded-lg" />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </SkeletonGroup>
  );
}

/**
 * Logging today's workout.
 *
 * It is a screen with its own URL and not a block inside Today for two
 * reasons: Today is the index route and putting the catalog here — needed for
 * each exercise's photo and name — would weigh it down, and because training
 * and checking what's on are two different moments. The phone's back gesture
 * leaves the workout without losing anything: everything is saved set by set.
 *
 * `?dia=` allows training a day that isn't today's, which is what happens
 * when the week slips: Tuesday is Legs but it got done on Wednesday. Without
 * the parameter, it is the day the active routine marks for today.
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
  // `isLoading` and not `isPending` for the previous session: with no day the
  // query is disabled, and a disabled query stays `pending` forever. Waiting
  // for it is the right call anyway: the rows have to appear with the
  // suggested weight already in them, because an input that fills itself in a
  // second later overwrites whatever was being typed.
  const isPending =
    routineQuery.isPending || sessionQuery.isPending || previousQuery.isLoading;
  const error = routineQuery.error ?? sessionQuery.error;

  const plans = planWorkout({
    items: day?.exercises ?? [],
    logged: session?.sets ?? [],
    previous: previousQuery.data?.sets ?? [],
  });

  const totals = workoutTotals(plans);

  if (isPending) {
    return (
      <>
        <PageHeader title="Entrenar" onBack={() => navigate(-1)} />
        <WorkoutSkeleton />
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
              // With no session yet, the first set ticked creates it.
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

      {/* There is no "save" button: each set is already in the database the
          moment it was ticked. Finishing is simply going back. */}
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
