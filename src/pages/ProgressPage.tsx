import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";

export function ProgressPage() {
  return (
    <>
      <PageHeader
        title="Progreso"
        subtitle="Tu actividad, tu peso y tu evolución"
      />
      <EmptyState
        title="Nada que mostrar por ahora"
        description="El calendario de actividad se llena solo a medida que registres entrenamientos."
      />
    </>
  );
}
