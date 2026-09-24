/**
 * The error state every screen with remote data has to know how to show,
 * shared so it looks the same everywhere: it is precisely the one each screen
 * improvises differently when there is no common piece. Loading has its own
 * file, `skeleton.tsx`, because each screen's placeholder has that screen's
 * shape.
 */

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
