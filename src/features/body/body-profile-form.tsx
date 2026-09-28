import type { FocusEvent, ReactNode } from "react";
import { Skeleton, SkeletonGroup, SkeletonLine } from "../../components/skeleton";
import { ErrorNote } from "../../components/status";
import type { BodyProfile, BodyProfilePatch } from "./api";
import { useSaveBodyProfile } from "./queries";
import {
  ageOn,
  GOALS,
  HEIGHT_RANGE,
  MIN_BIRTH_DATE,
  parseBirthDate,
  parseMeasure,
  SEXES,
  toGoal,
  toSex,
  WEIGHT_RANGE,
} from "./profile";

/**
 * Saves field by field on blur with no save button: the target weight is
 * revisited often, and a button risks leaving a form that looks saved and
 * isn't. Inputs are uncontrolled, which only works because the page holds the
 * form back until the profile loads (`defaultValue` is read once).
 */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span className="text-xs text-muted tnum">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

const INPUT_CLASS =
  "mt-1.5 w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm placeholder:text-muted tnum";

function Choice<T extends string>({
  legend,
  options,
  value,
  onSelect,
  disabled,
}: {
  legend: string;
  options: readonly { value: T; label: string; hint?: string }[];
  value: T | null;
  onSelect: (value: T | null) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-1.5 flex gap-2">
        {options.map((option) => {
          const isOn = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isOn}
              // Tapping the selected option clears it, the only way to unset
              // the optional sex after an accidental tap.
              onClick={() => onSelect(isOn ? null : option.value)}
              className={[
                "flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-50",
                isOn
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line bg-surface-2 text-ink hover:bg-surface",
              ].join(" ")}
            >
              <span className="block">{option.label}</span>
              {option.hint ? (
                <span
                  className={[
                    "mt-0.5 block text-[11px] font-normal",
                    isOn ? "opacity-80" : "text-muted",
                  ].join(" ")}
                >
                  {option.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function BodyProfileFormSkeleton() {
  const field = (input: string, count = 1) => (
    <div>
      <SkeletonLine className="w-24 text-sm font-medium" />
      <div className="mt-1.5 flex gap-2">
        {Array.from({ length: count }, (_, index) => (
          <Skeleton key={index} className={`${input} flex-1 rounded-xl`} />
        ))}
      </div>
    </div>
  );

  return (
    <SkeletonGroup className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Datos corporales</h2>
      <div className="mt-4 space-y-4">
        {field("h-11.5")}
        {field("h-11.5")}
        {field("h-10.5", 2)}
        {field("h-15", 3)}
        {field("h-11.5")}
      </div>
    </SkeletonGroup>
  );
}

export function BodyProfileForm({ profile }: { profile: BodyProfile | null }) {
  const save = useSaveBodyProfile();

  const goal = toGoal(profile?.goal);
  const sex = toSex(profile?.sex);
  const age = ageOn(profile?.birth_date ?? null);

  function commit(patch: BodyProfilePatch) {
    save.mutate(patch);
  }

  // Non-number reverts to stored value; error message wouldn't add information.
  function saveMeasure(
    event: FocusEvent<HTMLInputElement>,
    range: typeof HEIGHT_RANGE | typeof WEIGHT_RANGE,
    current: number | null,
    apply: (value: number | null) => BodyProfilePatch,
  ) {
    const parsed = parseMeasure(event.target.value, range);

    if (parsed === undefined) {
      event.target.value = current?.toString() ?? "";
      return;
    }

    // Shown back so 900 visibly becomes 260 instead of silently stored.
    event.target.value = parsed?.toString() ?? "";
    if (parsed === current) return;
    commit(apply(parsed));
  }

  function saveBirthDate(event: FocusEvent<HTMLInputElement>) {
    const parsed = parseBirthDate(event.target.value);
    const current = profile?.birth_date ?? null;

    if (parsed === undefined) {
      event.target.value = current ?? "";
      return;
    }
    if (parsed === current) return;
    commit({ birth_date: parsed });
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Datos corporales</h2>
        {/* With no save button, this is the only write confirmation. */}
        <span aria-live="polite" className="text-xs text-muted">
          {save.isPending ? "Guardando…" : null}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        <Field label="Altura" hint="cm">
          <input
            // Not `type="number"`: it reports invalid text like "1.7.8" as "",
            // indistinguishable from a cleared field, which would wipe the height.
            type="text"
            inputMode="numeric"
            defaultValue={profile?.height_cm ?? ""}
            onBlur={(event) =>
              saveMeasure(event, HEIGHT_RANGE, profile?.height_cm ?? null, (v) => ({
                height_cm: v,
              }))
            }
            placeholder="178"
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          label="Fecha de nacimiento"
          hint={age === null ? undefined : `${age} años`}
        >
          <input
            type="date"
            min={MIN_BIRTH_DATE}
            defaultValue={profile?.birth_date ?? ""}
            onBlur={saveBirthDate}
            className={INPUT_CLASS}
          />
        </Field>

        <Choice
          legend="Sexo"
          options={SEXES}
          value={sex}
          disabled={save.isPending}
          onSelect={(value) => commit({ sex: value })}
        />

        <Choice
          legend="Objetivo"
          options={GOALS}
          value={goal}
          disabled={save.isPending}
          // `goal` is `not null`: clearing falls back to the column default.
          onSelect={(value) => commit({ goal: value ?? "maintain" })}
        />

        <Field label="Peso objetivo" hint="kg, opcional">
          <input
            // Also, `type="number"` rejects the comma of a Spanish keypad, so
            // "81,5" would arrive empty and clear the target.
            type="text"
            inputMode="decimal"
            defaultValue={profile?.target_weight_kg ?? ""}
            onBlur={(event) =>
              saveMeasure(
                event,
                WEIGHT_RANGE,
                profile?.target_weight_kg ?? null,
                (v) => ({ target_weight_kg: v }),
              )
            }
            placeholder="75"
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      {save.error ? (
        <div className="mt-4">
          <ErrorNote error={save.error} />
        </div>
      ) : null}
    </section>
  );
}
