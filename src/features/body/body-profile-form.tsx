import type { FocusEvent, ReactNode } from "react";
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
 * Height, birth date, sex and goal: what Phase 5.4 needs to compute a BMI and
 * a TDEE, and what Phase 5.3 needs to draw the target line on the chart.
 *
 * It saves field by field on blur, with no save button, the same way the
 * exercise rows of Phase 3 do. A profile isn't filled in once and left
 * alone — the target weight is the field you come back to — and a save
 * button turns "I changed my goal" into two taps plus the risk of walking
 * away from a form that looks done and saved nothing.
 *
 * The inputs are uncontrolled for the same reason as in
 * `routine-exercise-item.tsx`: the value lives in the DOM, only what changed
 * is sent, and nothing re-syncs them mid-typing. The one place that would
 * break — the profile arriving after the first paint, when `defaultValue`
 * has already been read — doesn't happen here, because the page holds the
 * form back until the query resolves.
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

/**
 * A row of mutually exclusive options.
 *
 * Buttons and not a `<select>`: there are two or three choices, they all fit
 * on one line of a phone, and a native picker hides the options behind a tap
 * for no gain. `aria-pressed` is what tells a screen reader which one is on.
 */
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
              // Tapping the selected option clears it. Sex is optional in the
              // schema and there is no third value to move to, so without
              // this the only way back out of an accidental tap would be SQL.
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

export function BodyProfileForm({ profile }: { profile: BodyProfile | null }) {
  const save = useSaveBodyProfile();

  const goal = toGoal(profile?.goal);
  const sex = toSex(profile?.sex);
  const age = ageOn(profile?.birth_date ?? null);

  function commit(patch: BodyProfilePatch) {
    save.mutate(patch);
  }

  /**
   * The shape every numeric field shares: parse, drop the write if the value
   * didn't move, and put the stored value back if what was typed wasn't a
   * number. Reverting in the input is the only feedback that fits — an error
   * message for "alto" in a centimetres field explains something the user
   * already knows.
   */
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

    // The clamped value goes back into the field, so 900 visibly becomes 260
    // instead of being silently stored as something else.
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
        {/* No save button means no moment that confirms the write, so the
            confirmation has to live here. */}
        <span aria-live="polite" className="text-xs text-muted">
          {save.isPending ? "Guardando…" : null}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        <Field label="Altura" hint="cm">
          <input
            // `type="text"` and not `type="number"`: a number input whose
            // content isn't a valid number reports its value as the empty
            // string, which is indistinguishable from a field the user
            // cleared on purpose — so a slip like "1.7.8" would wipe the
            // stored height. `inputMode` still brings up the numeric keypad.
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
          // `goal` is `not null` in the schema: clearing it falls back to the
          // column's own default rather than writing a null the check would
          // reject.
          onSelect={(value) => commit({ goal: value ?? "maintain" })}
        />

        <Field label="Peso objetivo" hint="kg, opcional">
          <input
            // Same as the height, plus one of its own: `type="number"` only
            // accepts a period, and the decimal separator under the thumb of
            // a Spanish keypad is the comma. "81,5" would arrive empty and
            // clear the target instead of setting it.
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
