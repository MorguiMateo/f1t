import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/button";
import { ConfirmButton } from "../../components/confirm-button";
import { Skeleton, SkeletonGroup, SkeletonLine } from "../../components/skeleton";
import { ErrorNote } from "../../components/status";
import { TextInput } from "../../components/text-input";
import { fromDateKey } from "../../lib/heatmap";
import { prepareWeightSubmission, type WeightSubmission } from "./weight-submission";
import { useDeleteWeight, useSaveWeight, useWeightEntries } from "./queries";
import { today } from "./weight-api";
import {
  formatDelta,
  formatKg,
  latestWeight,
  withDeltas,
  type WeightEntry,
} from "./weight";

/** Weight is a dated series; the current value is derived, never stored twice. */

/** How a stored `measured_on` reads in the list: "22 sept". */
function formatDay(measuredOn: string): string {
  return fromDateKey(measuredOn).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function AddForm({ entries, available, focusRequest }: { entries: WeightEntry[]; available: boolean; focusRequest: number }) {
  const save = useSaveWeight();
  const [date, setDate] = useState(today());
  const [weight, setWeight] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [replacement, setReplacement] = useState<Extract<WeightSubmission, { status: "ready" }> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const draft = useRef({ date, weight });
  const id = useId();

  useEffect(() => {
    if (focusRequest > 0) input.current?.focus();
  }, [focusRequest]);

  function write(submission: Extract<WeightSubmission, { status: "ready" }>) {
    const sent = { date, weight };
    save.mutate({ measuredOn: submission.measuredOn, weightKg: submission.weightKg }, {
      onSuccess: () => {
        if (draft.current.date === sent.date && draft.current.weight === sent.weight) {
          draft.current = { date: sent.date, weight: "" }; setWeight(""); setSaved(true);
        }
      },
    });
    setReplacement(null);
  }
  function submit() {
    if (!available || save.isPending) return;
    const submission = prepareWeightSubmission(weight, date, entries, today());
    setSaved(false);
    if (submission.status === "invalid") { setValidation(submission.message); return; }
    setValidation(null);
    if (submission.status === "unchanged") { setSaved(true); return; }
    if (submission.previous) setReplacement(submission);
    else write(submission);
  }
  function changed() { setValidation(null); setReplacement(null); setSaved(false); }
  function confirmReplacement() {
    const current = prepareWeightSubmission(weight, date, entries, today());
    if (current.status !== "ready" || current.previous?.id !== replacement?.previous?.id || current.previous?.weight_kg !== replacement?.previous?.weight_kg) {
      setReplacement(null); setValidation("El registro cambió. Revisá el historial y volvé a anotar para confirmar el nuevo valor."); return;
    }
    write(current);
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label htmlFor={id} className="block text-sm font-medium">Peso (kg)</label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <input id={id} ref={input} type="text" inputMode="decimal" value={weight}
          onChange={(event) => { draft.current = { ...draft.current, weight: event.target.value }; setWeight(event.target.value); changed(); }}
          aria-label="Peso en kilos" aria-invalid={Boolean(validation)} aria-describedby={`${id}-help${validation ? ` ${id}-error` : ""}`}
          placeholder="Ej.: 75,5" className="min-w-24 flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-sm tnum" />
        <Button type="submit" variant="primary" disabled={save.isPending || !available || !date}>
          {save.isPending ? "Guardando…" : "Anotar"}
        </Button>
      </div>
      <p id={`${id}-help`} className="mt-2 text-xs text-muted">20–400 kg · hasta 1 decimal · coma o punto.</p>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer content-center text-sm text-muted">
          {date === today() ? "Hoy" : date ? fromDateKey(date).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : "Elegir fecha"} · Cambiar fecha
        </summary>
        <TextInput type="date" value={date} max={today()} required
          onChange={(event) => { draft.current = { ...draft.current, date: event.target.value }; setDate(event.target.value); changed(); }} aria-label="Fecha del peso" className="w-full tnum" />
        <p className="mt-2 text-xs text-muted">Para corregir un peso, anotá el nuevo valor en la misma fecha. Te pediremos confirmar el reemplazo.</p>
      </details>
      {replacement?.previous ? (
        <div className="mt-3 rounded-xl border border-line p-3" role="group" aria-label="Confirmar reemplazo de peso">
          <p className="text-sm">El {fromDateKey(replacement.measuredOn).toLocaleDateString("es")} tiene {formatKg(replacement.previous.weight_kg)} kg. ¿Reemplazar por {formatKg(replacement.weightKg)} kg?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={confirmReplacement} variant="primary" disabled={save.isPending || !available}>Confirmar reemplazo</Button>
            <Button onClick={() => { setReplacement(null); input.current?.focus(); }}>Conservar original</Button>
          </div>
        </div>
      ) : null}
      {validation ? <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-warn">{validation}</p> : null}
      {!available ? <p className="mt-2 text-sm text-muted">Necesitamos cargar el historial antes de guardar para comprobar si esta fecha ya tiene un peso.</p> : null}
      {saved ? <p role="status" className="mt-2 text-sm text-muted">Peso guardado.</p> : null}
      {save.error ? <p role="alert" className="mt-2 text-sm text-warn">No se guardó el peso. Conservamos tu valor; volvé a tocar Anotar para reintentar. {save.error.message}</p> : null}
    </form>
  );
}

function EntryRow({
  entry,
  delta,
  onDeleteError,
}: {
  entry: WeightEntry;
  delta: number | null;
  onDeleteError: () => void;
}) {
  const remove = useDeleteWeight();

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-16 text-sm text-muted tnum">
          {formatDay(entry.measured_on)}
        </span>
        <span className="font-semibold tnum">{formatKg(entry.weight_kg)} kg</span>
        {delta !== null ? (
          <span className="text-xs text-muted tnum" aria-label={`${formatDelta(delta)} kilogramos respecto del registro anterior`}>{formatDelta(delta)} kg</span>
        ) : null}
        <ConfirmButton
          label="Borrar"
          confirmLabel="¿Seguro?"
          size="sm"
          className="ml-auto min-h-11"
          disabled={remove.isPending}
          onConfirm={() => remove.mutate(entry.id, { onError: onDeleteError })}
        />
      </div>
      {remove.error ? (
        <p role="alert" className="mt-1 text-xs text-warn">
          No se borró el peso. Volvé a tocar Borrar para reintentar. {remove.error.message}
        </p>
      ) : null}
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

export function WeightLog({ focusRequest = 0 }: { focusRequest?: number }) {
  const history = useRef<HTMLDetailsElement>(null);
  const { data: entries, isPending, error } = useWeightEntries();

  const rows = entries ? withDeltas(entries) : [];
  const current = entries ? latestWeight(entries) : null;

  return (
    <section id="peso" className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Peso</h2>
        {current !== null ? (
          <span className="text-sm text-muted tnum">
            Último: {formatKg(current)} kg · {entries?.[0] ? fromDateKey(entries[0].measured_on).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : ""}
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        <AddForm entries={entries ?? []} available={!isPending && !error} focusRequest={focusRequest} />
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
        <p className="mt-3 text-sm text-muted">Sin registros de peso.</p>
      ) : null}

      {rows.length ? (
        <details ref={history} className="mt-3 border-t border-line">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">
            Historial · {rows.length}
          </summary>
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <EntryRow
                key={row.id}
                entry={row}
                delta={row.delta}
                onDeleteError={() => { if (history.current) history.current.open = true; }}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
