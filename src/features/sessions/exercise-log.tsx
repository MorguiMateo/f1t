import { useRef } from "react";
import { ExerciseLine } from "../routines/exercise-line";
import type { ExercisePlan, PlannedSet } from "./plan";
import { suggestFor } from "./plan";
import { useLogSet, useUnlogSet } from "./queries";

/**
 * Uncontrolled inputs: ticking with suggested values is the single-tap case.
 * Controlling them would re-sync on every React Query invalidation.
 */

// `session_sets.weight_kg` is numeric(6,2).
const MAX_WEIGHT = 9999.99;
const MAX_REPS = 999;

/** Accepts comma or dot: the Spanish iOS numeric keyboard gives a comma. */
function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function parseReps(raw: string): number | null {
  const value = parseNumber(raw);
  if (value === null) return null;
  return Math.min(MAX_REPS, Math.max(0, Math.round(value)));
}

function parseWeight(raw: string): number | null {
  const value = parseNumber(raw);
  if (value === null) return null;
  // Two decimals: any more won't fit the column, and Postgres rounding would
  // hand back a different number than the one on screen.
  return Math.min(MAX_WEIGHT, Math.max(0, Math.round(value * 100) / 100));
}

const FIELD_CLASS =
  "w-full rounded-lg border border-line bg-surface-2 px-2 py-2 text-center text-sm tabular-nums placeholder:text-muted/70";

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

  const log = useLogSet();
  const unlog = useUnlogSet();
  const isBusy = log.isPending || unlog.isPending;

  const suggested = suggestFor(set, plan.targetReps);
  const isDone = set.done !== null;

  function save() {
    log.mutate({
      sessionId,
      performedOn,
      routineDayId,
      exerciseId: plan.exerciseId,
      setIndex: set.setIndex,
      reps: parseReps(repsRef.current?.value ?? ""),
      weightKg: parseWeight(weightRef.current?.value ?? ""),
    });
  }

  function toggle() {
    if (set.done) {
      unlog.mutate(set.done.id);
      return;
    }
    save();
  }

  function saveIfDone() {
    if (isDone) save();
  }

  return (
    <li className="flex items-center gap-2">
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
          // Keyed on the stored value so the input remounts with it after a
          // save or untick instead of keeping what was typed.
          key={`reps-${set.done?.reps ?? "none"}`}
          defaultValue={suggested.reps ?? ""}
          placeholder="reps"
          onBlur={saveIfDone}
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
          key={`kg-${set.done?.weight_kg ?? "none"}`}
          defaultValue={suggested.weightKg ?? ""}
          placeholder="kg"
          onBlur={saveIfDone}
          className={FIELD_CLASS}
        />
      </label>

      {/* The only large control: it's tapped on every set, hands full. */}
      <button
        type="button"
        onClick={toggle}
        disabled={isBusy}
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
