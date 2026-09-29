/**
 * Intended contract for the future iOS widget: `buildLevels` outputs levels
 * 0–4, oldest to newest, with length `weeks * 7`. Keep this calculation
 * dependency-free and tested so SwiftUI can consume the same shape later.
 */

export const HEATMAP_MAX_LEVEL = 4;

export type HeatmapSession = {
  performed_on: string;
  /** If absent, the session counts as level 1. */
  set_count?: number;
};

export type HeatmapCell = {
  date: string;
  level: number;
  sets: number;
  trained: boolean;
  /** Cells after today (week not complete). */
  isFuture: boolean;
};

export type HeatmapOptions = {
  /** Column count: 26 ≈ half a year, planned for the medium widget. */
  weeks?: number;
  /** Final day of the range; defaults to today. */
  endDate?: Date;
  /** 0 = Sunday, 1 = Monday; defaults to Monday. */
  weekStartsOn?: 0 | 1;
  /** Set thresholds for levels 2, 3, 4. */
  thresholds?: [number, number, number];
};

const DEFAULTS = {
  weeks: 26,
  weekStartsOn: 1 as const,
  thresholds: [12, 20, 28] as [number, number, number],
};

const DAY_MS = 86_400_000;

/** Local time; toISOString would shift the date by UTC. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local midnight; `new Date(str)` would parse it as UTC. */
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
 * Lets the query fetch exactly the drawn range without duplicating the week
 * alignment, which lives only in this file.
 */
export function heatmapStart(options: HeatmapOptions = {}): string {
  const weeks = options.weeks ?? DEFAULTS.weeks;
  const weekStartsOn = options.weekStartsOn ?? DEFAULTS.weekStartsOn;
  const today = startOfDay(options.endDate ?? new Date());
  // Ends at the close of the current week so the last column is complete,
  // like GitHub's.
  const last = endOfWeek(today, weekStartsOn);
  return toDateKey(addDays(last, -(weeks * 7 - 1)));
}

export function buildHeatmap(
  sessions: readonly HeatmapSession[],
  options: HeatmapOptions = {},
): HeatmapCell[] {
  const weeks = options.weeks ?? DEFAULTS.weeks;
  const thresholds = options.thresholds ?? DEFAULTS.thresholds;
  const today = startOfDay(options.endDate ?? new Date());

  // Sum duplicate date keys defensively; stored sessions are unique per day.
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

export function buildLevels(
  sessions: readonly HeatmapSession[],
  options: HeatmapOptions = {},
): number[] {
  return buildHeatmap(sessions, options).map((cell) => cell.level);
}

/**
 * Today without a workout doesn't break the streak (the day isn't over), but
 * doesn't add to it either.
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

export function trainedDays(cells: readonly HeatmapCell[]): number {
  return cells.reduce((total, cell) => total + (cell.trained ? 1 : 0), 0);
}

export const __internals = { levelFor, endOfWeek, addDays, DAY_MS };
