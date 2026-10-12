import { useEffect, useState } from "react";
import { ErrorNote } from "../../components/status";
import { device, type Reminder } from "../../lib/device";
import { WEEK_ORDER, WEEKDAY_SHORT_ES } from "../routines/weekdays";

const REMINDER_ID = "workout";
const DEFAULT_TIME = "18:00";

export function ReminderSettings() {
  const [saved, setSaved] = useState<Reminder | null>(null);
  const [time, setTime] = useState(DEFAULT_TIME);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<"save" | "cancel" | null>(null);
  const busy = operation !== null;
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    void device.getReminder().then((reminder) => {
      if (!active) return;
      setSaved(reminder);
      if (reminder) {
        setTime(reminder.at);
        setWeekdays(reminder.weekdays);
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  function toggleDay(day: number) {
    setWeekdays((days) => days.includes(day)
      ? days.filter((value) => value !== day)
      : [...days, day].sort((a, b) => a - b));
  }

  async function save() {
    setOperation("save");
    setError(null);
    setMessage(null);
    const reminder: Reminder = {
      id: REMINDER_ID,
      title: "Hora de entrenar",
      body: "Tu entrenamiento de F1t te espera.",
      at: time,
      weekdays,
    };
    try {
      const scheduled = await device.scheduleReminder(reminder);
      if (scheduled) {
        setSaved(reminder);
        setMessage("Recordatorio programado para los días elegidos en este dispositivo.");
      } else {
        setMessage("Las notificaciones están desactivadas. Habilitalas en Ajustes de iOS y volvé a guardar.");
      }
    } catch (reason) {
      setError(reason);
      try { setSaved(await device.getReminder()); } catch { /* Keep the original error visible. */ }
    } finally {
      setOperation(null);
    }
  }

  async function cancel() {
    setOperation("cancel");
    setError(null);
    setMessage(null);
    try {
      await device.cancelReminder(REMINDER_ID);
      setSaved(null);
      setMessage("Recordatorio desactivado.");
    } catch (reason) {
      setError(reason);
    } finally {
      setOperation(null);
    }
  }

  if (!device.isNative) return null;

  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-5" aria-label="Recordatorio de entrenamiento">
      <h2 className="font-semibold">Recordatorio de entrenamiento</h2>
      <p className="mt-1 text-sm text-muted">Elegí la hora y los días. Esta preferencia pertenece a este dispositivo; cambiar los controles no modifica el aviso hasta guardar.</p>
      {loading ? <p className="mt-3 text-sm text-muted">Cargando…</p> : (
        <>
          <label className="mt-4 block text-sm font-medium" htmlFor="reminder-time">Hora local</label>
          <input id="reminder-time" type="time" value={time} onChange={(event) => setTime(event.target.value)}
            className="mt-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink" />
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Días</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEK_ORDER.map((day) => (
                <label key={day} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-2 text-sm">
                  <input type="checkbox" checked={weekdays.includes(day)} onChange={() => toggleDay(day)} />
                  {WEEKDAY_SHORT_ES[day]}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="mt-3 text-sm text-muted" aria-live="polite">
            {saved ? `Configurado: ${saved.at} · ${WEEK_ORDER.filter((day) => saved.weekdays.includes(day)).map((day) => WEEKDAY_SHORT_ES[day]).join(", ")}. La entrega depende del permiso de notificaciones.` : "No hay recordatorio configurado."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={busy || !time || !weekdays.length}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50">
              {operation === "save" ? "Guardando…" : "Guardar recordatorio"}
            </button>
            {saved ? <button type="button" onClick={() => void cancel()} disabled={busy}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium disabled:opacity-50">{operation === "cancel" ? "Desactivando…" : "Desactivar"}</button> : null}
          </div>
          {message ? <p role="status" className="mt-3 text-sm text-muted">{message}</p> : null}
          {error ? <div className="mt-3"><ErrorNote error={error} title="No se pudo actualizar el recordatorio" /></div> : null}
        </>
      )}
    </section>
  );
}
