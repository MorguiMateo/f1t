import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "../components/button";
import { ConfirmButton } from "../components/confirm-button";
import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/page-header";
import { Skeleton, SkeletonGroup } from "../components/skeleton";
import { ErrorNote } from "../components/status";
import { ExerciseLineSkeleton } from "../features/routines/exercise-line-skeleton";
import { TextInput } from "../components/text-input";
import { RoutineCoverage } from "../features/routines/routine-coverage";
import { RoutineExerciseItem } from "../features/routines/routine-exercise-item";
import { RoutineNavigation } from "../features/routines/routine-navigation";
import {
  useDeleteDay,
  useRenameDay,
  useMoveRoutineDay,
  useRoutineDetail,
} from "../features/routines/queries";
import { WEEK_ORDER, weekdayLabel } from "../features/routines/weekdays";

// Reads the whole routine and picks the day from it: that query is already
// cached from the detail screen, so navigating here fires no request.
function DaySkeleton() {
  return (
    <SkeletonGroup>
      <ul className="flex flex-col gap-2">
        {[0, 1, 2].map((index) => (
          <li key={index} className="rounded-xl border border-line bg-surface p-2.5">
            <ExerciseLineSkeleton />
            <div className="mt-2 flex gap-2">
              <Skeleton className="h-9.5 flex-1 rounded-lg" />
              <Skeleton className="h-9.5 flex-2 rounded-lg" />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonGroup>
  );
}

export function RoutineDayPage() {
  const { routineId, dayId } = useParams();
  const navigate = useNavigate();

  const { data: routine, isPending, error } = useRoutineDetail(routineId);
  const renameDay = useRenameDay();
  const deleteDay = useDeleteDay();
  const moveDay = useMoveRoutineDay();
  const [ordering, setOrdering] = useState(false);
  const [destination, setDestination] = useState("");

  const day = routine?.days.find((d) => d.id === dayId) ?? null;

  if (isPending) {
    return (
      <>
        <PageHeader title="Día" onBack={() => navigate(-1)} />
        <DaySkeleton />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Día" onBack={() => navigate(-1)} />
        <ErrorNote error={error} title="No se pudo cargar el día" />
      </>
    );
  }

  if (!routine || !day) {
    return (
      <>
        <PageHeader title="Día" onBack={() => navigate(-1)} />
        <EmptyState
          title="Ese día ya no existe"
          description="Puede que lo hayas borrado, o que la rutina haya cambiado."
          action={
            <Link to="/rutinas" className="text-sm font-medium text-accent">
              Volver a mis rutinas
            </Link>
          }
        />
      </>
    );
  }

  const exerciseIds = day.exercises.map((e) => e.exercise_id);

  return (
    <>
      <RoutineNavigation />
      <PageHeader
        title={day.label}
        subtitle={`${weekdayLabel(day.weekday)} · ${routine.name}`}
        onBack={() => navigate(-1)}
        action={day.exercises.length > 1 ? <Button size="sm" onClick={() => setOrdering(!ordering)}>{ordering ? "Terminar orden" : "Ordenar"}</Button> : undefined}
      />

      {day.exercises.length ? (
        <ul className="flex flex-col gap-2">
          {day.exercises.map((item, index) => (
            <RoutineExerciseItem
              key={item.id}
              item={item}
              previous={day.exercises[index - 1]}
              next={day.exercises[index + 1]}
              ordering={ordering}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          title="Este día está vacío"
          description="Elegí ejercicios del catálogo: se agregan al final y después los ordenás."
        />
      )}

      {/* Reuses the catalog in "pick" mode instead of maintaining a second search. */}
      <Link
        to={`/ejercicios?dia=${day.id}&rutina=${routine.id}`}
        state={{ fromRoutineDay: true }}
        className="mt-3 block rounded-xl border border-accent bg-accent px-5 py-3 text-center text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
      >
        Agregar ejercicio
      </Link>

      <RoutineCoverage exerciseIds={exerciseIds} title="Qué cubre este día" />

      <section className="mt-4 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-semibold">Ajustes del día</h2>
        <label className="mt-3 block">
          <span className="text-sm text-muted">Nombre del día</span>
          <TextInput
            key={day.label}
            defaultValue={day.label}
            maxLength={40}
            className="mt-1 w-full"
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (!value || value === day.label) {
                e.target.value = day.label;
                return;
              }
              renameDay.mutate({ dayId: day.id, label: value });
            }}
          />
        </label>

        <form className="mt-4" onSubmit={(event) => {
          event.preventDefault();
          if (destination === "") return;
          moveDay.mutate({ dayId: day.id, routineId: routine.id, fromWeekday: day.weekday, weekday: Number(destination) }, { onSuccess: () => setDestination("") });
        }}>
          <label className="block text-sm"><span className="text-muted">Cambiar día de semana</span>
            <select value={destination} onChange={(event) => setDestination(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2" disabled={moveDay.isPending}>
              <option value="">Elegí un día libre</option>
              {WEEK_ORDER.filter((weekday) => !routine.days.some((item) => item.weekday === weekday)).map((weekday) => <option key={weekday} value={weekday}>{weekdayLabel(weekday)}</option>)}
            </select>
          </label>
          <p className="mt-1 text-xs text-muted">Conserva ejercicios, objetivos, notas y entrenamientos registrados. No reemplaza otros días.</p>
          <Button type="submit" size="sm" className="mt-2" disabled={destination === "" || moveDay.isPending}>{moveDay.isPending ? "Cambiando…" : "Guardar día de semana"}</Button>
          {moveDay.error ? <ErrorNote error={moveDay.error} title="No se pudo cambiar el día; actualizá la rutina y elegí un día libre" /> : null}
          {moveDay.isSuccess ? <p role="status" className="mt-2 text-sm text-ok">Día de semana actualizado</p> : null}
        </form>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Sacar el día lo vuelve descanso y borra sus ejercicios.
          </p>
          <ConfirmButton
            label="Sacar día"
            confirmLabel="¿Seguro?"
            disabled={deleteDay.isPending}
            className="shrink-0"
            onConfirm={() =>
              deleteDay.mutate(day.id, {
                onSuccess: () =>
                  navigate(`/rutinas/${routine.id}`, { replace: true }),
              })
            }
          />
        </div>
        {renameDay.error ? (
          <div className="mt-3">
            <ErrorNote
              error={renameDay.error}
              title="No se guardó el nombre; enfocá el campo y salí de él para reintentar"
            />
          </div>
        ) : null}
        {deleteDay.error ? (
          <div className="mt-3">
            <ErrorNote
              error={deleteDay.error}
              title="No se pudo sacar el día; volvé a tocar Sacar día"
            />
          </div>
        ) : null}
      </section>
    </>
  );
}
