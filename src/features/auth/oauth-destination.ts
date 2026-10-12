import { validateInternalDestination } from "../../components/navigation";

const KEY = "f1t:oauth-destination:v1";
const MAX_AGE = 15 * 60_000;

export function rememberOAuthDestination(destination: unknown, storage: Pick<Storage, "setItem">, now = Date.now()) {
  const path = validateInternalDestination(destination) ?? "/";
  storage.setItem(KEY, JSON.stringify({ path, createdAt: now }));
  return path;
}

export function readOAuthDestination(storage: Pick<Storage, "getItem" | "removeItem">, now = Date.now()): string | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const path = validateInternalDestination(saved?.path);
    if (!path || typeof saved?.createdAt !== "number" || saved.createdAt > now || now - saved.createdAt > MAX_AGE) {
      storage.removeItem(KEY);
      return null;
    }
    return path;
  } catch { return null; }
}

export function takeOAuthDestination(storage: Pick<Storage, "getItem" | "removeItem">, now = Date.now()) {
  const path = readOAuthDestination(storage, now);
  try { storage.removeItem(KEY); } catch { /* Storage may be unavailable. */ }
  return path;
}

export function pendingOAuthDestination() {
  try { return readOAuthDestination(window.sessionStorage); } catch { return null; }
}

export function webOAuthError(): string | null {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash?.slice(1));
  return query.get("error_description") ?? fragment.get("error_description") ?? query.get("error") ?? fragment.get("error");
}
