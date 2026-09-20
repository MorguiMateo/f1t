import type { FocusEvent } from "react";
import { Button } from "../../components/button";
import type { RoutineExercise } from "./api";
import { ExerciseLine } from "./exercise-line";
import { useRemoveExercise, useSwapExercises, useUpdateExercise } from "./queries";

/**
 * An editable row within a day: target, order and removal.
 *
 * Both fields save on blur, with no save button. On a phone, typing "12" and
 * tapping something else is the natural gesture; a save button per row
 * multiplies the taps and leaves state half-confirmed when the user forgets.
 *
 * The inputs are uncontrolled: the value lives in the DOM and only what
 * changed gets sent. Controlling them would force a re-sync against whatever
 * React Query's invalidation returns, and that is where fields that clear
 * themselves as you type come from.
 */

/** The database check is 1..50; clamped here so the update isn't bounced. */
const MAX_SETS = 50;

export function RoutineExerciseItem({
  item,
  previous,
  next,
}: {
  item: RoutineExercise;
  previous?: RoutineExercise;
  next?: RoutineExercise;
}) {
  const update = useUpdateExercise();
  const remove = useRemoveExercise();
  const swap = useSwapExercises();

  const isBusy = update.isPending || remove.isPending || swap.isPending;

  function saveSets(event: FocusEvent<HTMLInputElement>) {
    const raw = event.target.value.trim();
    let value: number | null = null;

    if (raw !== "") {
      const parsed = Math.round(Number(raw));
      if (!Number.isFinite(parsed)) {
        // Text that isn't a number: discarded, and the input reverts to what
        // was stored.
        event.target.value = item.target_sets?.toString() ?? "";
        return;
      }
      value = Math.min(MAX_SETS, Math.max(1, parsed));
      event.target.value = value.toString();
    }

    if (value === item.target_sets) return;
    update.mutate({ id: item.id, patch: { target_sets: value } });
  }

  function saveReps(event: FocusEvent<HTMLInputElement>) {
    // Free text on purpose: "8-12", "al fallo" and "30 s" are all legitimate
    // targets and none of them fits in a number.
    const value = event.target.value.trim() || null;
    if (value === item.target_reps) return;
    update.mutate({ id: item.id, patch: { target_reps: value } });
  }

  const inputClass =
    "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm placeholder:text-muted tnum";

  return (
    <li className="rounded-xl border border-line bg-surface p-2.5">
      <ExerciseLine
        exerciseId={item.exercise_id}
        targetSets={item.target_sets}
        targetReps={item.target_reps}
      >
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            aria-label="Subir"
            disabled={!previous || isBusy}
            onClick={() =>
              previous &&
              swap.mutate({
                a: { id: item.id, position: item.position },
                b: { id: previous.id, position: previous.position },
              })
            }
          >
            ↑
          </Button>
          <Button
            size="sm"
            aria-label="Bajar"
            disabled={!next || isBusy}
            onClick={() =>
              next &&
              swap.mutate({
                a: { id: item.id, position: item.position },
                b: { id: next.id, position: next.position },
              })
            }
          >
            ↓
          </Button>
          <Button
            size="sm"
            variant="danger"
            aria-label="Quitar del día"
            disabled={isBusy}
            onClick={() => remove.mutate(item.id)}
          >
            ✕
          </Button>
        </div>
      </ExerciseLine>

      <div className="mt-2 flex gap-2">
        <label className="flex-1">
          <span className="sr-only">Series objetivo</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_SETS}
            defaultValue={item.target_sets ?? ""}
            onBlur={saveSets}
            placeholder="Series"
            className={inputClass}
          />
        </label>
        <label className="flex-2">
          <span className="sr-only">Repeticiones objetivo</span>
          <input
            type="text"
            defaultValue={item.target_reps ?? ""}
            onBlur={saveReps}
            placeholder="Reps (8-12)"
            maxLength={24}
            className={inputClass}
          />
        </label>
      </div>
    </li>
  );
}
