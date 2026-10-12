import { useState } from "react";
import { getExercise } from "./catalog";
import { ImageLightbox } from "./image-lightbox";

export function WorkoutExerciseImage({ exerciseId }: { exerciseId: string }) {
  const exercise = getExercise(exerciseId);
  const src = exercise?.images[0];
  return <ExerciseImage key={`${exerciseId}:${src ?? ""}`} src={src} name={exercise?.name ?? "Ejercicio"} />;
}

function ExerciseImage({ src, name }: { src: string | undefined; name: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [zoomed, setZoomed] = useState(false);
  const alt = `${name}: posición inicial`;

  if (!src || status === "failed") {
    return (
      <p className="mt-2 rounded-lg bg-surface-2 p-3 text-center text-sm text-muted" role="status">
        Imagen no disponible. Podés consultar la técnica en el detalle.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        disabled={status !== "ready"}
        aria-label={`Ampliar imagen de ${name}`}
        className="relative mt-2 block h-44 w-full overflow-hidden rounded-lg bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <img
          src={src}
          alt={alt}
          loading="eager"
          decoding="async"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("failed")}
          className={`h-full w-full object-contain ${status === "loading" ? "invisible" : ""}`}
        />
        {status === "loading" ? (
          <span className="absolute inset-0 flex items-center justify-center text-sm text-muted" role="status">
            Cargando imagen…
          </span>
        ) : null}
      </button>
      {zoomed ? <ImageLightbox src={src} alt={alt} onClose={() => setZoomed(false)} /> : null}
    </>
  );
}
