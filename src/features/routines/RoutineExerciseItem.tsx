import type { FocusEvent } from "react";
import { Button } from "../../components/Button";
import type { RoutineExercise } from "./api";
import { ExerciseLine } from "./ExerciseLine";
import { useRemoveExercise, useSwapExercises, useUpdateExercise } from "./queries";

/**
 * Una fila editable del día: objetivo, orden y borrado.
 *
 * Los dos campos se guardan al salir del input, sin botón de guardar. En un
 * teléfono, poner "12" y tocar otra cosa es el gesto natural; un botón de
 * guardar por fila multiplica los toques y deja el estado a medio confirmar
 * cuando el usuario se olvida.
 *
 * Los inputs no son controlados: el valor vive en el DOM y solo se manda lo
 * que cambió. Controlarlos obligaría a re-sincronizar con lo que devuelve la
 * invalidación de React Query, y ahí es donde aparecen los inputs que se
 * borran solos mientras escribís.
 */

/** El check de la base es 1..50; se ajusta acá para no rebotar el update. */
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
        // Texto que no es número: se descarta y el input vuelve a lo guardado.
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
    // Texto libre a propósito: "8-12", "al fallo" y "30 s" son objetivos
    // legítimos y ninguno entra en un número.
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
