import { useState } from "react";
import { Link } from "react-router";
import { Button } from "../../components/button";
import { ConfirmButton } from "../../components/confirm-button";
import { ErrorNote } from "../../components/status";
import { getExercise } from "../exercises/catalog";
import type { RoutineExercise } from "./api";
import { ExerciseLine } from "./exercise-line";
import { validateObjectiveDraft } from "./objective-draft";
import { useRemoveExercise, useSwapExercises, useUpdateExercise } from "./queries";

export function RoutineExerciseItem({ item, previous, next, ordering = false }: {
  item: RoutineExercise; previous?: RoutineExercise; next?: RoutineExercise; ordering?: boolean;
}) {
  const update = useUpdateExercise();
  const remove = useRemoveExercise();
  const swap = useSwapExercises();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ sets: "", reps: "", weight: "", notes: "" });
  const [validation, setValidation] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const name = getExercise(item.exercise_id)?.name ?? item.exercise_id.replaceAll("_", " ");
  const isBusy = update.isPending || remove.isPending || swap.isPending;
  const hasObjective = item.target_sets !== null || item.target_reps !== null || item.target_weight_kg != null;

  function beginEditing() {
    setDraft({ sets: item.target_sets?.toString() ?? "", reps: item.target_reps ?? "", weight: item.target_weight_kg?.toString().replace(".", ",") ?? "", notes: item.notes ?? "" });
    setValidation(null); setSaved(false); update.reset(); setEditing(true);
  }
  function save() {
    try {
      const patch = validateObjectiveDraft(draft);
      setValidation(null);
      update.mutate({ id: item.id, patch }, { onSuccess: () => { setEditing(false); setSaved(true); } });
    } catch (error) { setValidation(error instanceof Error ? error.message : "Revisá el objetivo."); }
  }
  function move(other: RoutineExercise | undefined) {
    if (!other || isBusy) return;
    swap.mutate({ a: { id: item.id, position: item.position }, b: { id: other.id, position: other.position } });
  }

  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      {ordering ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 flex-1 font-medium">{name}</span>
          <div className="flex gap-2">
            <Button size="sm" aria-label={`Mover ${name} antes`} disabled={!previous || isBusy} onClick={() => move(previous)}>↑</Button>
            <Button size="sm" aria-label={`Mover ${name} después`} disabled={!next || isBusy} onClick={() => move(next)}>↓</Button>
          </div>
        </div>
      ) : (
        <>
          <ExerciseLine exerciseId={item.exercise_id} targetSets={item.target_sets} targetReps={item.target_reps} targetWeightKg={item.target_weight_kg} />
          {!editing ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button size="sm" disabled={isBusy} onClick={beginEditing}>{hasObjective ? "Editar objetivo" : "Definir objetivo"}</Button>
              <Link to={`/progreso?ejercicio=${encodeURIComponent(item.exercise_id)}`} className="text-sm font-medium text-accent">Ver evolución</Link>
            </div>
          ) : (
            <form className="mt-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
              <fieldset disabled={update.isPending}>
                <legend className="mb-2 text-sm font-semibold">Objetivo de {name}</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {([['sets', 'Series', '1–50', 'numeric'], ['reps', 'Repeticiones', '8–12 o 30 s', 'text'], ['weight', 'Peso (kg)', 'Opcional', 'decimal']] as const).map(([key, label, placeholder, inputMode]) => (
                    <label key={key} className="block text-sm">
                      <span className="text-muted">{label}</span>
                      <input type="text" inputMode={inputMode} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} placeholder={placeholder} className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 tnum" />
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">Vacío = sin objetivo. 0 kg = sin carga añadida. Las repeticiones admiten tiempo o una indicación breve.</p>
                <label className="mt-3 block text-sm"><span className="text-muted">Notas</span>
                  <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2" rows={2} />
                </label>
                {validation ? <p role="alert" className="mt-2 text-sm text-warn">{validation}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="submit" variant="primary">{update.isPending ? "Guardando…" : "Guardar objetivo"}</Button>
                  <Button onClick={() => { setEditing(false); setValidation(null); update.reset(); }}>Cancelar</Button>
                </div>
              </fieldset>
            </form>
          )}
          {!editing && item.notes ? <p className="mt-2 text-sm text-muted">{item.notes}</p> : null}
          {saved ? <p role="status" className="mt-2 text-sm text-ok">Objetivo guardado</p> : null}
          {!editing ? <div className="mt-3 border-t border-line pt-3"><ConfirmButton size="sm" label="Quitar del día" confirmLabel="Confirmar quitar" disabled={isBusy} onConfirm={() => remove.mutate(item.id)} /><p className="mt-1 text-xs text-muted">Quita el objetivo y las notas; conserva los entrenamientos registrados.</p></div> : null}
        </>
      )}
      {update.error ? <ErrorNote error={update.error} title="No se guardó el objetivo; tu borrador se conserva. Reintentá Guardar objetivo." /> : null}
      {swap.error ? <ErrorNote error={swap.error} title="No se pudo reordenar; reintentá el movimiento" /> : null}
      {remove.error ? <ErrorNote error={remove.error} title="No se pudo quitar el ejercicio" /> : null}
    </li>
  );
}
