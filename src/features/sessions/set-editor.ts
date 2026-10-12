import { suggestFor, type ExercisePlan, type PlannedSet } from "./plan";
import { createWorkoutDraftStore, draftKey, type WorkoutDraft } from "./workout-drafts";

export type SetValues = { reps: number | null; weightKg: number | null };
export type SavedSet = { id: string; values: SetValues };
export type ExerciseLogWriteState = { pending: boolean; failed: boolean; dirty?: boolean };

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

/** The preceding performed set is a prefill, never a performed set itself. */
export function suggestSetValues(set: PlannedSet, plan: ExercisePlan): SetValues {
  const suggested = suggestFor(set, plan.targetReps, plan.targetWeightKg);
  if (set.done) return suggested;
  const earlier = plan.sets
    .filter((row) => row.setIndex < set.setIndex && row.done)
    .sort((a, b) => b.setIndex - a.setIndex)[0]?.done;
  return {
    reps: earlier?.reps ?? suggested.reps,
    weightKg: earlier?.weight_kg ?? suggested.weightKg,
  };
}

/** Reject invalid text instead of silently marking an incomplete draft as done. */
export function setInputError(reps: string, weight: string, isNew: boolean): string | null {
  const r = reps.trim();
  const w = weight.trim();
  if (isNew && !r) return "Ingresá las repeticiones antes de registrar la serie.";
  if (r && (!/^\d+$/.test(r) || Number(r) > MAX_REPS)) {
    return "Repeticiones: ingresá un entero entre 0 y 999.";
  }
  if (w && (!/^\d+([.,]\d{0,2})?$/.test(w) || Number(w.replace(",", ".")) > MAX_WEIGHT)) {
    return "Carga: ingresá entre 0 y 9999,99 kg, con hasta dos decimales.";
  }
  return null;
}

