import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { EmptyState } from "../components/empty-state";
import { PageHeader } from "../components/page-header";
import { ImageLightbox } from "../features/exercises/image-lightbox";
import { MuscleMap } from "../features/exercises/muscle-map";
import { getExercise } from "../features/exercises/catalog";
import {
  CATEGORY_ES,
  EQUIPMENT_ES,
  FORCE_ES,
  LEVEL_ES,
  MECHANIC_ES,
  labelOr,
  muscleLabel,
} from "../lib/muscles";

function imageAlt(name: string, index: number): string {
  return index === 0
    ? `${name}: posición inicial`
    : `${name}: posición final`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

export function ExerciseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const exercise = id ? getExercise(id) : undefined;
  const [zoomed, setZoomed] = useState<number | null>(null);

  if (!exercise) {
    return (
      <>
        <PageHeader title="Ejercicio" onBack={() => navigate(-1)} />
        <EmptyState
          title="No encontramos ese ejercicio"
          description="Puede que el enlace esté viejo o que el ejercicio ya no esté en el catálogo."
          action={
            <Link to="/ejercicios" className="text-sm font-medium text-accent">
              Volver al catálogo
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={exercise.name}
        subtitle={exercise.primaryMuscles.map(muscleLabel).join(" · ")}
        onBack={() => navigate(-1)}
      />

      {/* Start and end of the movement: one alone says nothing. */}
      <div className="grid grid-cols-2 gap-2">
        {exercise.images.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setZoomed(i)}
            aria-label={`Ampliar ${imageAlt(exercise.name, i)}`}
            className="cursor-zoom-in overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <img
              src={src}
              alt={imageAlt(exercise.name, i)}
              width={480}
              height={320}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className="aspect-3/2 w-full bg-surface-2 object-cover"
            />
          </button>
        ))}
      </div>

      {zoomed !== null ? (
        <ImageLightbox
          src={exercise.images[zoomed]}
          alt={imageAlt(exercise.name, zoomed)}
          onClose={() => setZoomed(null)}
        />
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <Fact label="Equipamiento" value={labelOr(EQUIPMENT_ES, exercise.equipment)} />
        <Fact label="Nivel" value={labelOr(LEVEL_ES, exercise.level)} />
        <Fact label="Tipo" value={labelOr(CATEGORY_ES, exercise.category)} />
        <Fact label="Mecánica" value={labelOr(MECHANIC_ES, exercise.mechanic)} />
        <Fact label="Patrón" value={labelOr(FORCE_ES, exercise.force)} />
      </dl>

      <section className="mt-5 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-semibold">Músculos</h2>
        <div className="mt-3">
          <MuscleMap
            primary={exercise.primaryMuscles}
            secondary={exercise.secondaryMuscles}
          />
        </div>
        <div className="mt-3 flex flex-col gap-1.5 text-sm">
          <p>
            <span className="text-muted">Primarios: </span>
            {exercise.primaryMuscles.map(muscleLabel).join(", ")}
          </p>
          {exercise.secondaryMuscles.length ? (
            <p>
              <span className="text-muted">Secundarios: </span>
              {exercise.secondaryMuscles.map(muscleLabel).join(", ")}
            </p>
          ) : null}
        </div>
      </section>

      {/* Two of the dataset's 165 exercises come with no instructions. */}
      {exercise.instructions.length ? (
        <section className="mt-4 rounded-xl border border-line bg-surface p-4">
          <h2 className="font-semibold">Cómo se hace</h2>
          <ol className="mt-3 flex flex-col gap-3">
            {exercise.instructions.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-ink-2">
                <span className="shrink-0 font-semibold text-muted tnum">
                  {i + 1}
                </span>
                <span className="text-pretty">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <Link
        to="/ejercicios"
        className="mt-4 block rounded-xl border border-line bg-surface px-5 py-3 text-center text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        Volver al catálogo
      </Link>
    </>
  );
}
