import { useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { ExerciseCard } from "../features/exercises/ExerciseCard";
import {
  EXERCISES,
  availableEquipment,
  availableMuscles,
  buildSearchIndex,
  filterExercises,
} from "../features/exercises/catalog";
import { EQUIPMENT_ES, MUSCLES, muscleLabel } from "../lib/muscles";

const equipmentLabel = (e: string | null) => (e ? EQUIPMENT_ES[e] ?? e : "");

/** Se arma una vez: 165 strings normalizados no valen recalcular por tecla. */
const SEARCH_INDEX = new Map(
  EXERCISES.map((e) => [e.id, buildSearchIndex(e, muscleLabel, equipmentLabel)]),
);

// En el orden del cuerpo y no alfabético: buscar "hombros" al lado de
// "pecho" es más rápido que recordar la letra con la que empieza.
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

export function ExercisesPage() {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);

  const results = useMemo(
    () => filterExercises(EXERCISES, { query, muscle, equipment }, SEARCH_INDEX),
    [query, muscle, equipment],
  );

  const hasFilters = query !== "" || muscle !== null || equipment !== null;

  return (
    <>
      <PageHeader
        title="Ejercicios"
        subtitle={`${EXERCISES.length} ejercicios con foto y músculos`}
      />

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

      {/* Los filtros scrollean en horizontal: en un teléfono no entran 17
          músculos en una grilla sin comerse la pantalla. */}
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
            <ExerciseCard key={e.id} exercise={e} />
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
