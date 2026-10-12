/** Device-local input only. A draft is never a registered set or a write queue. */
export type WorkoutDraft = {
  scope: string;
  index: number;
  repsText: string;
  weightText: string;
  operation: "log" | "unlog";
  failed: boolean;
  advance: boolean;
};

type DraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
const PREFIX = "f1t:workout-draft:v1:";
export const draftKey = (scope: string, index: number) => JSON.stringify([scope, index]);

function validDraft(value: unknown): value is WorkoutDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as WorkoutDraft;
  if (typeof d.scope !== "string" || !Number.isInteger(d.index) || d.index < 0 || d.index > 999 ||
      typeof d.repsText !== "string" || typeof d.weightText !== "string" ||
      d.repsText.length > 128 || d.weightText.length > 128 ||
      !["log", "unlog"].includes(d.operation) || typeof d.failed !== "boolean" || typeof d.advance !== "boolean") return false;
  try {
    const parts: unknown = JSON.parse(d.scope);
    return Array.isArray(parts) && parts.length === 3 && typeof parts[0] === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) && (parts[1] === null || typeof parts[1] === "string") &&
      typeof parts[2] === "string" && parts[2].length > 0;
  } catch { return false; }
}

export function createWorkoutDraftStore(accountId: string | null, suppliedStorage?: DraftStorage | null) {
  const drafts = new Map<string, WorkoutDraft>();
  let storage = suppliedStorage;
  let storageError = false;
  const writeErrors = new Set<string>();
  const prefix = accountId ? `${PREFIX}${encodeURIComponent(accountId)}:` : null;
  if (storage === undefined) {
    try { storage = typeof window === "undefined" ? null : window.localStorage; }
    catch { storage = null; storageError = true; }
  }
  if (prefix && storage) {
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(prefix)) continue;
        try {
          const value: unknown = JSON.parse(storage.getItem(key) ?? "null");
          if (validDraft(value) && key === prefix + draftKey(value.scope, value.index)) {
            drafts.set(draftKey(value.scope, value.index), value);
          }
        } catch { /* Ignore malformed local data, never expose another account. */ }
      }
    } catch { storageError = true; }
  }
  return {
    drafts,
    get storageError() { return storageError || writeErrors.size > 0; },
    write(scope: string, index: number, draft: WorkoutDraft | null) {
      const key = draftKey(scope, index);
      const existed = drafts.has(key);
      if (!draft && !existed) return;
      if (draft) drafts.set(key, draft);
      if (!prefix) { if (!draft) drafts.delete(key); return; }
      if (!storage) { writeErrors.add(key); return; }
      try {
        if (draft) storage.setItem(prefix + key, JSON.stringify(draft));
        else { storage.removeItem(prefix + key); drafts.delete(key); }
        writeErrors.delete(key);
      } catch { writeErrors.add(key); }
    },
  };
}
