import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/button";
import { ExerciseLine } from "../routines/exercise-line";
import type { ExercisePlan, PlannedSet } from "./plan";
import { suggestFor } from "./plan";
import { useLogSet, useUnlogSet } from "./queries";
import {
  createSetEditor,
  parseReps,
  parseWeight,
  shouldQueueBlurSave,
  type SavedSet,
  type SetValues,
} from "./set-editor";

/** Uncontrolled inputs keep active drafts through query refetches and writes. */

const FIELD_CLASS =
  "w-full rounded-lg border border-line bg-surface-2 px-2 py-2 text-center text-sm tabular-nums placeholder:text-muted/70";

function savedFrom(set: PlannedSet["done"]): SavedSet | null {
  return set
    ? { id: set.id, values: { reps: set.reps, weightKg: set.weight_kg } }
    : null;
}

type FailedWrite = { operation: "log" | "unlog"; error: unknown };

type CurrentActions = {
  sessionId: string | null;
  performedOn: string;
  routineDayId: string | null;
  exerciseId: string;
  setIndex: number;
  log: ReturnType<typeof useLogSet>["mutateAsync"];
  unlog: ReturnType<typeof useUnlogSet>["mutateAsync"];
};

async function writeSet(current: CurrentActions, values: SetValues): Promise<SavedSet> {
  const result = await current.log({
    sessionId: current.sessionId,
    performedOn: current.performedOn,
    routineDayId: current.routineDayId,
    exerciseId: current.exerciseId,
    setIndex: current.setIndex,
    reps: values.reps,
    weightKg: values.weightKg,
  });
  return savedFrom(result)!;
}

