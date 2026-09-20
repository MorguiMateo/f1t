import type { Session } from "@supabase/supabase-js";
import { type ReactNode, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { SessionContext } from "./session";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // The session stored in localStorage. Resolves before any network call.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setIsLoading(false);
    });

    // Covers login, logout and token refresh. It is also what catches the
    // return from Google, because detectSessionInUrl emits here.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setIsLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <SessionContext.Provider value={{ session, isLoading }}>
      {children}
    </SessionContext.Provider>
  );
}
