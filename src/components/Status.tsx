/**
 * Los dos estados que toda pantalla con datos remotos tiene que saber
 * mostrar. Están juntos para que se vean iguales en todas: el estado de
 * carga y el de error son justo los que se improvisan distinto en cada
 * pantalla cuando no hay una pieza compartida.
 */

export function LoadingNote({ label = "Cargando…" }: { label?: string }) {
  return (
    <p className="py-10 text-center text-sm text-muted" role="status">
      {label}
    </p>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="rounded-xl border border-line bg-surface p-4 text-sm"
    >
      <p className="font-semibold text-warn">No se pudo cargar</p>
      {/* El mensaje crudo de PostgREST no es bonito, pero es la diferencia
          entre "algo falló" y saber que faltó correr una migración. */}
      <p className="mt-1 text-muted">{message}</p>
    </div>
  );
}
