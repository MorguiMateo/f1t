import { Link } from "react-router";
import { getExercise } from "../exercises/catalog";
import { targetLabel } from "./target";
import type { ReactNode } from "react";

/**
 * One exercise inside a day: photo, name and target.
 *
 * It imports the catalog from the bundle, so it is only used from `lazy()`
 * chunks — the routine screens and the Today block. `children` is the column
 * of actions on the right, which changes depending on who draws it: none in
 * Today, three in the editor.
 */

export function ExerciseLine({
  exerciseId,
  targetSets = null,
  targetReps = null,
  children,
}: {
  exerciseId: string;
  targetSets?: number | null;
  targetReps?: string | null;
  children?: ReactNode;
}) {
  const exercise = getExercise(exerciseId);
  const target = targetLabel(targetSets, targetReps);

  return (
    <div className="flex items-center gap-3">
      {/* The name and the photo link to the catalog entry: at the gym,
          "how did this one go again?" is the most frequent question. */}
      <Link
        to={`/ejercicios/${exerciseId}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        {exercise ? (
          <img
            src={exercise.images[0]}
            alt=""
            width={480}
            height={320}
            loading="lazy"
            decoding="async"
            className="aspect-3/2 w-20 shrink-0 rounded-lg bg-surface-2 object-cover"
          />
        ) : (
          <div className="aspect-3/2 w-20 shrink-0 rounded-lg bg-surface-2" />
        )}
        <div className="min-w-0 flex-1">
          {/* If the id dropped out of the curated list, the routine is still
              alive: the row is in the database and the only thing missing is
              the pretty name. */}
          <p className="truncate font-medium leading-tight">
            {exercise?.name ?? exerciseId.replaceAll("_", " ")}
          </p>
          {target ? (
            <p className="mt-1 text-xs text-muted tnum">{target}</p>
          ) : (
            <p className="mt-1 text-xs text-muted">Sin objetivo</p>
          )}
        </div>
      </Link>
      {children}
    </div>
  );
}
