/**
 * The contract with the iOS widget.
 *
 * `buildLevels` returns a flat array of integers 0–4, one value per day,
 * oldest to newest, with length exactly `weeks * 7` and aligned to whole
 * weeks. The web's <Heatmap> component and SwiftUI's `Heatmap` render this
 * very same array: the web draws it, and later on Capacitor serialises it to
 * the App Group for the widget to read.
 *
 * If this shape changes, it changes on both sides. That is why it lives here
 * on its own, with no dependencies, and with tests.
 */

export const HEATMAP_MAX_LEVEL = 4;

/** The bare minimum a session needs to enter the heatmap. */
export type HeatmapSession = {
  /** Local date in YYYY-MM-DD format (the `performed_on` column). */
  performed_on: string;
  /** The day's volume. If absent, the session counts as level 1. */
  set_count?: number;
};

export type HeatmapCell = {
  /** YYYY-MM-DD */
  date: string;
  level: number;
  sets: number;
  trained: boolean;
  /** The last cells of the current week haven't happened yet. */
  isFuture: boolean;
};

export type HeatmapOptions = {
  /** Column count. 26 ≈ half a year, which is what fits a medium widget. */
  weeks?: number;
  /** Final day of the range. Defaults to today. */
  endDate?: Date;
  /** 0 = Sunday, 1 = Monday. Defaults to Monday. */
  weekStartsOn?: 0 | 1;
  /**
   * Volume cutoffs (in sets) for levels 2, 3 and 4.
   * Any day trained below the first cutoff is level 1.
   */
  thresholds?: [number, number, number];
};

const DEFAULTS = {
  weeks: 26,
  weekStartsOn: 1 as const,
  thresholds: [12, 20, 28] as [number, number, number],
};

const DAY_MS = 86_400_000;

/** YYYY-MM-DD in local time. Don't use toISOString: it shifts the date by UTC. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parses YYYY-MM-DD to local midnight. `new Date(str)` would do it in UTC. */
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

/** Last day of the week containing `date`. */
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
 * The first day of the grid, as YYYY-MM-DD.
 *
 * It exists so the query knows what to ask Postgres for without recomputing
 * where the range begins on its own: week alignment lives in this file and
 * nowhere else. Asking for too much means fetching rows that never get
 * drawn; asking for too little means empty squares on days that were
 * actually trained.
 */
export function heatmapStart(options: HeatmapOptions = {}): string {
  const weeks = options.weeks ?? DEFAULTS.weeks;
  const weekStartsOn = options.weekStartsOn ?? DEFAULTS.weekStartsOn;
  const today = startOfDay(options.endDate ?? new Date());
  // The grid ends at the close of the current week, so the last column comes
  // out complete just like GitHub's.
  const last = endOfWeek(today, weekStartsOn);
  return toDateKey(addDays(last, -(weeks * 7 - 1)));
}

/**
 * The full grid, with a date per cell. The web uses it so each little square
 * can link to the day it represents.
 */
export function buildHeatmap(
  sessions: readonly HeatmapSession[],
  options: HeatmapOptions = {},
): HeatmapCell[] {
  const weeks = options.weeks ?? DEFAULTS.weeks;
  const thresholds = options.thresholds ?? DEFAULTS.thresholds;
  const today = startOfDay(options.endDate ?? new Date());

  // Accumulated by date: there can be more than one session on the same day.
  const volumeByDate = new Map<string, number>();
  for (const session of sessions) {
    const previous = volumeByDate.get(session.performed_on) ?? 0;
    volumeByDate.set(session.performed_on, previous + (session.set_count ?? 1));
  }

  const first = fromDateKey(heatmapStart({ ...options, endDate: today }));

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
 * The shape the widget consumes: levels only, no dates.
 * Length guaranteed to be weeks * 7.
 */
export function buildLevels(
  sessions: readonly HeatmapSession[],
  options: HeatmapOptions = {},
): number[] {
  return buildHeatmap(sessions, options).map((cell) => cell.level);
}

/**
 * Current streak of days trained, counting back from today.
 * Today without a workout doesn't break the streak — the day isn't over —
 * but it doesn't add to it either.
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

/** Days trained within the range `buildHeatmap` returns. */
export function trainedDays(cells: readonly HeatmapCell[]): number {
  return cells.reduce((total, cell) => total + (cell.trained ? 1 : 0), 0);
}

export const __internals = { levelFor, endOfWeek, addDays, DAY_MS };
