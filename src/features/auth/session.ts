// Kept apart from the provider to satisfy react/only-export-components.

import type { Session } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

export type SessionState = {
  session: Session | null;
  isLoading: boolean;
  error: Error | null;
  retrySession?: () => void;
};

export const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) {
    throw new Error("useSession() necesita estar dentro de <SessionProvider>.");
  }
  return state;
}

export function useUser() {
  return useSession().session?.user ?? null;
}
