import { type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, UNSAFE_DataRouterContext, useBlocker, useLocation, useNavigate, useSearchParams } from "react-router";
import { Button } from "../components/button";
import { ConfirmButton } from "../components/confirm-button";
import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/page-header";
import { Skeleton, SkeletonGroup } from "../components/skeleton";
import { ErrorNote } from "../components/status";
import { ExerciseLineSkeleton } from "../features/routines/exercise-line-skeleton";
import { useUser } from "../features/auth/session";
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
import { createWorkoutSetRegistry, type ExerciseLogWriteState } from "../features/sessions/set-editor";
import { createWorkoutWriteGuard, installWorkoutUnloadProtection, workoutExitPolicy } from "./workout-write-guard";
import { fromDateKey } from "../lib/heatmap";
import { toDateKey } from "../lib/heatmap";
import { validateInternalDestination } from "../components/navigation";
import { createFrozenWorkoutPlans, includeRecordedExercises, recordedWorkoutDay, useOwnedLoggedDay } from "../features/sessions/workout-context";

function RouterExitProtection({ shouldBlock, onBlocked }: {
  shouldBlock: () => boolean;
  onBlocked: (proceed: () => void, cancel: () => void) => void;
}) {
  const blocker = useBlocker(shouldBlock);
  useEffect(() => {
    if (blocker.state === "blocked") onBlocked(blocker.proceed, blocker.reset);
  }, [blocker.state, blocker.proceed, blocker.reset, onBlocked]);
  return null;
}

function WorkoutExitDialog({ pending, storageError, onStay, onKeep, onDiscard }: {
  pending: boolean;
  storageError: boolean;
  onStay: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); onStay(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-line bg-surface p-5 text-ink backdrop:bg-black/50">
      <h2 id={titleId} className="text-lg font-semibold">Cambios pendientes del entrenamiento</h2>
      <p id={descriptionId} className="mt-2 text-sm text-muted">
        {pending ? "Esperá a que terminen las escrituras. Salir ahora no confirma que se hayan guardado." :
          "Salir no registra los borradores ni desmarca series. Las series ya guardadas se conservan."}
      </p>
      {storageError ? <p role="alert" className="mt-2 text-sm text-warn">No pudimos guardar el borrador en este dispositivo. Permanecé acá para no perderlo.</p> : null}
      <div className="mt-4 flex flex-col gap-2">
        <Button variant="primary" autoFocus onClick={onStay}>Seguir revisando</Button>
        <Button disabled={pending || storageError} onClick={onKeep}>Conservar borradores y salir</Button>
        <Button variant="danger" disabled={pending} onClick={onDiscard}>Descartar borradores y salir</Button>
      </div>
    </dialog>
  );
}

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
 * prompts for unsent changes; only acknowledged writes count as registered.
 *
 * `?dia=` allows training a day that isn't today's, which is what happens
 * when the week slips: Tuesday is Legs but it got done on Wednesday. Without
 * the parameter, it is the day the active routine marks for today.
 */
export function WorkoutPage() {
  const accountId = useUser()?.id ?? null;
  const [params] = useSearchParams();
  // Editor queues, exit confirmations and recovered text never cross accounts.
  return <AccountWorkoutPage key={JSON.stringify([accountId, params.get("fecha"), params.get("dia")])} accountId={accountId} />;
}

