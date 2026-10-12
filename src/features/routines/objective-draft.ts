/** Validate the whole draft before sending any field. Never clamp or round. */
export function validateObjectiveDraft(draft: { sets: string; reps: string; weight: string; notes: string }) {
  const sets = draft.sets.trim();
  const reps = draft.reps.trim();
  const weight = draft.weight.trim();
  if (sets && (!/^\d+$/.test(sets) || Number(sets) < 1 || Number(sets) > 50)) {
    throw new Error("Ingresá un número entero de 1 a 50 series, o dejá el campo vacío.");
  }
  if (reps.length > 24) throw new Error("El objetivo de repeticiones admite hasta 24 caracteres.");
  const prefix = reps.match(/^[\d\s.,+−\-–—]+/)?.[0].trim();
  if (prefix && /^\d+$/.test(prefix) && Number(prefix) <= 0) {
    throw new Error("El objetivo debe ser mayor que cero.");
  }
  const range = prefix && /[-–—]/.test(prefix) ? prefix : null;
  const count = /^\d+(\s*[-–—]\s*\d+)?$/.test(reps) ? reps : range;
  if (count) {
    const parts = count.split(/[-–—]/).map((part) => part.trim());
    if (parts.length > 2 || parts.some((part) => !/^\d+$/.test(part) || !Number.isSafeInteger(Number(part)) || Number(part) <= 0) || (parts.length === 2 && Number(parts[0]) > Number(parts[1]))) {
      throw new Error("Usá repeticiones positivas y un rango de menor a mayor, por ejemplo 8–12.");
    }
  } else if (/^[+−-]/.test(reps) || (reps && /^[\d\s.,+−\-–—]+$/.test(reps))) {
    throw new Error("Usá un entero o un rango. Para tiempo, escribí la unidad: 30 s.");
  }
  if (weight && (!/^(\d+([.,]\d{0,2})?|[.,]\d{1,2})$/.test(weight) || !Number.isFinite(Number(weight.replace(",", "."))) || Number(weight.replace(",", ".")) > 9999.99)) {
    throw new Error("Ingresá un peso de 0 a 9999,99 kg, con hasta dos decimales, o dejalo vacío.");
  }
  return {
    target_sets: sets ? Number(sets) : null,
    target_reps: reps || null,
    target_weight_kg: weight ? Number(weight.replace(",", ".")) : null,
    notes: draft.notes.trim() || null,
  };
}
