export type AppSection = "/" | "/rutinas" | "/progreso" | "/perfil";

const APP_PATH = /^(?:\/|\/entrenar|\/progreso|\/perfil|\/rutinas(?:\/[A-Za-z0-9_-]+(?:\/dias\/[A-Za-z0-9_-]+)?)?|\/ejercicios(?:\/[A-Za-z0-9_-]+)?)\/?$/;
const AUTH_KEYS = /^(?:code|error(?:_description|_code)?|access_token|refresh_token|id_token|token_type|expires_in|expires_at)$/i;

/** Only destinations implemented by this app; never an external redirect or auth callback. */
export function validateInternalDestination(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || [...value].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return null;
  try {
    const url = new URL(value, "https://f1t.invalid");
    if (url.origin !== "https://f1t.invalid" || !APP_PATH.test(url.pathname)) return null;
    if ([...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()].some((key) => AUTH_KEYS.test(key))) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}

export function sectionForDestination(pathname: string, state?: unknown): AppSection {
  const path = pathname.replace(/\/$/, "") || "/";
  if (path === "/ejercicios" || path.startsWith("/ejercicios/") || path === "/rutinas" || path.startsWith("/rutinas/")) return "/rutinas";
  if (path === "/entrenar") {
    const section = state && typeof state === "object" && "section" in state ? state.section : null;
    return section === "/progreso" || section === "/rutinas" ? section : "/";
  }
  if (path === "/progreso" || path === "/perfil") return path;
  return "/";
}

/** Hierarchical fallback for direct entry, not a replacement for in-app browser history. */
export function backFallback(destination: string): string | null {
  const validated = validateInternalDestination(destination);
  if (!validated) return "/";
  const url = new URL(validated, "https://f1t.invalid");
  const path = url.pathname.replace(/\/$/, "") || "/";
  const day = path.match(/^(\/rutinas\/[^/]+)\/dias\/[^/]+$/);
  if (day) return day[1];
  if (path.startsWith("/rutinas/")) return "/rutinas";
  if (path.startsWith("/ejercicios/")) return "/ejercicios";
  if (path === "/ejercicios") {
    const routine = url.searchParams.get("rutina");
    const dayID = url.searchParams.get("dia");
    const validID = (id: string | null): id is string => id !== null && /^[A-Za-z0-9_-]+$/.test(id);
    const parent = validID(routine) && validID(dayID) ? validateInternalDestination(`/rutinas/${routine}/dias/${dayID}`) : null;
    return parent ?? "/rutinas";
  }
  if (path === "/entrenar") return "/";
  return null;
}

export function backAction(historyIndex: unknown, fallback: string): { delta: -1 } | { to: string; replace: true } {
  return typeof historyIndex === "number" && Number.isInteger(historyIndex) && historyIndex > 0
    ? { delta: -1 as const }
    : { to: validateInternalDestination(fallback) ?? "/", replace: true as const };
}