function AccountWorkoutPage({ accountId }: { accountId: string | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const [params] = useSearchParams();
  const dayParam = params.get("dia");

  // An open workout keeps its date across midnight and query rerenders.
  const [performedOn] = useState(() => {
    const current = today();
    const requested = params.get("fecha");
    return requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= current && toDateKey(fromDateKey(requested)) === requested ? requested : current;
  });
  const returnTo = validateInternalDestination(location.state?.returnTo) ?? (location.state?.section === "/progreso" ? "/progreso" : "/");
  const routineQuery = useActiveRoutine();
  const routine = routineQuery.data;
  const sessionQuery = useSessionForDate(performedOn);
  const sessionOwnershipError = sessionQuery.data && (sessionQuery.data.user_id !== accountId || sessionQuery.data.performed_on !== performedOn) ? new Error("No pudimos verificar el acceso a este entrenamiento.") : null;
  const session = sessionQuery.data && !sessionOwnershipError ? {
    ...sessionQuery.data, sets: sessionQuery.data.sets.filter(set => set.user_id === accountId && set.session_id === sessionQuery.data!.id),
  } : null;
  const requestedDay = session ? session.routine_day_id : dayParam ?? (routine ? dayForWeekday(routine.days, todayWeekday(fromDateKey(performedOn)))?.id : null);
  const activeDay = routine?.days.find(candidate => candidate.id === requestedDay && candidate.user_id === accountId) ?? null;
  const loggedDayQuery = useOwnedLoggedDay(accountId, session?.routine_day_id && !activeDay ? session.routine_day_id : undefined);
  const [frozenPlans] = useState(() => createFrozenWorkoutPlans(accountId));
  const frozen = requestedDay !== undefined ? frozenPlans.get(performedOn, requestedDay) : null;
  const resolvedDay = activeDay ?? loggedDayQuery.data ?? (session && (session.routine_day_id === null || loggedDayQuery.data === null) ? recordedWorkoutDay(session, accountId!) : null);
  const baseDay = frozen?.day ?? resolvedDay;
  const day = baseDay ? includeRecordedExercises(baseDay, session, accountId!) : null;
  const previousQuery = usePreviousSession(day?.id, performedOn);
  const deleteSession = useDeleteSession();
  const [continueWithoutHistoryFor, setContinueWithoutHistoryFor] =
    useState<string | null>(null);
  const [writeGuard] = useState(() => createWorkoutWriteGuard());
  const [editorRegistry] = useState(() => createWorkoutSetRegistry(accountId));
  const drafts = useSyncExternalStore(editorRegistry.subscribe, editorRegistry.getSnapshot, editorRegistry.getSnapshot);
  const approvedExit = useRef(false);
  const [exitRequest, setExitRequest] = useState<{ proceed: () => void; cancel: () => void; bypass?: boolean } | null>(null);
  const [discardError, setDiscardError] = useState(false);
  const writes = useSyncExternalStore(writeGuard.subscribe, writeGuard.getSnapshot, writeGuard.getSnapshot);
  const workoutScope = JSON.stringify([performedOn, day?.id ?? null]);
  function onWriteStateChange(exerciseId: string, state: ExerciseLogWriteState) {
    if (day && (state.dirty || state.pending || state.failed)) frozenPlans.freeze(performedOn, day, !session || session.set_count === 0);
    // Synchronous tracking also catches input blur immediately before Terminar.
    writeGuard.update(workoutScope, exerciseId, state);
  }
  const writeStatus = writes.get(workoutScope) ?? { pending: 0, failed: 0 };
  const draftDay = day?.id ?? dayParam ?? undefined;
  const localStatus = editorRegistry.workoutStatus(performedOn, draftDay);
  const finishBlocked = Boolean(writeStatus.pending || writeStatus.failed || localStatus.pending || localStatus.failed || deleteSession.isPending);
  function exitPolicy() {
    const current = writeGuard.status(workoutScope);
    const local = editorRegistry.workoutStatus(performedOn, draftDay);
    return workoutExitPolicy({ pending: Boolean(current.pending || local.pending), failed: Boolean(current.failed || local.failed), dirty: Boolean(current.dirty || local.dirty) }, deleteSession.isPending);
  }
  const onBlocked = useCallback((proceed: () => void, cancel: () => void) => setExitRequest({ proceed, cancel }), []);
  function requestLeave(proceed: () => void) {
    if (exitPolicy().needsConfirmation) setExitRequest({ proceed, cancel: () => undefined, bypass: true });
    else proceed();
  }
  useEffect(() => {
    return installWorkoutUnloadProtection(window, () => exitPolicy().needsConfirmation);
  });
  function frame(children: ReactNode) {
    return <>
      {dataRouter ? <RouterExitProtection shouldBlock={() => {
        if (approvedExit.current) { approvedExit.current = false; return false; }
        return exitPolicy().needsConfirmation;
      }} onBlocked={onBlocked} /> : null}
      {children}
      {discardError ? <p role="alert" className="mt-3 text-sm text-warn">No pudimos borrar el borrador del dispositivo. Volvé a intentar; no se borraron series registradas.</p> : null}
      {exitRequest ? <WorkoutExitDialog pending={!exitPolicy().canLeaveWithDraft} storageError={drafts.storageError}
        onStay={() => { exitRequest.cancel(); setExitRequest(null); }}
        onKeep={() => {
          if (!exitPolicy().canLeaveWithDraft || editorRegistry.getSnapshot().storageError) return;
          const proceed = exitRequest.proceed;
          approvedExit.current = Boolean(exitRequest.bypass);
          setExitRequest(null); proceed();
        }}
        onDiscard={() => {
          if (!exitPolicy().canDiscard) return;
          if (!editorRegistry.discardWorkout(performedOn, draftDay)) { setDiscardError(true); return; }
          setDiscardError(false);
          const proceed = exitRequest.proceed;
          approvedExit.current = Boolean(exitRequest.bypass);
          setExitRequest(null); proceed();
        }} /> : null}
    </>;
  }

  // `isLoading` and not `isPending` for the previous session: with no day the
  // query is disabled, and a disabled query stays `pending` forever. Waiting
  // for it is the right call anyway: the rows have to appear with the
  // suggested weight already in them, because an input that fills itself in a
  // second later overwrites whatever was being typed.
  const isPending =
    (routineQuery.isPending && !session && !frozen) || sessionQuery.isPending || (loggedDayQuery.isLoading && !frozen) || previousQuery.isLoading;
  const error =
    sessionOwnershipError ??
    (sessionQuery.data === undefined ? sessionQuery.error : null) ??
    (loggedDayQuery.data === undefined && !frozen ? loggedDayQuery.error : null) ??
    (routineQuery.data === undefined && !day ? routineQuery.error : null);
  const refreshError =
    (routineQuery.data !== undefined ? routineQuery.error : null) ??
    (sessionQuery.data !== undefined ? sessionQuery.error : null) ??
    (frozen || loggedDayQuery.data !== undefined ? loggedDayQuery.error : null);

  const plans = planWorkout({
    items: day?.exercises ?? [],
    logged: session?.sets ?? [],
    previous: previousQuery.data?.sets ?? [],
  });

  const totals = workoutTotals(plans);

  if (isPending) {
    return frame(
      <>
        <PageHeader title="Entrenar" backTo={returnTo} onBeforeBack={requestLeave} />
        <WorkoutSkeleton />
      </>
    );
  }

  if (error) {
    return frame(
      <>
        <PageHeader title="Entrenar" backTo={returnTo} onBeforeBack={requestLeave} />
        <ErrorNote error={error} title="No se pudo cargar el entrenamiento" />
        <Button
          className="mt-3"
          disabled={routineQuery.isFetching || sessionQuery.isFetching}
          onClick={() => {
            const retries = [];
            if (routineQuery.data === undefined && routineQuery.error) retries.push(routineQuery.refetch());
            if (sessionQuery.data === undefined && sessionQuery.error) retries.push(sessionQuery.refetch());
            if (loggedDayQuery.error) retries.push(loggedDayQuery.refetch());
            void Promise.allSettled(retries);
          }}
        >
          {routineQuery.isFetching || sessionQuery.isFetching ? "Reintentando…" : "Reintentar"}
        </Button>
      </>
    );
  }

  if (
    previousQuery.error &&
    previousQuery.data === undefined &&
    day &&
    continueWithoutHistoryFor !== day.id
  ) {
    return frame(
      <>
        <PageHeader title={day.label} backTo={returnTo} onBeforeBack={requestLeave} />
        <ErrorNote
          error={previousQuery.error}
          title="No se pudo cargar el entrenamiento anterior"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() => void previousQuery.refetch()}
            disabled={previousQuery.isFetching}
          >
            {previousQuery.isFetching ? "Reintentando…" : "Reintentar"}
          </Button>
          <Button onClick={() => setContinueWithoutHistoryFor(day.id)}>
            Continuar sin sugerencias
          </Button>
        </div>
      </>
    );
  }

  if (!day) {
    return frame(
      <>
        <PageHeader title="Entrenar" backTo={returnTo} onBeforeBack={requestLeave} />
        <EmptyState
          title="No hay nada que registrar"
          description={
            routine
              ? "Hoy es descanso."
              : "Activá una rutina con ejercicios."
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

  return frame(
    <>
      <PageHeader
        title={day.label}
        subtitle={
          totals.volumeKg
            ? `${progressLabel(totals)} · ${Math.round(totals.volumeKg)} kg de volumen`
            : progressLabel(totals)
        }
        backTo={returnTo} onBeforeBack={requestLeave}
      />

      <p className="mb-4 text-sm text-muted">Entrenamiento del {performedOn.split("-").reverse().join("/")}. Cada serie se registra por separado.</p>
      {frozenPlans.storageError ? <p role="alert" className="mb-4 text-sm text-warn">No pudimos conservar la copia del plan en este dispositivo. Tus borradores y series mantienen sus propios estados de guardado.</p> : null}
      {session && !frozen?.originalKnown ? <p className="mb-4 text-sm text-muted">No hay copia del plan original de esta sesión. Conservamos las series registradas; los objetivos disponibles corresponden a la rutina actual.</p> : frozen ? <p className="mb-4 text-xs text-muted">Plan conservado para este entrenamiento.</p> : null}
      {drafts.storageError ? <p role="alert" className="mb-4 text-sm text-warn">El borrador no pudo guardarse en este dispositivo. No recargues hasta registrar o descartar los cambios.</p> : editorRegistry.workoutStatus(performedOn, day.id).dirty ? <p role="status" className="mb-4 text-sm text-muted">Borradores conservados en este dispositivo · todavía no registrados.</p> : null}

      {refreshError ? (
        <div className="mb-3">
          <ErrorNote
            error={refreshError}
            title="No se pudo actualizar el entrenamiento; conservamos tus datos en pantalla"
          />
        </div>
      ) : null}
      {previousQuery.error && previousQuery.data !== undefined ? (
        <div className="mb-3">
          <ErrorNote
            error={previousQuery.error}
            title="No se pudo actualizar el historial; seguimos con la última sugerencia"
          />
        </div>
      ) : null}

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
              onWriteStateChange={(state) => onWriteStateChange(plan.exerciseId, state)}
              editorRegistry={editorRegistry}
              rememberRoutineWeight={Boolean(activeDay || loggedDayQuery.data)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          title={`${day.label} está vacío`}
          description="Agregá ejercicios desde tu rutina."
          action={day.routine_id && day.id ? (
            <Link
              to={`/rutinas/${day.routine_id}/dias/${day.id}`}
              className="text-sm font-medium text-accent"
            >
              Editar el día
            </Link>
          ) : undefined}
        />
      )}

      {/* Finish never marks incomplete drafts as done, or hides a failed write. */}
      {writeStatus.failed ? (
        <p id="workout-write-status" role="alert" className="mt-4 text-sm text-warn">
          Hay series sin guardar. Reintentá en las series con error antes de terminar.
        </p>
      ) : writeStatus.pending ? (
        <p id="workout-write-status" role="status" className="mt-4 text-sm text-muted">
          Guardando series…
        </p>
      ) : null}
      <Button
        variant="primary"
        className="mt-4 w-full"
        disabled={finishBlocked}
        aria-describedby={writeStatus.pending || writeStatus.failed ? "workout-write-status" : undefined}
        onClick={() => {
          const policy = exitPolicy();
          if (!policy.canLeaveWithDraft || writeGuard.status(workoutScope).failed || editorRegistry.workoutStatus(performedOn, day.id).failed) return;
          requestLeave(() => navigate(returnTo, { replace: true }));
        }}
      >
        Terminar
      </Button>
      {exitPolicy().needsConfirmation ? <Button className="mt-2 w-full" onClick={() => requestLeave(() => navigate(returnTo, { replace: true }))}>Revisar opciones de salida</Button> : null}

      {session ? (
        <div className="mt-6">
          <ConfirmButton
            label={`Quitar ${session.set_count} ${session.set_count === 1 ? "serie" : "series"} del ${performedOn.split("-").reverse().join("/")}`}
            confirmLabel="Quitar series registradas"
            title="Quitar el entrenamiento registrado"
            description={`Se quitarán ${session.set_count} series registradas del ${performedOn.split("-").reverse().join("/")}. Esto no registra ni descarta tus borradores.`}
            disabled={finishBlocked}
            className="shrink-0"
            onConfirm={() => deleteSession.mutate(session.id)}
          />
        </div>
      ) : null}
      {deleteSession.error ? (
        <div className="mt-3">
          <ErrorNote
            error={deleteSession.error}
            title="No se quitó el entrenamiento; volvé a tocar Quitar"
          />
        </div>
      ) : null}
    </>
  );
}
