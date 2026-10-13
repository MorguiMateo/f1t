import { useId, useState, type ChangeEvent, type ReactNode } from "react";
import { Skeleton, SkeletonGroup, SkeletonLine } from "../../components/skeleton";
import type { BodyProfile, BodyProfilePatch } from "./api";
import { useSaveBodyProfile } from "./queries";
import { canonicalProfileValue as canonical, resolveProfileDraft, type LocalProfileDraft } from "./profile-draft";
import type { ProfileField } from "./profile-cache";
import { ageOn, GOALS, HEIGHT_RANGE, MIN_BIRTH_DATE, parseBirthDate, parseMeasure, SEXES, toGoal, toSex, WEIGHT_RANGE } from "./profile";
import { toDateKey } from "../../lib/heatmap";

const INPUT_CLASS = "mt-1.5 w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm placeholder:text-muted tnum";
const LABELS: Record<ProfileField, string> = {
  height_cm: "Altura", birth_date: "Fecha de nacimiento", sex: "Sexo", goal: "Objetivo", target_weight_kg: "Peso objetivo",
};
type Drafts = Record<ProfileField, string>;
type LocalDraft = LocalProfileDraft;
function values(profile: BodyProfile | null): Drafts {
  return { height_cm: profile?.height_cm?.toString() ?? "", birth_date: profile?.birth_date ?? "", sex: toSex(profile?.sex) ?? "", goal: toGoal(profile?.goal), target_weight_kg: profile?.target_weight_kg?.toString() ?? "" };
}

export function BodyProfileFormSkeleton() {
  return <SkeletonGroup className="rounded-xl border border-line bg-surface p-5">
    <h2 className="font-semibold">Datos corporales</h2>
    {[0, 1, 2, 3, 4].map((index) => <div key={index} className="mt-4"><SkeletonLine className="w-32 text-sm" /><Skeleton className="mt-2 h-12 w-full rounded-xl" /></div>)}
  </SkeletonGroup>;
}

