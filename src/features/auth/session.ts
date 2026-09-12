/**
 * El contexto de sesión, separado del provider para que este archivo no
 * exporte componentes y hooks a la vez (ver react/only-export-components).
 */

import type { Session } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

export type SessionState = {
  session: Session | null;
  /** true hasta que se resolvió si hay sesión guardada o no. */
  isLoading: boolean;
};

export const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) {
    throw new Error("useSession() necesita estar dentro de <SessionProvider>.");
  }
  return state;
}

/** El usuario autenticado, o null. Atajo para el caso más común. */
export function useUser() {
  return useSession().session?.user ?? null;
}
