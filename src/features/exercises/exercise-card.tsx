import { Link } from "react-router";
import { EQUIPMENT_ES, labelOr, muscleLabel } from "../../lib/muscles";
import type { Exercise } from "./catalog";

const CARD_CLASS =
  "flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-50";

export function ExerciseCard({
  exercise,
  onSelect,
  disabled,
  added = false,
  detailsTo,
}: {
  exercise: Exercise;
  /** If provided, the card picks the exercise instead of opening its page. */
  onSelect?: () => void;
  disabled?: boolean;
  added?: boolean;
  detailsTo?: string;
}) {
  const content = (
    <>
      {/* Explicit size avoids layout shift while loading. */}
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
    </>
  );

  return (
    <li>
      {/* Picking is a button: a link that performs an INSERT breaks
          middle-click, "open in new tab" and screen readers. */}
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled || added}
          className={CARD_CLASS}
        >
          {content}
        </button>
      ) : (
        <Link to={detailsTo ?? `/ejercicios/${exercise.id}`} state={{ fromExerciseCatalog: true }} className={CARD_CLASS}>
          {content}
        </Link>
      )}
      {onSelect ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="text-xs font-medium text-accent">{added ? "Ya está en el día" : "Agregar al día"}</span>
          <Link to={detailsTo ?? `/ejercicios/${exercise.id}`} state={{ fromExercisePicker: true }} className="text-sm font-medium text-accent">Ver técnica y fotos</Link>
        </div>
      ) : null}
    </li>
  );
}
