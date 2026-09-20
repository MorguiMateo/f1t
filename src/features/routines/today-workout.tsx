import { Link } from "react-router";
import type { RoutineDay } from "./api";
import { ExerciseLine } from "./exercise-line";

/**
 * Today's workout.
 *
 * It lives in its own module because it imports the catalog — for the photo
 * and the name — and the Today tab is the index route: if this were imported
 * statically, `catalog.json` would travel in the whole app's initial chunk.
 * The tab paints all the same and this block arrives an instant later, which
 * is time already spent waiting on Supabase's response anyway.
 */
export function TodayWorkout({
  day,
  routineId,
}: {
  day: RoutineDay;
  routineId: string;
}) {
  const totalSets = day.exercises.reduce(
    (total, e) => total + (e.target_sets ?? 0),
    0,
  );

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
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{day.label}</h2>
        <p className="shrink-0 text-sm text-muted tnum">
          {day.exercises.length}{" "}
          {day.exercises.length === 1 ? "ejercicio" : "ejercicios"}
          {totalSets ? ` · ${totalSets} series` : ""}
        </p>
      </div>

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
            />
          </li>
        ))}
      </ul>

      <Link
        to={`/rutinas/${routineId}/dias/${day.id}`}
        className="mt-3 block rounded-xl border border-line bg-surface px-5 py-3 text-center text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        Editar este día
      </Link>
    </>
  );
}
