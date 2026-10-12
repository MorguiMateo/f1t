import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Button } from "../components/button";
import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/page-header";
import { ErrorNote } from "../components/status";
import { ExerciseCard } from "../features/exercises/exercise-card";
import { useAddExercise, useRoutineDetail } from "../features/routines/queries";
import { RoutineNavigation } from "../features/routines/routine-navigation";
import { weekdayLabel } from "../features/routines/weekdays";
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
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dayId = params.get("dia");
  const routineId = params.get("rutina");
  const isPicking = Boolean(dayId && routineId);
  const addExercise = useAddExercise();
  const { data: routine, isPending: dayPending, error: dayError } = useRoutineDetail(isPicking ? routineId! : undefined);
  const day = routine?.days.find((item) => item.id === dayId);
  const inFlight = useRef(false);
  const [confirmedAdds, setConfirmedAdds] = useState<{ dayId: string | null; ids: string[] }>({ dayId, ids: [] });
  const addedIDs = new Set([...(day?.exercises.map((item) => item.exercise_id) ?? []), ...(confirmedAdds.dayId === dayId ? confirmedAdds.ids : [])]);

  const query = params.get("q") ?? "";
  const muscle = params.get("musculo");
  const equipment = params.get("equipo");
  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true, state: location.state });
  }
  function finish() {
    if (location.state?.fromRoutineDay) navigate(-1);
    else navigate(`/rutinas/${routineId}/dias/${dayId}`, { replace: true });
  }

  const results = useMemo(
    () => filterExercises(EXERCISES, { query, muscle, equipment }, SEARCH_INDEX),
    [query, muscle, equipment],
  );

  const hasFilters = query !== "" || muscle !== null || equipment !== null;

  function pick(exerciseId: string) {
    if (!dayId || !routineId || !day || inFlight.current || addedIDs.has(exerciseId)) return;
    inFlight.current = true;
    addExercise.mutate(
      { dayId, exerciseId },
      {
        onSuccess: () => setConfirmedAdds((previous) => ({ dayId, ids: [...(previous.dayId === dayId ? previous.ids : []), exerciseId] })),
        onSettled: () => { inFlight.current = false; },
      },
    );
  }

  return (
    <>
      {!isPicking ? <RoutineNavigation /> : null}
      <PageHeader
        title={isPicking ? "Elegir ejercicio" : "Ejercicios"}
        subtitle={
          isPicking
            ? day ? `${routine!.name} · ${day.label} · ${weekdayLabel(day.weekday)}` : "Cargando el día destino…"
            : `${EXERCISES.length} ejercicios con foto y músculos`
        }
        onBack={isPicking ? finish : undefined}
        action={isPicking ? <Button size="sm" onClick={finish}>Volver al día · {addedIDs.size}</Button> : undefined}
      />
      {isPicking && dayError ? <ErrorNote error={dayError} title="No se pudo cargar el día destino" /> : null}
      {isPicking && !dayPending && !day && !dayError ? <EmptyState title="Ese día ya no existe" description="Volvé a tus rutinas para elegir otro día." /> : null}
      {isPicking && day ? <p role="status" className="mb-3 text-sm text-muted">Agregá varios ejercicios sin salir. Se guardan al final de {day.label}.</p> : null}

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
          onChange={(e) => setFilter("q", e.target.value)}
          placeholder="Buscar por nombre o músculo…"
          enterKeyHint="search"
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 placeholder:text-muted"
        />
      </label>

      {/* 17 muscles in a grid would eat a phone screen. */}
      <h2 className="mt-3 text-xs font-semibold text-muted">Músculo</h2>
      <div className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 pb-1">
        {MUSCLE_ORDER.map((m) => (
          <Chip
            key={m}
            label={muscleLabel(m)}
            isActive={muscle === m}
            onClick={() => setFilter("musculo", muscle === m ? null : m)}
          />
        ))}
      </div>

      <h2 className="mt-2 text-xs font-semibold text-muted">Equipamiento</h2>
      <div className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 pb-1">
        {EQUIPMENT_ORDER.map((eq) => (
          <Chip
            key={eq}
            label={equipmentLabel(eq)}
            isActive={equipment === eq}
            onClick={() => setFilter("equipo", equipment === eq ? null : eq)}
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
              const next = new URLSearchParams(params);
              for (const key of ["q", "musculo", "equipo"]) next.delete(key);
              setParams(next, { replace: true, state: location.state });
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
              disabled={addExercise.isPending || (isPicking && !day)}
              added={addedIDs.has(e.id)}
              detailsTo={`/ejercicios/${e.id}?${params.toString()}`}
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
