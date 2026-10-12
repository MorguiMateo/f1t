export type ProfileFieldState = { value: unknown; status: "pending" | "saved" | "failed" };
export type LocalProfileDraft = { raw: string; acknowledged: string };
export function canonicalProfileValue(value: unknown): string { return value == null ? "" : String(value); }

/** Only a matching server acknowledgement releases a draft back to the refreshed profile. */
export function resolveProfileDraft(stored: string, local: LocalProfileDraft | undefined, state: ProfileFieldState | undefined, parsed: unknown): { raw: string; status: "Guardado" | "Guardando…" | "Sin guardar" } {
  if (!local) return { raw: stored, status: "Guardado" };
  if (parsed === undefined) return { raw: local.raw, status: "Sin guardar" };
  const value = canonicalProfileValue(parsed);
  if (state?.status === "saved" && value === canonicalProfileValue(state.value)) return { raw: stored, status: "Guardado" };
  if (state?.status === "pending" && value === canonicalProfileValue(state.value)) return { raw: local.raw, status: "Guardando…" };
  if (state?.status === "failed" || state?.status === "pending") return { raw: local.raw, status: "Sin guardar" };
  const acknowledged = state?.status === "saved" ? canonicalProfileValue(state.value) : local.acknowledged;
  return { raw: local.raw, status: value === acknowledged ? "Guardado" : "Sin guardar" };
}
