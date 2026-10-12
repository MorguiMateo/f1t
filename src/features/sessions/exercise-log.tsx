import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../components/button";
import { WorkoutExerciseImage } from "../exercises/workout-exercise-image";
import { getExercise } from "../exercises/catalog";
import { ExerciseLine } from "../routines/exercise-line";
import type { ExercisePlan, PlannedSet } from "./plan";
import { useLogSet, useUnlogSet } from "./queries";
import type { RoutineExerciseWeight } from "./remember-weight";
import {
  createWorkoutSetRegistry,
  shouldQueueBlurSave,
  setInputError,
  suggestSetValues,
  type ExerciseLogWriteState,
  type SavedSet,
  type SetValues,
  type WorkoutSetRegistry,
} from "./set-editor";

/** Uncontrolled inputs keep active drafts through query refetches and writes. */

const FIELD_CLASS =
  "min-h-11 w-full rounded-lg border border-line bg-surface-2 px-2 py-2 text-center text-sm tabular-nums placeholder:text-muted/70";

function savedFrom(set: PlannedSet["done"]): SavedSet | null {
  return set
    ? { id: set.id, values: { reps: set.reps, weightKg: set.weight_kg } }
    : null;
}

type CurrentActions = {
  sessionId: string | null;
  performedOn: string;
  routineDayId: string | null;
  exerciseId: string;
  routineExercise: RoutineExerciseWeight | null;
  setIndex: number;
  log: ReturnType<typeof useLogSet>["mutateAsync"];
  unlog: ReturnType<typeof useUnlogSet>["mutateAsync"];
  weightWarning: (message: string | null) => void;
};

async function writeSet(current: CurrentActions, values: SetValues): Promise<SavedSet> {
  const result = await current.log({
    sessionId: current.sessionId,
    performedOn: current.performedOn,
    routineDayId: current.routineDayId,
    exerciseId: current.exerciseId,
    routineExercise: current.routineExercise,
    setIndex: current.setIndex,
    reps: values.reps,
    weightKg: values.weightKg,
  });
  current.weightWarning(result.defaultWeightError ?? null);
  return savedFrom(result)!;
}

