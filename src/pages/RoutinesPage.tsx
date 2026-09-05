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
    </>
  );
}
