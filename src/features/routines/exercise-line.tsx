import { Link } from "react-router";
import { getExercise } from "../exercises/catalog";
import { targetLabel } from "./target";
import type { ReactNode } from "react";

// Imports the catalog, so use it only from `lazy()` chunks.
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
          {/* Ids dropped from the curated catalog still exist in the database. */}
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
