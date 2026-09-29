import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "../components/button";
import { ConfirmButton } from "../components/confirm-button";
import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/page-header";
import { SkeletonGroup, SkeletonLine } from "../components/skeleton";
import { ErrorNote } from "../components/status";
import { TextInput } from "../components/text-input";
import { RoutineCoverage } from "../features/routines/routine-coverage";
import { exerciseIdsOf } from "../features/routines/coverage";
import {
  useActivateRoutine,
  useCreateDay,
  useDeleteRoutine,
  useRenameRoutine,
  useRoutineDetail,
} from "../features/routines/queries";
import {
  WEEK_ORDER,
  dayForWeekday,
  todayWeekday,
  weekdayLabel,
} from "../features/routines/weekdays";

const LABEL_SUGGESTIONS = [
  "Empuje",
  "Tracción",
  "Pierna",
  "Torso",
  "Full body",
  "Cardio",
];

function WeekSkeleton() {
  return (
    <SkeletonGroup>
      <ul className="flex flex-col gap-2">
        {WEEK_ORDER.map((weekday) => (
          <li key={weekday} className="rounded-xl border border-line bg-surface p-4">
            <SkeletonLine className="w-14 text-xs" />
            <SkeletonLine className="mt-0.5 w-28 font-semibold" />
            <SkeletonLine className="mt-0.5 w-20 text-sm" />
          </li>
        ))}
      </ul>
    </SkeletonGroup>
  );
}

