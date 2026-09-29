export type SetValues = { reps: number | null; weightKg: number | null };
export type SavedSet = { id: string; values: SetValues };

const MAX_WEIGHT = 9999.99;
const MAX_REPS = 999;

function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function parseReps(raw: string): number | null {
  const value = parseNumber(raw);
  return value === null ? null : Math.min(MAX_REPS, Math.max(0, Math.round(value)));
}

export function parseWeight(raw: string): number | null {
  const value = parseNumber(raw);
  return value === null
    ? null
    : Math.min(MAX_WEIGHT, Math.max(0, Math.round(value * 100) / 100));
}

function sameValues(a: SetValues, b: SetValues): boolean {
  return a.reps === b.reps && a.weightKg === b.weightKg;
}

/** Serializes writes for one set, including a log followed by an unlog. */
export function createSetEditor(
  initial: SavedSet | null,
  initialActions: {
    log: (values: SetValues) => Promise<SavedSet>;
    unlog: (id: string) => Promise<void>;
  },
) {
  let actions = initialActions;
  let saved = initial;
  let pending = 0;
  let pendingLogs = 0;
  let pendingUnlogs = 0;
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(kind: "log" | "unlog", task: () => Promise<T>): Promise<T> {
    pending++;
    if (kind === "log") pendingLogs++;
    else pendingUnlogs++;
    async function execute() {
      try {
        return await task();
      } finally {
        pending--;
        if (kind === "log") pendingLogs--;
        else pendingUnlogs--;
      }
    }
    const result = tail.then(execute, execute);
    tail = result.catch(() => undefined);
    return result;
  }

  return {
    setActions(next: typeof initialActions) {
      actions = next;
    },
    get saved() {
      return saved;
    },
    get isPending() {
      return pending > 0;
    },
    get hasPendingLog() {
      return pendingLogs > 0;
    },
    get hasPendingUnlog() {
      return pendingUnlogs > 0;
    },
    needsLog(values: SetValues) {
      return !saved || !sameValues(saved.values, values);
    },
    reconcile(next: SavedSet | null) {
      if (!pending) saved = next;
    },
    log(values: SetValues) {
      return enqueue("log", async () => {
        if (saved && sameValues(saved.values, values)) return saved;
        saved = await actions.log(values);
        return saved;
      });
    },
    unlog() {
      return enqueue("unlog", async () => {
        if (!saved) return;
        await actions.unlog(saved.id);
        saved = null;
      });
    },
  };
}

/** A first log in flight counts as a saved set for subsequent blur edits. */
export function shouldQueueBlurSave(
  editor: Pick<
    ReturnType<typeof createSetEditor>,
    "saved" | "hasPendingLog" | "hasPendingUnlog" | "needsLog"
  >,
  values: SetValues,
): boolean {
  if (editor.hasPendingUnlog) return false;
  if (editor.hasPendingLog) return true;
  return editor.saved !== null && editor.needsLog(values);
}