/** Drafts live independently from the optimistic query cache and survive failed writes/refetches. */
export function BodyProfileForm({ profile }: { profile: BodyProfile | null }) {
  const save = useSaveBodyProfile();
  const id = useId();
  const [local, setLocal] = useState<Partial<Record<ProfileField, LocalDraft>>>({});
  const [validation, setValidation] = useState<Partial<Record<ProfileField, string>>>({});
  const stored = values(profile);
  function parsedDraft(field: ProfileField, raw: string) {
    return field === "height_cm" || field === "target_weight_kg" ? parseMeasure(raw, field === "height_cm" ? HEIGHT_RANGE : WEIGHT_RANGE) : raw || null;
  }
  const drafts = { ...stored };
  const statuses: Record<ProfileField, "Guardado" | "Guardando…" | "Sin guardar"> = { height_cm: "Guardado", birth_date: "Guardado", sex: "Guardado", goal: "Guardado", target_weight_kg: "Guardado" };
  for (const field of Object.keys(stored) as ProfileField[]) {
    const entry = local[field];
    const resolved = resolveProfileDraft(stored[field], entry, save.fieldStates[field], entry ? parsedDraft(field, entry.raw) : undefined);
    drafts[field] = resolved.raw; statuses[field] = resolved.status;
  }
  function change(field: ProfileField, value: string) {
    setLocal((previous) => ({ ...previous, [field]: { raw: value, acknowledged: save.fieldStates[field]?.status === "saved" ? canonical(save.fieldStates[field]?.value) : previous[field]?.acknowledged ?? stored[field] } }));
    setValidation((previous) => ({ ...previous, [field]: undefined }));
  }
  function commit(field: ProfileField, raw = drafts[field]) {
    let value: string | number | null | undefined = raw || null;
    if (field === "height_cm" || field === "target_weight_kg") {
      value = parseMeasure(raw, field === "height_cm" ? HEIGHT_RANGE : WEIGHT_RANGE);
      if (value === undefined) {
        setValidation((previous) => ({ ...previous, [field]: field === "height_cm" ? "Ingresá entre 80 y 260 cm, sin decimales, o dejá el campo vacío." : "Ingresá entre 20 y 400 kg, hasta un decimal, o dejá el campo vacío. Podés usar coma o punto." })); return;
      }
    } else if (field === "birth_date") {
      value = parseBirthDate(raw);
      if (value === undefined) { setValidation((previous) => ({ ...previous, [field]: "Elegí una fecha válida entre 1900 y hoy." })); return; }
    }
    setValidation((previous) => ({ ...previous, [field]: undefined }));
    const state = save.fieldStates[field];
    if (state?.status === "pending" && canonical(state.value) === canonical(value)) return;
    const acknowledged = state?.status === "saved" ? canonical(state.value) : local[field]?.acknowledged ?? stored[field];
    if ((!state || state.status === "saved") && canonical(value) === acknowledged) return;
    save.mutate({ [field]: value } as BodyProfilePatch);
  }
  function status(field: ProfileField) { return validation[field] ? "Sin guardar" : statuses[field]; }
  function field(field: ProfileField, hint: string, children: ReactNode) {
    const error = validation[field] ?? save.failures[field]?.message;
    return <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">{field === "sex" || field === "goal" ? <p className="text-sm font-medium">{LABELS[field]}</p> : <label htmlFor={`${id}-${field}`} className="text-sm font-medium">{LABELS[field]}</label>}<span role="status" className="text-xs text-muted">{status(field)}</span></div>
      <p id={`${id}-${field}-help`} className="mt-1 text-xs text-muted">{hint}</p>
      {children}
      {error ? <p id={`${id}-${field}-error`} role="alert" className="mt-2 text-sm text-warn">{error}</p> : null}
      {save.failures[field] ? <button type="button" onClick={() => commit(field)} className="mt-1 min-h-11 text-sm font-medium text-accent">Reintentar guardado de {LABELS[field].toLowerCase()}</button> : null}
    </div>;
  }
  function inputProps(field: ProfileField) {
    return { id: `${id}-${field}`, value: drafts[field], onChange: (event: ChangeEvent<HTMLInputElement>) => change(field, event.target.value), onBlur: () => commit(field), "aria-invalid": Boolean(validation[field] || save.failures[field]), "aria-describedby": `${id}-${field}-help${validation[field] || save.failures[field] ? ` ${id}-${field}-error` : ""}`, className: INPUT_CLASS };
  }
  function choices(field: "sex" | "goal", options: readonly { value: string; label: string; hint?: string }[]) {
    return <fieldset aria-describedby={`${id}-${field}-help${save.failures[field] ? ` ${id}-${field}-error` : ""}`}>
      <legend className="sr-only">{LABELS[field]}</legend>
      <div id={`${id}-${field}`} className="mt-2 grid gap-2 sm:grid-cols-3">
        {options.map((option) => <button key={option.value} type="button" aria-pressed={drafts[field] === option.value} onClick={() => { change(field, option.value); commit(field, option.value); }} className={`min-h-11 rounded-xl border px-3 py-3 text-sm ${drafts[field] === option.value ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface-2"}`}><span className="block font-medium">{option.label}</span>{option.hint ? <span className="mt-1 block text-xs">{option.hint}</span> : null}</button>)}
      </div>
      {field === "sex" && drafts.sex ? <button type="button" onClick={() => { change("sex", ""); commit("sex", ""); }} className="mt-1 min-h-11 text-sm text-muted">Quitar sexo</button> : null}
    </fieldset>;
  }
  const age = ageOn(drafts.birth_date || null);
  return <div className="grid items-start gap-4 lg:grid-cols-2">
    <section id="datos-corporales" className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Datos corporales</h2>
      <p className="mt-2 text-sm text-muted">Son opcionales para usar F1t. Podés guardar tu altura, fecha de nacimiento y sexo.</p>
      <div className="mt-4 space-y-4">
        {field("height_cm", "Opcional · centímetros (cm), 80–260, sin decimales. Vacío elimina el dato.", <input {...inputProps("height_cm")} type="text" inputMode="numeric" placeholder="Ej.: 178" />)}
        {field("birth_date", `Opcional${age === null ? "" : ` · ${age} años`}. Se usa para calcular la edad. Vacío elimina el dato.`, <input {...inputProps("birth_date")} type="date" min={MIN_BIRTH_DATE} max={toDateKey(new Date())} />)}
        {field("sex", "Opcional; podés quitar el dato cuando quieras.", choices("sex", SEXES))}
      </div>
      <p className="mt-4 text-xs text-muted">Los números y fechas se guardan al salir del campo; las opciones, al elegirlas.</p>
    </section>
    <section id="objetivo-corporal" className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Objetivo corporal</h2>
      <p className="mt-2 text-sm text-muted">La meta de peso es una referencia para tu curva.</p>
      <div className="mt-4 space-y-4">
        {field("goal", "Elegí si querés bajar, mantener o subir de peso.", choices("goal", GOALS))}
        {field("target_weight_kg", "Opcional · kilogramos (kg), 20–400, hasta 1 decimal. Vacío elimina la meta.", <input {...inputProps("target_weight_kg")} type="text" inputMode="decimal" placeholder="Ej.: 75,5" />)}
      </div>
    </section>
  </div>;
}