export function RoutineDetailPage() {
  const { routineId } = useParams();
  const navigate = useNavigate();

  const { data: routine, isPending, error } = useRoutineDetail(routineId);
  const renameRoutine = useRenameRoutine();
  const activate = useActivateRoutine();
  const deleteRoutine = useDeleteRoutine();
  const createDay = useCreateDay();

  const [creatingWeekday, setCreatingWeekday] = useState<number | null>(null);
  const [label, setLabel] = useState("");

  if (isPending) {
    return (
      <>
        <PageHeader title="Rutina" onBack={() => navigate(-1)} />
        <WeekSkeleton />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Rutina" onBack={() => navigate(-1)} />
        <ErrorNote error={error} title="No se pudo cargar la rutina" />
      </>
    );
  }

  if (!routine) {
    return (
      <>
        <PageHeader title="Rutina" onBack={() => navigate(-1)} />
        <EmptyState
          title="No encontramos esa rutina"
          description="Puede que la hayas borrado desde otro dispositivo."
          action={
            <Link to="/rutinas" className="text-sm font-medium text-accent">
              Volver a mis rutinas
            </Link>
          }
        />
      </>
    );
  }

  const exerciseIds = exerciseIdsOf(routine.days);
  const today = todayWeekday();

  function startCreating(weekday: number) {
    setCreatingWeekday(weekday);
    setLabel("");
  }

  function submitDay(weekday: number) {
    const trimmed = label.trim();
    if (!trimmed || !routineId) return;
    createDay.mutate(
      { routineId, weekday, label: trimmed },
      {
        onSuccess: () => {
          setCreatingWeekday(null);
          setLabel("");
        },
      },
    );
  }

  return (
    <>
      <PageHeader
        title={routine.name}
        subtitle={
          routine.days.length
            ? `${routine.days.length} ${routine.days.length === 1 ? "día" : "días"} · ${exerciseIds.length} ejercicios`
            : "Elegí los días que entrenás"
        }
        onBack={() => navigate(-1)}
        action={
          routine.is_active ? (
            <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-ink">
              Activa
            </span>
          ) : (
            <Button
              size="sm"
              disabled={activate.isPending}
              onClick={() => activate.mutate(routine.id)}
            >
              Activar
            </Button>
          )
        }
      />

      <ul className="flex flex-col gap-2">
        {WEEK_ORDER.map((weekday) => {
          const day = dayForWeekday(routine.days, weekday);
          const isToday = weekday === today;

          return (
            <li
              key={weekday}
              className="overflow-hidden rounded-xl border border-line bg-surface"
            >
              {day ? (
                <Link
                  to={`/rutinas/${routine.id}/dias/${day.id}`}
                  className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-xs uppercase tracking-wide text-muted">
                        {weekdayLabel(weekday)}
                      </span>
                      {isToday ? (
                        <span className="rounded-full border border-line-strong px-1.5 py-px text-[10px] font-medium text-muted">
                          hoy
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate font-semibold">
                      {day.label}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted tnum">
                      {day.exercises.length
                        ? `${day.exercises.length} ${day.exercises.length === 1 ? "ejercicio" : "ejercicios"}`
                        : "Sin ejercicios"}
                    </span>
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-muted">
                    →
                  </span>
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3 p-4">
                  <span className="min-w-0">
                    <span className="text-xs uppercase tracking-wide text-muted">
                      {weekdayLabel(weekday)}
                    </span>
                    <span className="mt-0.5 block text-muted">Descanso</span>
                  </span>
                  <Button size="sm" onClick={() => startCreating(weekday)}>
                    Entrenar
                  </Button>
                </div>
              )}

              {creatingWeekday === weekday ? (
                <form
                  className="border-t border-line bg-surface-2/50 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitDay(weekday);
                  }}
                >
                  <div className="flex gap-2">
                    <TextInput
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder={`Qué entrenás el ${weekdayLabel(weekday).toLowerCase()}`}
                      maxLength={40}
                      autoFocus
                      className="min-w-0 flex-1"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!label.trim() || createDay.isPending}
                    >
                      {createDay.isPending ? "…" : "Listo"}
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {LABEL_SUGGESTIONS.map((suggestion) => (
                      <Button
                        key={suggestion}
                        size="sm"
                        onClick={() => setLabel(suggestion)}
                      >
                        {suggestion}
                      </Button>
                    ))}
                    <Button size="sm" onClick={() => setCreatingWeekday(null)}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>

      {createDay.error ? (
        <div className="mt-3">
          <ErrorNote
            error={createDay.error}
            title="No se pudo crear el día; corregí el nombre y reintentá"
          />
        </div>
      ) : null}
      {activate.error ? (
        <div className="mt-3">
          <ErrorNote
            error={activate.error}
            title="No se pudo activar la rutina; volvé a tocar Activar"
          />
        </div>
      ) : null}

      <RoutineCoverage
        exerciseIds={exerciseIds}
        title="Qué cubre la rutina"
      />

      <section className="mt-4 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-semibold">Ajustes</h2>
        <label className="mt-3 block">
          <span className="text-sm text-muted">Nombre</span>
          {/* Uncontrolled and saved on blur; `key` resets it after a rename. */}
          <TextInput
            key={routine.name}
            defaultValue={routine.name}
            maxLength={60}
            className="mt-1 w-full"
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (!value || value === routine.name) {
                e.target.value = routine.name;
                return;
              }
              renameRoutine.mutate({ routineId: routine.id, name: value });
            }}
          />
        </label>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Borrar la rutina borra sus días y sus ejercicios. Los
            entrenamientos ya registrados quedan.
          </p>
          <ConfirmButton
            label="Borrar"
            confirmLabel="¿Seguro?"
            disabled={deleteRoutine.isPending}
            className="shrink-0"
            onConfirm={() =>
              deleteRoutine.mutate(routine.id, {
                onSuccess: () => navigate("/rutinas", { replace: true }),
              })
            }
          />
        </div>
        {renameRoutine.error ? (
          <div className="mt-3">
            <ErrorNote
              error={renameRoutine.error}
              title="No se guardó el nombre; enfocá el campo y salí de él para reintentar"
            />
          </div>
        ) : null}
        {deleteRoutine.error ? (
          <div className="mt-3">
            <ErrorNote
              error={deleteRoutine.error}
              title="No se pudo borrar; volvé a tocar Borrar"
            />
          </div>
        ) : null}
      </section>
    </>
  );
}
