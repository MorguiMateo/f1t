import { fromDateKey, toDateKey } from "../../lib/heatmap";
import { parseMeasure, WEIGHT_RANGE } from "./profile";
import type { WeightEntry } from "./weight";

export type WeightSubmission =
  | { status: "invalid"; message: string }
  | { status: "unchanged" }
  | { status: "ready"; measuredOn: string; weightKg: number; previous: WeightEntry | null };

/** No write is prepared until the history is available and the exact draft is valid. */
export function prepareWeightSubmission(raw: string, date: string, entries: readonly WeightEntry[], today: string): WeightSubmission {
  const weight = parseMeasure(raw, WEIGHT_RANGE);
  if (weight === null || weight === undefined) return {
    status: "invalid",
    message: "Ingresá un peso entre 20 y 400 kg, con hasta un decimal. Podés usar coma o punto; el valor no se ajusta automáticamente.",
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(fromDateKey(date).getTime()) || toDateKey(fromDateKey(date)) !== date || date > today) {
    return { status: "invalid", message: "Elegí una fecha válida, hasta hoy inclusive." };
  }
  const previous = entries.find((entry) => entry.measured_on === date) ?? null;
  if (previous?.weight_kg === weight) return { status: "unchanged" };
  return { status: "ready", measuredOn: date, weightKg: weight, previous };
}
