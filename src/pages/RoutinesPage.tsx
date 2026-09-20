import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { ErrorNote, LoadingNote } from "../components/Status";
import { TextInput } from "../components/TextInput";
import type { RoutineSummary } from "../features/routines/api";
import { useActivateRoutine, useCreateRoutine, useRoutines } from "../features/routines/queries";

function RoutineItem({ routine }: { routine: RoutineSummary }) {
  const activate = useActivateRoutine();

  return (
    <li className="rounded-xl border border-line bg-surface">
      <Link
        to={`/rutinas/${routine.id}`}
        className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-surface-2"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{routine.name}</span>
            {routine.is_active ? (
              <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-ink">
                Activa
              </span>
            ) : null}
          </span>
          <span className="mt-1 block text-sm text-muted tnum">
            {routine.dayCount === 0
              ? "Sin días todavía"
              : `${routine.dayCount} ${routine.dayCount === 1 ? "día" : "días"} por semana`}
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-muted">
          →
        </span>
      </Link>

      {/* Solo la activa alimenta la pestaña Hoy, así que el resto necesita
          una forma de pasar a serlo sin entrar al detalle. */}
      {routine.is_active ? null : (
        <div className="border-t border-line px-4 py-2.5">
          <Button
            size="sm"
            disabled={activate.isPending}
            onClick={() => activate.mutate(routine.id)}
          >
            {activate.isPending ? "Activando…" : "Usar esta rutina"}
          </Button>
        </div>
      )}
    </li>
  );
}

export function RoutinesPage() {
  const navigate = useNavigate();
  const { data: routines, isPending, error } = useRoutines();
  const createRoutine = useCreateRoutine();
  const [isNaming, setIsNaming] = useState(false);
  const [name, setName] = useState("");

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;

    createRoutine.mutate(
      {
        name: trimmed,
        // La primera rutina nace activa: si no, la pestaña Hoy seguiría
        // vacía después de armar todo y nadie entendería por qué.
        isActive: (routines?.length ?? 0) === 0,
      },
      {
        onSuccess: (routine) => {
          setName("");
          setIsNaming(false);
          // Al detalle directo: recién creada no tiene días y lo único que
          // se puede hacer con ella es agregárselos.
          navigate(`/rutinas/${routine.id}`);
        },
      },
    );
  }

  return (
    <>
      <PageHeader
        title="Rutinas"
        subtitle="Tus plantillas de entrenamiento por día"
        action={
          routines?.length ? (
            <Button size="sm" onClick={() => setIsNaming((open) => !open)}>
              {isNaming ? "Cancelar" : "Nueva"}
            </Button>
          ) : null
        }
      />

      {isNaming ? (
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre (Full body, Push/Pull…)"
            maxLength={60}
            autoFocus
            className="min-w-0 flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!name.trim() || createRoutine.isPending}
          >
            {createRoutine.isPending ? "Creando…" : "Crear"}
          </Button>
        </form>
      ) : null}

      {createRoutine.error ? <ErrorNote error={createRoutine.error} /> : null}

      {isPending ? <LoadingNote /> : null}
      {error ? <ErrorNote error={error} /> : null}

      {routines && !routines.length && !isNaming ? (
        <EmptyState
          title="Sin rutinas todavía"
          description="Una rutina agrupa los días de la semana y los ejercicios de cada uno, con sus series y repeticiones."
          action={
            <Button variant="primary" onClick={() => setIsNaming(true)}>
              Crear la primera
            </Button>
          }
        />
      ) : null}

      {routines?.length ? (
        <ul className="flex flex-col gap-2">
          {routines.map((routine) => (
            <RoutineItem key={routine.id} routine={routine} />
          ))}
        </ul>
      ) : null}

      {/* Sin el número de ejercicios a propósito: importar el catálogo acá
          traería sus 209 KB al chunk inicial para mostrar un entero. */}
      <Link
        to="/ejercicios"
        className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-5 transition-colors hover:bg-surface-2"
      >
        <span className="min-w-0">
          <span className="block font-semibold">Catálogo de ejercicios</span>
          <span className="mt-1 block text-sm text-muted">
            Buscá por nombre, músculo o equipamiento. Con foto e instrucciones.
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-muted">
          →
        </span>
      </Link>
    </>
  );
}
