import { useState } from "react";
import { Button } from "../../components/button";
import { ConfirmButton } from "../../components/confirm-button";
import { EmptyState } from "../../components/empty-state";
import { Skeleton, SkeletonGroup, SkeletonLine } from "../../components/skeleton";
import { ErrorNote } from "../../components/status";
import { TextInput } from "../../components/text-input";
import { fromDateKey } from "../../lib/heatmap";
import { parseMeasure, WEIGHT_RANGE } from "./profile";
import { useDeleteWeight, useSaveWeight, useWeightEntries } from "./queries";
import { today } from "./weight-api";
import {
  formatDelta,
  formatKg,
  latestWeight,
  withDeltas,
  type WeightEntry,
} from "./weight";

/**
 * Logging your weight and reading back the series.
 *
 * It lives in Progreso and not in Perfil: weight is a time series you come
 * back to, next to the heatmap and — from Phase 5.3 — its chart, while Perfil
 * holds the static body data. Unlike the profile form, which saves on blur,
 * adding a weight is a form with a button: you are appending a row, not
 * editing a field that already exists.
 *
 * The current weight isn't a stored column: it is `latestWeight` off the top
 * of the series. One source of truth, so it can't drift from the list under
 * it.
 */

/** How a stored `measured_on` reads in the list: "22 sept". */
function formatDay(measuredOn: string): string {
  return fromDateKey(measuredOn).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
  });
}

function AddForm() {
  const save = useSaveWeight();
  const [date, setDate] = useState(today());
  const [weight, setWeight] = useState("");

  function submit() {
    // The same parser as the target weight: clamp into range, drop what isn't
    // a number. `null` (empty) and `undefined` (not a number) both mean there
    // is nothing to record yet.
    const parsed = parseMeasure(weight, WEIGHT_RANGE);
    if (parsed === null || parsed === undefined) return;

    save.mutate(
      { measuredOn: date, weightKg: parsed },
      // Clear the weight but keep the date, so logging a few catch-up days in
      // a row is just retyping the number.
      { onSuccess: () => setWeight("") },
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex gap-2"
    >
      <TextInput
        type="date"
        value={date}
        // No future weigh-ins; the past is open, for logging a day late.
        max={today()}
        onChange={(event) => setDate(event.target.value)}
        aria-label="Fecha"
        className="min-w-0 flex-1 tnum"
      />
      <TextInput
        // `type="text"` with `inputMode`, not `type="number"`: same reason as
        // the profile fields — a number input reports an invalid value as the
        // empty string, and it rejects the comma the Spanish keypad offers.
        type="text"
        inputMode="decimal"
        value={weight}
        onChange={(event) => setWeight(event.target.value)}
        aria-label="Peso en kilos"
        placeholder="kg"
        className="w-20 tnum"
      />
      <Button type="submit" variant="primary" disabled={save.isPending}>
        {save.isPending ? "…" : "Anotar"}
      </Button>
    </form>
  );
}

function EntryRow({
  entry,
  delta,
}: {
  entry: WeightEntry;
  delta: number | null;
}) {
  const remove = useDeleteWeight();

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="w-16 shrink-0 text-sm text-muted tnum">
        {formatDay(entry.measured_on)}
      </span>
      <span className="font-semibold tnum">{formatKg(entry.weight_kg)} kg</span>
      {delta !== null ? (
        <span className="text-xs text-muted tnum">{formatDelta(delta)}</span>
      ) : null}
      <ConfirmButton
        label="Borrar"
        confirmLabel="¿Seguro?"
        size="sm"
        className="ml-auto"
        disabled={remove.isPending}
        onConfirm={() => remove.mutate(entry.id)}
      />
    </li>
  );
}

/** Rows of date, weight and delta, the shape `EntryRow` fills in. */
function EntriesSkeleton() {
  return (
    <SkeletonGroup>
      <ul className="mt-2 divide-y divide-line">
        {[0, 1, 2].map((index) => (
          <li key={index} className="flex items-center gap-3 py-2.5">
            <SkeletonLine className="w-16 shrink-0 text-sm" />
            <SkeletonLine className="w-14 font-semibold" />
            <SkeletonLine className="w-8 text-xs" />
            <Skeleton className="ml-auto h-7 w-16 rounded-lg" />
          </li>
        ))}
      </ul>
    </SkeletonGroup>
  );
}

export function WeightLog() {
  const { data: entries, isPending, error } = useWeightEntries();

  const rows = entries ? withDeltas(entries) : [];
  const current = entries ? latestWeight(entries) : null;

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Peso</h2>
        {current !== null ? (
          <span className="text-sm text-muted tnum">
            Actual {formatKg(current)} kg
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        <AddForm />
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorNote error={error} />
        </div>
      ) : null}

      {/* The form doesn't depend on the list, so it is usable right away;
          only the entries wait. */}
      {isPending ? <EntriesSkeleton /> : null}

      {!isPending && !error && !rows.length ? (
        <div className="mt-4">
          <EmptyState
            title="Todavía no anotaste tu peso"
            description="Registrá tu primer peso arriba y acá vas a ver la evolución."
          />
        </div>
      ) : null}

      {rows.length ? (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((row) => (
            <EntryRow key={row.id} entry={row} delta={row.delta} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
