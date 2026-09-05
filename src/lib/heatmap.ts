/**
 * El contrato con el widget de iOS.
 *
 * `buildLevels` devuelve un array plano de enteros 0–4, un valor por día,
 * del más viejo al más nuevo, con longitud exacta `weeks * 7` y alineado a
 * semanas completas. El componente <Heatmap> de la web y el `Heatmap` de
 * SwiftUI renderizan exactamente este mismo array: la web lo dibuja, y más
 * adelante Capacitor lo serializa al App Group para que lo lea el widget.
 *
 * Si esta forma cambia, cambia en los dos lados. Por eso vive acá sola,
 * sin dependencias, y con tests.
 */

export const HEATMAP_MAX_LEVEL = 4;

/** Lo mínimo que necesita una sesión para entrar al heatmap. */
export type HeatmapSession = {
  /** Fecha local en formato YYYY-MM-DD (columna `performed_on`). */
  performed_on: string;
  /** Volumen del día. Si no viene, la sesión cuenta como nivel 1. */
  set_count?: number;
};

export type HeatmapCell = {
  /** YYYY-MM-DD */
  date: string;
  level: number;
  sets: number;
  trained: boolean;
  /** Las últimas celdas de la semana en curso todavía no ocurrieron. */
  isFuture: boolean;
};

export type HeatmapOptions = {
  /** Cantidad de columnas. 26 ≈ medio año, que es lo que entra en un widget mediano. */
  weeks?: number;
  /** Día final del rango. Por defecto hoy. */
  endDate?: Date;
  /** 0 = domingo, 1 = lunes. Por defecto lunes. */
  weekStartsOn?: 0 | 1;
  /**
   * Cortes de volumen (en series) para los niveles 2, 3 y 4.
   * Cualquier día entrenado por debajo del primer corte es nivel 1.
   */
  thresholds?: [number, number, number];
};

const DEFAULTS = {
  weeks: 26,
  weekStartsOn: 1 as const,
  thresholds: [12, 20, 28] as [number, number, number],
};

const DAY_MS = 86_400_000;

/** YYYY-MM-DD en hora local. No usar toISOString: corre la fecha por UTC. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parsea YYYY-MM-DD a medianoche local. `new Date(str)` lo haría en UTC. */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Último día de la semana que contiene a `date`. */
function endOfWeek(date: Date, weekStartsOn: 0 | 1): Date {
  const offset = (date.getDay() - weekStartsOn + 7) % 7;
  return addDays(date, 6 - offset);
}

function levelFor(sets: number, thresholds: [number, number, number]): number {
  if (sets <= 0) return 0;
  if (sets >= thresholds[2]) return 4;
  if (sets >= thresholds[1]) return 3;
  if (sets >= thresholds[0]) return 2;
  return 1;
}

/**
 * La grilla completa, con fecha por celda. La usa la web para poder linkear
 * cada cuadradito al día que representa.
 */
export function buildHeatmap(
  sessions: readonly HeatmapSession[],
  options: HeatmapOptions = {},
): HeatmapCell[] {
  const weeks = options.weeks ?? DEFAULTS.weeks;
  const weekStartsOn = options.weekStartsOn ?? DEFAULTS.weekStartsOn;
  const thresholds = options.thresholds ?? DEFAULTS.thresholds;
  const today = startOfDay(options.endDate ?? new Date());

  // Se acumula por fecha: puede haber más de una sesión el mismo día.
  const volumeByDate = new Map<string, number>();
  for (const session of sessions) {
    const previous = volumeByDate.get(session.performed_on) ?? 0;
    volumeByDate.set(session.performed_on, previous + (session.set_count ?? 1));
  }

  // La grilla termina al cierre de la semana en curso, para que la última
  // columna quede completa igual que en GitHub.
  const last = endOfWeek(today, weekStartsOn);
  const first = addDays(last, -(weeks * 7 - 1));

  const cells: HeatmapCell[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(first, i);
    const key = toDateKey(date);
    const sets = volumeByDate.get(key) ?? 0;
    cells.push({
      date: key,
      sets,
      trained: sets > 0,
      level: levelFor(sets, thresholds),
      isFuture: date.getTime() > today.getTime(),
    });
  }

  return cells;
}

/**
 * La forma que consume el widget: solo los niveles, sin fechas.
 * Longitud garantizada = weeks * 7.
 */
export function buildLevels(
  sessions: readonly HeatmapSession[],
  options: HeatmapOptions = {},
): number[] {
  return buildHeatmap(sessions, options).map((cell) => cell.level);
}

/**
 * Racha actual de días entrenados, contando hacia atrás desde hoy.
 * Hoy sin entrenar no corta la racha —el día todavía no terminó—, pero
 * tampoco suma.
 */
export function currentStreak(
  sessions: readonly HeatmapSession[],
  endDate: Date = new Date(),
): number {
  const trained = new Set(sessions.map((s) => s.performed_on));
  const today = startOfDay(endDate);

  let streak = 0;
  let cursor = trained.has(toDateKey(today)) ? today : addDays(today, -1);

  while (trained.has(toDateKey(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

/** Días entrenados dentro del rango que devuelve `buildHeatmap`. */
export function trainedDays(cells: readonly HeatmapCell[]): number {
  return cells.reduce((total, cell) => total + (cell.trained ? 1 : 0), 0);
}

export const __internals = { levelFor, endOfWeek, addDays, DAY_MS };
