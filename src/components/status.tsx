/**
 * The two states every screen with remote data has to know how to show.
 * They sit together so they look the same everywhere: loading and error are
 * precisely the ones each screen improvises differently when there is no
 * shared piece.
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
      {/* PostgREST's raw message isn't pretty, but it is the difference
          between "something failed" and knowing a migration wasn't run. */}
      <p className="mt-1 text-muted">{message}</p>
    </div>
  );
}