function SetRow({
  set,
  plan,
  sessionId,
  performedOn,
  routineDayId,
}: {
  set: PlannedSet;
  plan: ExercisePlan;
  sessionId: string | null;
  performedOn: string;
  routineDayId: string | null;
}) {
  const repsRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const skipBlurRef = useRef(false);
  const dirtyRef = useRef({ reps: false, weight: false });
  const mountedRef = useRef(false);

  const log = useLogSet();
  const unlog = useUnlogSet();
  const [busyCount, setBusyCount] = useState(0);
  const [failure, setFailure] = useState<FailedWrite | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The editor survives query invalidations; a refetch never remounts inputs
  // or replaces a draft being typed.
  const currentActions: CurrentActions = {
    sessionId,
    performedOn,
    routineDayId,
    exerciseId: plan.exerciseId,
    setIndex: set.setIndex,
    log: log.mutateAsync,
    unlog: unlog.mutateAsync,
  };

  const [editor] = useState(() =>
    createSetEditor(savedFrom(set.done), {
      log: (values) => writeSet(currentActions, values),
      unlog: (id) => currentActions.unlog(id),
    }),
  );

  useEffect(() => {
    editor.setActions({
      log: (values) => writeSet(currentActions, values),
      unlog: (id) => currentActions.unlog(id),
    });
  });

  useEffect(() => {
    if (busyCount === 0) editor.reconcile(savedFrom(set.done));
  }, [editor, set.done, busyCount]);

  const suggested = suggestFor(set, plan.targetReps);
  const isDone = set.done !== null;

  function currentValues(): SetValues {
    return {
      reps: parseReps(repsRef.current?.value ?? ""),
      weightKg: parseWeight(weightRef.current?.value ?? ""),
    };
  }

  async function run(operation: "log" | "unlog", values?: SetValues) {
    const repsAtStart = repsRef.current?.value;
    const weightAtStart = weightRef.current?.value;
    setFailure(null);
    setBusyCount((count) => count + 1);
    try {
      if (operation === "log") {
        const saved = await editor.log(values!);
        // Show the stored rounding/clamp only if no newer draft replaced it.
        const repsInput = repsRef.current;
        const weightInput = weightRef.current;
        if (mountedRef.current && repsInput && repsInput.value === repsAtStart) {
          repsInput.value = saved.values.reps?.toString() ?? "";
          dirtyRef.current.reps = false;
        }
        if (mountedRef.current && weightInput && weightInput.value === weightAtStart) {
          weightInput.value = saved.values.weightKg?.toString() ?? "";
          dirtyRef.current.weight = false;
        }
      } else {
        await editor.unlog();
      }
      if (mountedRef.current) setFailure(null);
    } catch (error) {
      if (mountedRef.current) setFailure({ operation, error });
    } finally {
      if (mountedRef.current) setBusyCount((count) => count - 1);
    }
  }

  function saveIfDone(relatedTarget: EventTarget | null) {
    if (skipBlurRef.current || relatedTarget === toggleRef.current) {
      skipBlurRef.current = false;
      return;
    }
    if (!dirtyRef.current.reps && !dirtyRef.current.weight) return;
    const values = currentValues();
    if (shouldQueueBlurSave(editor, values)) {
      void run("log", values);
    } else if (editor.saved && !editor.hasPendingUnlog) {
      dirtyRef.current.reps = false;
      dirtyRef.current.weight = false;
    }
  }

  return (
    <li>
      <div className="flex items-center gap-2">
        <span className="w-4 shrink-0 text-xs text-muted tnum">
          {set.setIndex + 1}
        </span>

        <label className="flex-1">
          <span className="sr-only">Repeticiones de la serie {set.setIndex + 1}</span>
          <input
            ref={repsRef}
            // Text, not `type="number"`, in both fields: a number input reports
            // "82,5" as "" in Safari, so ticking the set wiped its weight.
            type="text"
            inputMode="numeric"
            disabled={editor.hasPendingUnlog}
            defaultValue={suggested.reps ?? ""}
            placeholder="reps"
            onChange={() => {
              dirtyRef.current.reps = true;
            }}
            onBlur={(event) => saveIfDone(event.relatedTarget)}
            className={FIELD_CLASS}
          />
        </label>

        <span className="shrink-0 text-xs text-muted">×</span>

        <label className="flex-1">
          <span className="sr-only">Peso en kilos de la serie {set.setIndex + 1}</span>
          <input
            ref={weightRef}
            type="text"
            inputMode="decimal"
            disabled={editor.hasPendingUnlog}
            defaultValue={suggested.weightKg ?? ""}
            placeholder="kg"
            onChange={() => {
              dirtyRef.current.weight = true;
            }}
            onBlur={(event) => saveIfDone(event.relatedTarget)}
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
            void run(editor.saved ? "unlog" : "log", currentValues());
          }}
          disabled={busyCount > 0}
          aria-pressed={isDone}
          aria-label={
            isDone
              ? `Desmarcar la serie ${set.setIndex + 1}`
              : `Marcar la serie ${set.setIndex + 1} como hecha`
          }
          className={[
            "flex size-10 shrink-0 items-center justify-center rounded-lg border text-base font-semibold transition-colors disabled:opacity-50",
            isDone
              ? "border-accent bg-accent text-accent-ink"
              : "border-line-strong bg-surface text-muted",
          ].join(" ")}
        >
          ✓
        </button>
      </div>
      {failure ? (
        <div className="mt-1 pl-6 text-xs text-warn" role="alert">
          <p>
            {failure.operation === "log"
              ? "No se guardó la serie."
              : "No se pudo desmarcar la serie."}{" "}
            {failure.error instanceof Error ? failure.error.message : String(failure.error)}
          </p>
          <Button
            size="sm"
            disabled={busyCount > 0}
            onClick={() =>
              void run(
                failure.operation,
                failure.operation === "log" ? currentValues() : undefined,
              )
            }
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
}: {
  plan: ExercisePlan;
  sessionId: string | null;
  performedOn: string;
  routineDayId: string | null;
}) {
  const goal = plan.targetSets ?? plan.sets.length;

  return (
    <li className="rounded-xl border border-line bg-surface p-2.5">
      <ExerciseLine
        exerciseId={plan.exerciseId}
        targetSets={plan.targetSets}
        targetReps={plan.targetReps}
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

      <ul className="mt-2 flex flex-col gap-1.5">
        {plan.sets.map((set) => (
          <SetRow
            key={set.setIndex}
            set={set}
            plan={plan}
            sessionId={sessionId}
            performedOn={performedOn}
            routineDayId={routineDayId}
          />
        ))}
      </ul>
    </li>
  );
}
