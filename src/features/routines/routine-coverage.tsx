import { muscleLabel } from "../../lib/muscles";
import { MuscleMap } from "../exercises/muscle-map";
import { muscleCoverage } from "./coverage";

export function RoutineCoverage({
  exerciseIds,
  title = "Cobertura muscular",
}: {
  exerciseIds: readonly string[];
  title?: string;
}) {
  const coverage = muscleCoverage(exerciseIds);

  // With no exercises everything would read as missing: noise, not information.
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
