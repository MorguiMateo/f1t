import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";

export function RoutinesPage() {
  return (
    <>
      <PageHeader
        title="Rutinas"
        subtitle="Tus plantillas de entrenamiento por día"
      />

      <EmptyState
        title="Sin rutinas todavía"
        description="Una rutina agrupa los días de la semana y los ejercicios de cada uno, con sus series y repeticiones."
      />

      {/* Sin el número de ejercicios a propósito: importar el catálogo acá
          traería sus 209 KB al chunk inicial para mostrar un entero. */}
      <Link
        to="/ejercicios"
        className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-5 transition-colors hover:bg-surface-2"
      >
        <span className="min-w-0">
          <span className="block font-semibold">Catálogo de ejercicios</span>
          <span className="mt-1 block text-sm text-muted">
            Buscá por nombre, músculo o equipamiento. Con foto e instrucciones.
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-muted">
          →
        </span>
      </Link>
    </>
  );
}