export function exerciseWriteState(states: Iterable<ExerciseLogWriteState>): ExerciseLogWriteState {
  let pending = false;
  let failed = false;
  let dirty = false;
  for (const state of states) {
    pending ||= state.pending;
    failed ||= state.failed;
    dirty ||= state.dirty ?? false;
  }
  return { pending, failed, ...(dirty ? { dirty: true } : {}) };
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

export type SetWriteFailure = { operation: "log" | "unlog"; error: unknown; advance: boolean };
type SetActions = Parameters<typeof createSetEditor>[1];
export type SetRowSnapshot = {
  pending: number;
  saved: SavedSet | null;
  failure: SetWriteFailure | null;
  warning: string | null;
  repsText: string;
  weightText: string;
  dirty: { reps: boolean; weight: boolean };
  requiresConfirmation: boolean;
};

/** Operation ownership and drafts live with the queue, not with a mounted row. */
export function createSetRowLifecycle(initial: SavedSet | null, suggested: SetValues, actions: SetActions, recovered?: WorkoutDraft) {
  const editor = createSetEditor(initial, actions);
  let external = initial;
  let revision = 0;
  let draftRevision = 0;
  let defaults = suggested;
  let intent: "log" | "unlog" = recovered?.operation ?? "log";
  // A response can be lost after the server accepted a write. Only current
  // server values may establish that a recovered input was already registered.
  if (recovered?.operation === "log" && initial && !setInputError(recovered.repsText, recovered.weightText, false) &&
      sameValues(initial.values, { reps: parseReps(recovered.repsText), weightKg: parseWeight(recovered.weightText) })) recovered = undefined;
  let state: SetRowSnapshot = {
    pending: 0, saved: initial, failure: null, warning: null,
    repsText: (initial?.values ?? suggested).reps?.toString() ?? "", weightText: (initial?.values ?? suggested).weightKg?.toString() ?? "",
    dirty: { reps: false, weight: false },
    requiresConfirmation: false,
  };
  if (recovered) state = {
    ...state, repsText: recovered.repsText, weightText: recovered.weightText,
    dirty: { reps: recovered.operation === "log", weight: recovered.operation === "log" },
    requiresConfirmation: true,
    failure: recovered.failed || recovered.operation === "unlog" ? {
      operation: recovered.operation, advance: recovered.advance,
      error: new Error(recovered.operation === "unlog" ? "La solicitud de desmarcar quedó pendiente. Reintentá o descartá esa solicitud." : "Borrador recuperado. Reintentá para registrar esta serie."),
    } : null,
  };
  const listeners = new Set<() => void>();
  function publish(next: Partial<SetRowSnapshot>) {
    state = { ...state, ...next, saved: editor.saved };
    for (const listener of listeners) listener();
  }
  function sameSaved(a: SavedSet | null, b: SavedSet | null) {
    return a === b || (a !== null && b !== null && a.id === b.id && sameValues(a.values, b.values));
  }
  return {
    editor,
    getSnapshot: () => state,
    getDraft(scope: string, index: number): WorkoutDraft | null {
      if (!state.pending && !state.failure && !state.dirty.reps && !state.dirty.weight) return null;
      return { scope, index, repsText: state.repsText, weightText: state.weightText, operation: state.failure?.operation ?? intent, failed: state.failure !== null, advance: state.failure?.advance ?? false };
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setWarning(warning: string | null) { if (warning !== state.warning) publish({ warning }); },
    edit(field: "reps" | "weight", text: string) {
      intent = "log";
      draftRevision++;
      publish({ [field === "reps" ? "repsText" : "weightText"]: text, dirty: { ...state.dirty, [field]: true } });
    },
    adoptSuggestions(values: SetValues, focused: "reps" | "weight" | null) {
      defaults = values;
      if (state.pending) return;
      const currentDefaults = editor.saved?.values ?? values;
      const repsText = !state.dirty.reps && focused !== "reps" ? currentDefaults.reps?.toString() ?? "" : state.repsText;
      const weightText = !state.dirty.weight && focused !== "weight" ? currentDefaults.weightKg?.toString() ?? "" : state.weightText;
      if (repsText !== state.repsText || weightText !== state.weightText) publish({ repsText, weightText });
    },
    reconcile(next: SavedSet | null) {
      // A remount with unchanged/stale query data must not discard a local acknowledgement.
      if (state.pending || sameSaved(next, external)) return;
      external = next;
      editor.reconcile(next);
      publish({});
    },
    discard() {
      if (state.pending) return false;
      revision++; draftRevision++;
      const values = editor.saved?.values ?? defaults;
      intent = "log";
      publish({ repsText: values.reps?.toString() ?? "", weightText: values.weightKg?.toString() ?? "", dirty: { reps: false, weight: false }, failure: null, requiresConfirmation: false });
      return true;
    },
    validate(advance = false): SetValues | null {
      const error = setInputError(state.repsText, state.weightText, !editor.saved && !editor.hasPendingLog);
      if (error) {
        revision++;
        publish({ failure: { operation: "log", error: new Error(error), advance }, requiresConfirmation: true });
        return null;
      }
      return { reps: parseReps(state.repsText), weightKg: parseWeight(state.weightText) };
    },
    async run(operation: "log" | "unlog", values?: SetValues, advance = false) {
      intent = operation;
      const ownedRevision = ++revision;
      const ownedDraft = draftRevision;
      const isNew = operation === "log" && !editor.saved && !editor.hasPendingLog;
      publish({ pending: state.pending + 1, failure: null });
      try {
        if (operation === "log") {
          const saved = await editor.log(values!);
          if (draftRevision === ownedDraft) {
            publish({ repsText: saved.values.reps?.toString() ?? "", weightText: saved.values.weightKg?.toString() ?? "", dirty: { reps: false, weight: false }, requiresConfirmation: false });
          }
        } else {
          await editor.unlog();
          if (draftRevision === ownedDraft) publish({ dirty: { reps: false, weight: false }, requiresConfirmation: false });
        }
        if (revision === ownedRevision) publish({ failure: null });
        return { isNew, advance, ownsFeedback: revision === ownedRevision, ownsDraft: draftRevision === ownedDraft };
      } catch (error) {
        if (revision === ownedRevision) publish({ failure: { operation, error, advance }, requiresConfirmation: true });
        throw error;
      } finally { publish({ pending: state.pending - 1 }); }
    },
  };
}

export type SetRowLifecycle = ReturnType<typeof createSetRowLifecycle>;

/** Host one instance in the authenticated workout page; keys include date/day/exercise. */
export function createWorkoutSetRegistry(accountId: string | null = null, storage?: Parameters<typeof createWorkoutDraftStore>[1]) {
  const store = createWorkoutDraftStore(accountId, storage);
  const scopes = new Map<string, {
    rows: Map<number, SetRowLifecycle>;
    report?: (state: ExerciseLogWriteState) => void;
  }>();
  const listeners = new Set<() => void>();
  let snapshot = { revision: 0, storageError: store.storageError };
  function publish() {
    snapshot = { revision: snapshot.revision + 1, storageError: store.storageError };
    for (const listener of listeners) listener();
  }
  function scopeFor(key: string) {
    let scope = scopes.get(key);
    if (!scope) { scope = { rows: new Map() }; scopes.set(key, scope); }
    return scope;
  }
  function stateFor(key: string): ExerciseLogWriteState {
    const rows = scopeFor(key).rows;
    const states: ExerciseLogWriteState[] = [...rows.values()].map((row) => {
      const state = row.getSnapshot();
      return { pending: state.pending > 0, failed: state.failure !== null,
        dirty: state.dirty.reps || state.dirty.weight };
    });
    for (const draft of store.drafts.values()) {
      if (draft.scope === key && !rows.has(draft.index)) states.push({ pending: false, failed: draft.failed, dirty: true });
    }
    return exerciseWriteState(states);
  }
  function workoutStatus(date: string, day: string | null | undefined) {
    const keys = new Set([...scopes.keys(), ...[...store.drafts.values()].map(d => d.scope)]);
    return exerciseWriteState([...keys].filter(key => {
      const parts = JSON.parse(key) as [string, string | null, string];
      return parts[0] === date && (day === undefined || parts[1] === day);
    }).map(stateFor));
  }
  return {
    // Keep the original write-only status API compatible with existing callers.
    status(key: string) { const { pending, failed } = stateFor(key); return { pending, failed }; },
    workoutStatus,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    discardWorkout(date: string, day: string | null | undefined) {
      if (workoutStatus(date, day).pending) return false;
      for (const [key, scope] of scopes) {
        const parts = JSON.parse(key) as [string, string | null, string];
        if (parts[0] === date && (day === undefined || parts[1] === day)) for (const row of scope.rows.values()) row.discard();
      }
      for (const draft of [...store.drafts.values()]) {
        const parts = JSON.parse(draft.scope) as [string, string | null, string];
        if (parts[0] === date && (day === undefined || parts[1] === day)) store.write(draft.scope, draft.index, null);
      }
      publish();
      return !store.storageError;
    },
    row(key: string, index: number, initial: SavedSet | null, suggested: SetValues, actions: SetActions) {
      const scope = scopeFor(key);
      let row = scope.rows.get(index);
      if (!row) {
        row = createSetRowLifecycle(initial, suggested, actions, store.drafts.get(draftKey(key, index)));
        scope.rows.set(index, row);
        const ownRow = row;
        const report = () => {
          store.write(key, index, ownRow.getDraft(key, index));
          scope.report?.(stateFor(key));
          publish();
        };
        // Acknowledged server values retire a recovered duplicate draft.
        if (store.drafts.has(draftKey(key, index)) && !row.getDraft(key, index)) store.write(key, index, null);
        row.subscribe(report);
      }
      return row;
    },
    observe(key: string, report: (state: ExerciseLogWriteState) => void) {
      // Detached operations keep the owning page informed after card unmount.
      scopeFor(key).report = report;
      report(stateFor(key));
    },
  };
}
export type WorkoutSetRegistry = ReturnType<typeof createWorkoutSetRegistry>;
