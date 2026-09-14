import { Link } from "react-router";
import { EQUIPMENT_ES, labelOr, muscleLabel } from "../../lib/muscles";
import type { Exercise } from "./catalog";

export function ExerciseCard({ exercise }: { exercise: Exercise }) {
  return (
    <li>
      <Link
        to={`/ejercicios/${exercise.id}`}
        className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5 transition-colors hover:bg-surface-2"
      >
        {/* width/height explícitos: 480×320 es 3:2 y así no hay salto de
            layout mientras la imagen carga. */}
        <img
          src={exercise.images[0]}
          alt=""
          width={480}
          height={320}
          loading="lazy"
          decoding="async"
          className="aspect-3/2 w-24 shrink-0 rounded-lg bg-surface-2 object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-tight">{exercise.name}</p>
          <p className="mt-1 truncate text-xs text-muted">
            {exercise.primaryMuscles.map(muscleLabel).join(" · ")}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {labelOr(EQUIPMENT_ES, exercise.equipment)}
          </p>
        </div>
      </Link>
    </li>
  );
}
