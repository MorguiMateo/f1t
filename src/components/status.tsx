import { describeError } from "./error-message";

export function ErrorNote({
  error,
  title = "No se pudo completar la operación",
}: {
  error: unknown;
  title?: string;
}) {
  const { message, detail } = describeError(error);
  return (
    <div
      role="alert"
      className="rounded-xl border border-line bg-surface p-4 text-sm"
    >
      <p className="font-semibold text-warn">{title}</p>
      <p className="mt-1 text-muted">{message}</p>
      {detail ? <details className="mt-2 text-muted">
        <summary className="min-h-11 cursor-pointer content-center font-medium">Detalle técnico</summary>
        <p className="break-words text-xs">{detail}</p>
      </details> : null}
    </div>
  );
}
