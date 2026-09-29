export function ErrorNote({
  error,
  title = "No se pudo completar la operación",
}: {
  error: unknown;
  title?: string;
}) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="rounded-xl border border-line bg-surface p-4 text-sm"
    >
      <p className="font-semibold text-warn">{title}</p>
      {/* Raw PostgREST message: ugly, but it reveals e.g. a missing migration. */}
      <p className="mt-1 text-muted">{message}</p>
    </div>
  );
}
