import { useCallback, useEffect, useRef, useState } from "react";
import { device } from "../../lib/device";

const FORMAT = new Intl.NumberFormat("es-AR");
const TIME = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function StepsToday() {
  const [reading, setReading] = useState<{ steps: number; at: Date } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [consulted, setConsulted] = useState(false);
  const lifecycle = useRef({ active: false, inFlight: false, revision: 0 });

  const refresh = useCallback(async (requestPermission = false) => {
    const scope = lifecycle.current;
    if (scope.inFlight) return;
    scope.inFlight = true;
    const ticket = ++scope.revision;
    setLoading(true);
    setReading((value) => value && sameDay(value.at, new Date()) ? value : null);
    try {
      const value = await device.getStepsToday({ requestPermission });
      if (scope.active && scope.revision === ticket) {
        setReading(value === null ? null : { steps: value, at: new Date() });
        setFailed(false);
      }
    } catch {
      if (scope.active && scope.revision === ticket) {
        setReading(null);
        setFailed(true);
      }
    } finally {
      if (scope.revision === ticket) {
        scope.inFlight = false;
        if (scope.active) setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!device.isNative) return;
    const scope = lifecycle.current;
    scope.active = true;
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    return () => {
      scope.active = false;
      scope.revision++;
      scope.inFlight = false;
      window.clearTimeout(initial);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [refresh]);

  if (!device.isNative) return null;
  const current = reading && sameDay(reading.at, new Date()) ? reading : null;
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-5" aria-label="Pasos de hoy">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Pasos de hoy</h2>
        {!current ? <button type="button" className="min-h-11 rounded-lg border border-line px-3 text-sm disabled:opacity-50"
          disabled={loading} onClick={() => { setConsulted(true); void refresh(true); }}>
          {loading ? "Leyendo…" : current ? "Actualizar" : "Consultar"}
        </button> : null}
      </div>
      <div aria-live="polite" aria-busy={loading}>
        {current ? <>
          <p className="mt-1 text-2xl font-semibold">{FORMAT.format(current.steps)}</p>
          <p className="mt-1 text-xs text-muted">Lectura de las {TIME.format(current.at)}</p>
        </> : loading ? <p className="mt-1 text-sm text-muted">Consultando disponibilidad…</p>
          : <p className="mt-1 text-sm text-muted">{failed ? "No se pudieron leer los pasos. Tocá Consultar para reintentar."
            : consulted ? "Pasos no disponibles. Revisá Movimiento y condición física en Ajustes de iOS."
              : "Tocá Consultar para habilitar los pasos de Movimiento y condición física."}</p>}
      </div>
      <details className="mt-2 text-sm text-muted">
        <summary className="flex min-h-11 cursor-pointer items-center">Opciones de pasos</summary>
        {current ? <button type="button" className="mb-2 min-h-11 text-sm text-accent disabled:opacity-50" disabled={loading} onClick={() => { void refresh(); }}>{loading ? "Leyendo…" : "Actualizar lectura"}</button> : null}
        <p className="font-medium">Agregar widget de pasos</p>
        <p>Mantené presionada la pantalla de inicio, tocá Editar y agregá FIT → Pasos de hoy. También podés agregarlo a la pantalla bloqueada.</p>
        <p className="mt-2">Muestra la última lectura de hoy. Abrí FIT para actualizar; iOS decide cuándo refrescar el widget.</p>
      </details>
    </section>
  );
}
