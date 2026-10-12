import type { ExerciseLogWriteState } from "../features/sessions/set-editor";

/** Tracks queued editor writes synchronously, including blur before finish. */
export function createWorkoutWriteGuard() {
  const exercises = new Map<string, { scope: string; state: ExerciseLogWriteState }>();
  const listeners = new Set<() => void>();
  let snapshot: ReadonlyMap<string, { pending: number; failed: number; dirty?: number }> = new Map();
  function status(scope: string) {
    let pending = 0;
    let failed = 0;
    let dirty = 0;
    for (const exercise of exercises.values()) {
      if (exercise.scope !== scope) continue;
      if (exercise.state.pending) pending++;
      if (exercise.state.failed) failed++;
      if (exercise.state.dirty) dirty++;
    }
    return { pending, failed, ...(dirty ? { dirty } : {}) };
  }
  return {
    update(scope: string, exerciseId: string, state: ExerciseLogWriteState) {
      const key = JSON.stringify([scope, exerciseId]);
      if (!state.pending && !state.failed && !state.dirty) exercises.delete(key);
      else exercises.set(key, { scope, state });
      const current = status(scope);
      const previous = snapshot.get(scope);
      if (previous?.pending === current.pending && previous.failed === current.failed && previous.dirty === current.dirty) return;
      snapshot = new Map(snapshot).set(scope, current);
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    status,
    canFinish(scope: string) {
      const current = status(scope);
      return current.pending === 0 && current.failed === 0 && !current.dirty;
    },
  };
}

/** Finishing is stricter than leaving with a retained, explicitly unsent draft. */
export function workoutExitPolicy(state: ExerciseLogWriteState, deleting = false) {
  return {
    needsConfirmation: Boolean(state.pending || state.failed || state.dirty || deleting),
    canLeaveWithDraft: !state.pending && !deleting,
    canDiscard: !state.pending && !deleting,
    canFinish: !state.pending && !state.failed && !state.dirty && !deleting,
  };
}

/** Scoped listener: no router/history monkey-patching, and no leaked listener. */
export function installWorkoutUnloadProtection(target: Pick<Window, "addEventListener" | "removeEventListener">, shouldWarn: () => boolean) {
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!shouldWarn()) return;
    event.preventDefault();
    event.returnValue = "";
  }
  target.addEventListener("beforeunload", beforeUnload);
  return () => target.removeEventListener("beforeunload", beforeUnload);
}
