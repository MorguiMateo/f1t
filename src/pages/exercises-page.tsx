import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/page-header";
import { ErrorNote } from "../components/status";
import { ExerciseCard } from "../features/exercises/exercise-card";
import { useAddExercise } from "../features/routines/queries";
import {
  EXERCISES,
  availableEquipment,
  availableMuscles,
  buildSearchIndex,
  filterExercises,
} from "../features/exercises/catalog";
import { EQUIPMENT_ES, MUSCLES, muscleLabel } from "../lib/muscles";

const equipmentLabel = (e: string | null) => (e ? EQUIPMENT_ES[e] ?? e : "");

/** Built once: 165 normalised strings aren't worth recomputing per keystroke. */
const SEARCH_INDEX = new Map(
  EXERCISES.map((e) => [e.id, buildSearchIndex(e, muscleLabel, equipmentLabel)]),
);

// Body order, not alphabetical: easier to scan.
const MUSCLE_ORDER = MUSCLES.filter((m) =>
  availableMuscles(EXERCISES).includes(m),
);
const EQUIPMENT_ORDER = availableEquipment(EXERCISES);

function Chip({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={[
        "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        isActive
          ? "border-accent bg-accent text-accent-ink"
          : "border-line bg-surface text-muted hover:text-ink",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/**
 * With `?dia=…&rutina=…` it picks an exercise for that day, so there's only
 * one search to maintain. The mode lives in the URL so the back gesture works.
 */
export function ExercisesPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const dayId = params.get("dia");
  const routineId = params.get("rutina");
  const isPicking = Boolean(dayId && routineId);
  const addExercise = useAddExercise();

  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);

  const results = useMemo(
    () => filterExercises(EXERCISES, { query, muscle, equipment }, SEARCH_INDEX),
    [query, muscle, equipment],
  );

  const hasFilters = query !== "" || muscle !== null || equipment !== null;

  function pick(exerciseId: string) {
    if (!dayId || !routineId) return;
    addExercise.mutate(
      { dayId, exerciseId },
      {
        // `replace` so going back doesn't return to the catalog.
        onSuccess: () =>
          navigate(`/rutinas/${routineId}/dias/${dayId}`, { replace: true }),
      },
    );
  }

  return (
    <>
      <PageHeader
        title={isPicking ? "Elegir ejercicio" : "Ejercicios"}
        subtitle={
          isPicking
            ? "Se agrega al final del día"
            : `${EXERCISES.length} ejercicios con foto y músculos`
        }
        onBack={isPicking ? () => navigate(-1) : undefined}
      />

      {addExercise.error ? (
        <div className="mb-3">
          <ErrorNote error={addExercise.error} />
        </div>
      ) : null}

      <label className="block">
        <span className="sr-only">Buscar ejercicio</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o músculo…"
          enterKeyHint="search"
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 placeholder:text-muted"
        />
      </label>

      {/* 17 muscles in a grid would eat a phone screen. */}
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {MUSCLE_ORDER.map((m) => (
          <Chip
            key={m}
            label={muscleLabel(m)}
            isActive={muscle === m}
            onClick={() => setMuscle(muscle === m ? null : m)}
          />
        ))}
      </div>

      <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
        {EQUIPMENT_ORDER.map((eq) => (
          <Chip
            key={eq}
            label={equipmentLabel(eq)}
            isActive={equipment === eq}
            onClick={() => setEquipment(equipment === eq ? null : eq)}
          />
        ))}
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <p className="text-sm text-muted tnum">
          {results.length === EXERCISES.length
            ? `${results.length} ejercicios`
            : `${results.length} de ${EXERCISES.length}`}
        </p>
        {hasFilters ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setMuscle(null);
              setEquipment(null);
            }}
            className="text-sm font-medium text-accent"
          >
            Limpiar
          </button>
        ) : null}
      </div>

      {results.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {results.map((e) => (
            <ExerciseCard
              key={e.id}
              exercise={e}
              onSelect={isPicking ? () => pick(e.id) : undefined}
              disabled={addExercise.isPending}
            />
          ))}
        </ul>
      ) : (
        <div className="mt-3">
          <EmptyState
            title="Ningún ejercicio coincide"
            description="Probá con menos filtros, o buscá por el músculo que querés trabajar."
          />
        </div>
      )}
    </>
  );
}
