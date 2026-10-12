import { Link } from "react-router";
import type { RoutineDay } from "./api";
import { ExerciseLine } from "./exercise-line";

// Its own lazy module because it imports the catalog; statically imported
// from the index route, `catalog.json` would land in the initial chunk.
export function TodayWorkout({
  day,
  routineId,
}: {
  day: RoutineDay;
  routineId: string;
}) {
  if (!day.exercises.length) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong bg-surface/50 p-5 text-center">
        <p className="font-semibold">{day.label} sin ejercicios</p>
        <p className="mx-auto mt-1 max-w-[34ch] text-sm text-muted">
          Este día existe en la rutina pero está vacío.
        </p>
        <Link
          to={`/rutinas/${routineId}/dias/${day.id}`}
          className="mt-3 inline-block text-sm font-medium text-accent"
        >
          Agregar ejercicios
        </Link>
      </div>
    );
  }

  return (
    <>
      <details className="mt-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-muted">Ver ejercicios del plan</summary>
        <ul className="mt-3 flex flex-col gap-2">
          {day.exercises.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-line bg-surface p-2.5"
            >
              <ExerciseLine
                exerciseId={item.exercise_id}
                targetSets={item.target_sets}
                targetReps={item.target_reps}
                targetWeightKg={item.target_weight_kg}
              />
            </li>
          ))}
        </ul>
      </details>

      <Link
        to={`/rutinas/${routineId}/dias/${day.id}`}
        className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-ink"
      >
        Editar este día
      </Link>
    </>
  );
}
