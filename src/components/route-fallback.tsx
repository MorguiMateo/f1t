import { Link, useRouteError } from "react-router";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";
import { ErrorNote } from "./status";

export function UnknownDestination() {
  return <>
    <PageHeader title="No encontramos esa pantalla" />
    <EmptyState title="El enlace está incompleto o ya no existe"
      description="Podés volver a Hoy o buscar lo que necesitás en tus rutinas."
      action={<div className="flex flex-wrap justify-center gap-3">
        <Link to="/" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink">Ir a Hoy</Link>
        <Link to="/rutinas" className="inline-flex min-h-11 items-center px-4 text-sm font-medium text-accent">Ver rutinas</Link>
      </div>} />
  </>;
}

/** Also catches rejected lazy chunks. Reload is needed to retry their imports. */
export function RouteFailure() {
  const error = useRouteError();
  return <main className="mx-auto min-h-dvh w-full max-w-lg bg-ground px-4 pb-8">
    <PageHeader title="No pudimos abrir la pantalla" />
    <ErrorNote error={error} title="La pantalla no pudo cargarse" />
    <div className="mt-4 flex flex-wrap gap-3">
      <Button variant="primary" onClick={() => window.location.reload()}>Reintentar</Button>
      <Link to="/" className="inline-flex min-h-11 items-center px-4 text-sm font-medium text-accent">Ir a Hoy</Link>
    </div>
  </main>;
}
