import { Link } from "react-router";
import { getExercise } from "../exercises/catalog";
import type { ReactNode } from "react";

/**
 * Un ejercicio dentro de un día: foto, nombre y objetivo.
 *
 * Importa el catálogo del bundle, así que solo se usa desde chunks `lazy()`
 * —las pantallas de rutina y el bloque de Hoy—. El `children` es la columna
 * de acciones de la derecha, que cambia según quién lo dibuje: en Hoy no hay
 * ninguna, en el editor hay tres.
 */

/** "3 × 8-12", o lo que se sepa. Guiones no: un objetivo vacío es válido. */
function targetLabel(sets: number | null, reps: string | null): string | null {
  if (sets && reps) return `${sets} × ${reps}`;
  if (sets) return `${sets} ${sets === 1 ? "serie" : "series"}`;
  if (reps) return `${reps} reps`;
  return null;
}

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
      {/* El nombre y la foto llevan a la ficha del catálogo: en el gimnasio,
          "¿cómo era este?" es la pregunta más frecuente. */}
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
          {/* Si el id salió de la lista curada, la rutina sigue viva: la fila
              está en la base y lo único que falta es el nombre lindo. */}
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
