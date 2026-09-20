/**
 * The session context, kept apart from the provider so this file doesn't
 * export components and hooks at once (see react/only-export-components).
 */

import type { Session } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

export type SessionState = {
  session: Session | null;
  /** true until it is settled whether there is a stored session or not. */
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

/** The authenticated user, or null. A shortcut for the common case. */
export function useUser() {
  return useSession().session?.user ?? null;
}
