import { useEffect } from "react";
import { device } from "../../lib/device";
import { getExercise } from "../exercises/catalog";
import type { RoutineDay } from "../routines/api";
import { targetLabel } from "../routines/target";
import { useSessionDays } from "./queries";
import { buildWidgetPayload, WIDGET_EXERCISE_LIMIT } from "./widget";

/**
 * Publica el estado en `device.syncWidget()`. No dibuja nada.
 *
 * En web el bridge solo escribe el payload en localStorage —no hay widget
 * que leerlo—, y aun así esto corre desde la Fase 4. Es lo que mantiene
 * honesto el contrato del §5.1: `buildLevels()` tiene un consumidor real
 * desde el día uno, así que el día que llegue el widget de SwiftUI no hay
 * que descubrir ahí si la forma del array servía.
 *
 * Es un componente y no un efecto suelto en `TodayPage` porque necesita el
 * catálogo para los nombres lindos, y el catálogo no puede entrar al chunk
 * inicial (PLAN.md, Fase 2). Se monta con `lazy()` desde la ruta índice, con
 * `day = null` los días de descanso: un descanso también es información que
 * el widget tiene que mostrar.
 */
export function WidgetSync({ day }: { day: RoutineDay | null }) {
  const { data: days } = useSessionDays();

  useEffect(() => {
    if (!days) return;

    void device.syncWidget(
      buildWidgetPayload({
        days,
        todayLabel: day?.label ?? null,
        todayExercises: (day?.exercises ?? [])
          .slice(0, WIDGET_EXERCISE_LIMIT)
          .map((item) => ({
            name: getExercise(item.exercise_id)?.name ?? item.exercise_id,
            detail: targetLabel(item.target_sets, item.target_reps) ?? "",
          })),
      }),
    );
    // `day` sale de la caché de React Query, así que su identidad solo cambia
    // cuando cambió el dato. Volver a escribir el payload de más es escribir
    // una clave de localStorage; escribirlo de menos es un widget viejo.
  }, [days, day]);

  return null;
}