function SetRow({
  set,
  plan,
  sessionId,
  performedOn,
  routineDayId,
  editorRegistry,
  scope,
  onNewSet,
  rememberRoutineWeight,
}: {
  set: PlannedSet;
  plan: ExercisePlan;
  sessionId: string | null;
  performedOn: string;
  routineDayId: string | null;
  editorRegistry: WorkoutSetRegistry;
  scope: string;
  onNewSet: (index: number, moveFocus: boolean) => void;
  rememberRoutineWeight: boolean;
}) {
  const repsRef = useRef<HTMLInputElement>(null);
  const feedbackId = useId();
  const exerciseName = getExercise(plan.exerciseId)?.name ?? plan.exerciseId.replaceAll("_", " ");
  const weightRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const skipBlurRef = useRef(false);
  const mountedRef = useRef(false);
  const callbacksRef = useRef({ onNewSet });
  useEffect(() => {
    callbacksRef.current = { onNewSet };
  }, [onNewSet]);

  const log = useLogSet();
  const unlog = useUnlogSet();
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The editor survives query invalidations; a refetch never remounts inputs
  // or replaces a draft being typed.
  const suggested = suggestSetValues(set, plan);
  const routineExercise = rememberRoutineWeight && !plan.id.startsWith("recorded:") ? { id: plan.id, targetWeightKg: plan.targetWeightKg } : null;
  const [lifecycle] = useState(() => {
    return editorRegistry.row(scope, set.setIndex, savedFrom(set.done), suggested, {
      log: async (values) => savedFrom(await log.mutateAsync({
        sessionId, performedOn, routineDayId, exerciseId: plan.exerciseId,
        routineExercise,
        setIndex: set.setIndex, reps: values.reps, weightKg: values.weightKg,
      }))!,
      unlog: unlog.mutateAsync,
    });
  });
  const snapshot = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot, lifecycle.getSnapshot);
  const busyCount = snapshot.pending;
  const failure = snapshot.failure;
  const weightWarning = snapshot.warning;
  const editor = lifecycle.editor;
  const currentActions: CurrentActions = {
    sessionId,
    performedOn,
    routineDayId,
    exerciseId: plan.exerciseId,
    routineExercise,
    setIndex: set.setIndex,
    log: log.mutateAsync,
    unlog: unlog.mutateAsync,
    weightWarning: lifecycle.setWarning,
  };

  useEffect(() => {
    editor.setActions({
      log: (values) => writeSet(currentActions, values),
      unlog: (id) => currentActions.unlog(id),
    });
  });

  useEffect(() => {
    if (busyCount === 0) lifecycle.reconcile(savedFrom(set.done));
  }, [lifecycle, set.done, busyCount]);

  const isDone = snapshot.saved !== null;
  const hasDraft = snapshot.dirty.reps || snapshot.dirty.weight;

  // A learned default may arrive mid-workout. Only untouched, unfocused inputs
  // adopt it; a draft (even an explicitly cleared field) always wins.
  useEffect(() => {
    const document = repsRef.current?.ownerDocument;
    const focused = document?.activeElement === repsRef.current ? "reps" :
      document?.activeElement === weightRef.current ? "weight" : null;
    lifecycle.adoptSuggestions({ reps: suggested.reps, weightKg: suggested.weightKg }, focused);
  }, [lifecycle, suggested.reps, suggested.weightKg, busyCount]);

  useEffect(() => {
    if (repsRef.current) repsRef.current.value = snapshot.repsText;
    if (weightRef.current) weightRef.current.value = snapshot.weightText;
  }, [snapshot.repsText, snapshot.weightText]);

  function validatedValues(advance = false): SetValues | null {
    return lifecycle.validate(advance);
  }

  async function run(operation: "log" | "unlog", values?: SetValues, advance = false) {
    const activeAtStart = toggleRef.current?.ownerDocument.activeElement;
    try {
      const result = await lifecycle.run(operation, values, advance);
      if (result.isNew && result.advance && result.ownsFeedback && result.ownsDraft && mountedRef.current) {
        callbacksRef.current.onNewSet(set.setIndex,
          toggleRef.current?.ownerDocument.activeElement === activeAtStart && lifecycle.getSnapshot().pending === 0);
      }
    } catch { /* The shared lifecycle retains the error and retry draft. */ }
  }

  function register() {
    if (editor.isPending) return;
    const values = validatedValues(true);
    if (values) void run("log", values, true);
  }

  function saveIfDone(relatedTarget: EventTarget | null) {
    if (skipBlurRef.current || relatedTarget === toggleRef.current) {
      skipBlurRef.current = false;
      return;
    }
    const { dirty, requiresConfirmation } = lifecycle.getSnapshot();
    // Recovery is an unsent proposal, not permission to retry on focus/blur.
    // This remains manual even if the user edits the recovered correction.
    if (requiresConfirmation) return;
    if (!dirty.reps && !dirty.weight) return;
    if (!editor.saved && !editor.hasPendingLog) return;
    if (editor.hasPendingUnlog) return;
    const values = validatedValues();
    if (!values) return;
    if (shouldQueueBlurSave(editor, values)) {
      void run("log", values);
    } else if (!editor.isPending) lifecycle.discard();
  }

  return (
    <li data-set-index={set.setIndex}>
      <div className="flex items-center gap-2">
        <span className="w-4 shrink-0 text-xs text-muted tnum">
          {set.setIndex + 1}
        </span>

        <label className="flex-1">
          <span className="sr-only">{exerciseName}: repeticiones de la serie {set.setIndex + 1}</span>
          <input
            ref={repsRef}
            // Text, not `type="number"`, in both fields: a number input reports
            // "82,5" as "" in Safari, so ticking the set wiped its weight.
            type="text"
            inputMode="numeric"
            maxLength={128}
            aria-describedby={feedbackId}
            aria-invalid={Boolean(failure?.operation === "log" && setInputError(snapshot.repsText, snapshot.weightText, !isDone)?.includes("epeticiones"))}
            disabled={editor.hasPendingUnlog}
            defaultValue={snapshot.repsText}
            placeholder="reps"
            onChange={(event) => {
              lifecycle.edit("reps", event.currentTarget.value);
            }}
            onBlur={(event) => saveIfDone(event.relatedTarget)}
            enterKeyHint="next"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                weightRef.current?.focus();
              }
            }}
            className={FIELD_CLASS}
          />
        </label>

        <span className="shrink-0 text-xs text-muted">×</span>

        <label className="flex-1">
          <span className="sr-only">{exerciseName}: carga en kilos de la serie {set.setIndex + 1}</span>
          <input
            ref={weightRef}
            type="text"
            inputMode="decimal"
            maxLength={128}
            aria-describedby={feedbackId}
            aria-invalid={Boolean(failure?.operation === "log" && setInputError(snapshot.repsText, snapshot.weightText, !isDone)?.startsWith("Carga"))}
            disabled={editor.hasPendingUnlog}
            defaultValue={snapshot.weightText}
            placeholder="kg"
            onChange={(event) => {
              lifecycle.edit("weight", event.currentTarget.value);
            }}
            onBlur={(event) => saveIfDone(event.relatedTarget)}
            enterKeyHint="done"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                register();
              }
            }}
            className={FIELD_CLASS}
          />
        </label>

        {/* The only large control: it's tapped on every set, hands full. */}
        <button
          ref={toggleRef}
          type="button"
          onPointerDownCapture={() => {
            skipBlurRef.current = true;
          }}
          onClick={() => {
            skipBlurRef.current = false;
            if (editor.isPending) return;
            if (editor.saved && hasDraft) {
              const values = validatedValues();
              if (values) void run("log", values);
            } else if (editor.saved) void run("unlog");
            else register();
          }}
          disabled={busyCount > 0}
          aria-pressed={isDone}
          aria-label={
            isDone && hasDraft
              ? `Guardar cambios de la serie ${set.setIndex + 1}`
              : isDone
              ? `Desmarcar la serie ${set.setIndex + 1}`
              : `Registrar serie ${set.setIndex + 1}`
          }
          className={[
            "flex size-11 shrink-0 items-center justify-center rounded-lg border text-base font-semibold transition-colors disabled:opacity-50",
            isDone
              ? "border-accent bg-accent text-accent-ink"
              : "border-line-strong bg-surface text-muted",
          ].join(" ")}
        >
          {hasDraft && isDone ? "↑" : "✓"}
        </button>
      </div>
      <div id={feedbackId} className="mt-1 flex flex-wrap items-center justify-between gap-x-2 pl-6 text-xs text-muted">
        <span>{busyCount ? "Guardando…" : hasDraft ? (isDone ? "Cambios sin registrar" : "Borrador · no registrado") : isDone ? "Serie registrada" : "Sugerencia · no registrada"}</span>
        {(hasDraft || failure) && !busyCount ? (
          <Button size="sm" className="min-h-11" onPointerDownCapture={() => { skipBlurRef.current = true; }}
            onClick={() => { skipBlurRef.current = false; lifecycle.discard(); }}>
            {failure?.operation === "unlog" ? "Cancelar desmarcado" : "Descartar borrador"}
          </Button>
        ) : null}
      </div>
      {weightWarning ? <p className="mt-1 pl-6 text-xs text-warn" role="alert">{weightWarning}</p> : null}
      {failure ? (
        <div className="mt-1 pl-6 text-xs text-warn" role="alert">
          <p>
            {exerciseName} · Serie {set.setIndex + 1}: {failure.operation === "log"
              ? "No se guardó la serie."
              : "No se pudo desmarcar la serie."}{" "}
            {failure.error instanceof Error ? failure.error.message : String(failure.error)}
          </p>
          <Button
            size="sm"
            disabled={busyCount > 0}
            className="min-h-11"
            onClick={() => {
              if (editor.isPending) return;
              if (failure.operation === "unlog") void run("unlog");
              else {
                const values = validatedValues(failure.advance);
                if (values) void run("log", values, failure.advance);
              }
            }}
          >
            Reintentar
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function ExerciseLog({
  plan,
  sessionId,
  performedOn,
  routineDayId,
  onWriteStateChange,
  onNewSet,
  editorRegistry: suppliedRegistry,
  rememberRoutineWeight = true,
}: {
  plan: ExercisePlan;
  sessionId: string | null;
  performedOn: string;
  routineDayId: string | null;
  onWriteStateChange?: (state: ExerciseLogWriteState) => void;
  onNewSet?: (setIndex: number) => void;
  editorRegistry?: WorkoutSetRegistry;
  rememberRoutineWeight?: boolean;
}) {
  const goal = plan.targetSets ?? plan.sets.length;
  const listRef = useRef<HTMLUListElement>(null);
  const [localRegistry] = useState(createWorkoutSetRegistry);
  const editorRegistry = suppliedRegistry ?? localRegistry;
  const scope = JSON.stringify([performedOn, routineDayId, plan.exerciseId]);
  const callbacksRef = useRef({ onWriteStateChange, onNewSet });
  useEffect(() => {
    callbacksRef.current = { onWriteStateChange, onNewSet };
  }, [onWriteStateChange, onNewSet]);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    // Keep the callback's owning date/day. This card can be reused for a new
    // scope while an old detached operation is still settling.
    editorRegistry.observe(scope, (state) => onWriteStateChange?.(state));
  }, [editorRegistry, scope, onWriteStateChange]);

  useEffect(() => {
    if (!restEndsAt) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((restEndsAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) setRestEndsAt(null);
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [restEndsAt]);

  function recordedSet(index: number, moveFocus: boolean) {
    // An end date remains accurate when the browser is backgrounded.
    setRestEndsAt(Date.now() + 120_000);
    setRemaining(120);
    const next = plan.sets.find((set) =>
      set.setIndex > index && set.setIndex < goal && !set.done,
    );
    if (next && moveFocus) {
      listRef.current?.querySelector<HTMLButtonElement>(`[data-set-index="${next.setIndex}"] button[aria-pressed]`)?.focus();
    }
    callbacksRef.current.onNewSet?.(index);
  }

  return (
    <li className="rounded-xl border border-line bg-surface p-2.5">
      <ExerciseLine
        exerciseId={plan.exerciseId}
        targetSets={plan.targetSets}
        targetReps={plan.targetReps}
        targetWeightKg={plan.targetWeightKg}
      >
        <span
          className={[
            "shrink-0 text-xs tnum",
            plan.doneCount >= goal && goal > 0 ? "text-ok" : "text-muted",
          ].join(" ")}
        >
          {plan.doneCount}/{goal}
        </span>
      </ExerciseLine>

      <WorkoutExerciseImage exerciseId={plan.exerciseId} />

      <div className="mt-2 flex min-h-11 flex-wrap items-center justify-between gap-2 text-sm">
          <span className="tnum" role="timer" aria-label="Tiempo de descanso">
            {restEndsAt ? `Descanso · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "Descanso · 2 min al registrar"}
          </span>
          <Button size="sm" className="min-h-11" disabled={!restEndsAt} onClick={() => setRestEndsAt(null)}>Omitir descanso</Button>
      </div>

      <p className="mt-2 text-xs text-muted">Repeticiones × carga (kg). Confirmá cada serie con ✓; una sugerencia no cuenta como registrada.</p>

      <ul ref={listRef} className="mt-2 flex flex-col gap-1.5">
        {plan.sets.map((set) => (
          <SetRow
            key={`${scope}:${set.setIndex}`}
            set={set}
            plan={plan}
            sessionId={sessionId}
            performedOn={performedOn}
            routineDayId={routineDayId}
            editorRegistry={editorRegistry}
            scope={scope}
            onNewSet={recordedSet}
            rememberRoutineWeight={rememberRoutineWeight}
          />
        ))}
      </ul>
    </li>
  );
}
