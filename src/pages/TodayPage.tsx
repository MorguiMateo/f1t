import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";

const FORMATTER = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function TodayPage() {
  const today = FORMATTER.format(new Date());

  return (
    <>
      <PageHeader
        title="Hoy"
        subtitle={today.charAt(0).toUpperCase() + today.slice(1)}
      />
      <EmptyState
        title="Todavía no hay rutina asignada"
        description="Cuando armes una rutina y le asignes días, acá va a aparecer lo que te toca entrenar."
      />
    </>
  );
}
