import { muscleLabel } from "../../lib/muscles";
import { MuscleMap } from "../exercises/muscle-map";
import { muscleCoverage } from "./coverage";

/**
 * The aggregate muscle map: what the routine covers and what it leaves out.
 *
 * It reuses the exercise page's `MuscleMap` untouched, because the question
 * is the same at a different scope: for an exercise, "what does this work";
 * for a routine, "what does all of this work together". Any exercise's
 * primaries are primaries of the whole.
 */
export function RoutineCoverage({
  exerciseIds,
  title = "Cobertura muscular",
}: {
  exerciseIds: readonly string[];
  title?: string;
}) {
  const coverage = muscleCoverage(exerciseIds);

  // With no exercises the figure would be entirely grey and the missing list
  // would be the complete list: noise, not information.
  if (!coverage.exerciseCount) return null;

  const labels = (muscles: readonly string[]) =>
    muscles.map(muscleLabel).join(", ");

  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3">
        <MuscleMap primary={coverage.primary} secondary={coverage.secondary} />
      </div>
      <div className="mt-3 flex flex-col gap-1.5 text-sm">
        <p>
          <span className="text-muted">Trabaja: </span>
          {labels(coverage.primary)}
        </p>
        {coverage.secondary.length ? (
          <p>
            <span className="text-muted">De apoyo: </span>
            {labels(coverage.secondary)}
          </p>
        ) : null}
        {coverage.missing.length ? (
          <p className="text-warn">
            <span className="text-muted">Sin trabajo: </span>
            {labels(coverage.missing)}
          </p>
        ) : (
          <p className="text-ok">No queda ningún grupo grande sin entrenar.</p>
        )}
      </div>
    </section>
  );
}
