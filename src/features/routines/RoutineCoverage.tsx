import { muscleLabel } from "../../lib/muscles";
import { MuscleMap } from "../exercises/MuscleMap";
import { muscleCoverage } from "./coverage";

/**
 * El mapa muscular agregado: lo que la rutina cubre y lo que deja afuera.
 *
 * Reusa el `MuscleMap` de la ficha de ejercicio sin tocarlo, porque la
 * pregunta es la misma con otro alcance: en un ejercicio, "qué trabaja
 * esto"; en una rutina, "qué trabaja todo esto junto". Los primarios de
 * cualquier ejercicio son primarios del conjunto.
 */
export function RoutineCoverage({
  exerciseIds,
  title = "Cobertura muscular",
}: {
  exerciseIds: readonly string[];
  title?: string;
}) {
  const coverage = muscleCoverage(exerciseIds);

  // Sin ejercicios el muñeco estaría gris entero y la lista de faltantes
  // sería la lista completa: ruido, no información.
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
