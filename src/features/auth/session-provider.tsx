import type { Session } from "@supabase/supabase-js";
import { type ReactNode, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { setWidgetDebugIdentity } from "../../lib/device";
import { setAuthQueryIdentity } from "./auth-query-client";
import { AuthQueryScope } from "./auth-query-scope";
import { SessionContext } from "./session";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    let receivedAuthEvent = false;
    // Remove any legacy debug payload before the stored session is resolved.
    setWidgetDebugIdentity(null);

    void supabase.auth.getSession().then(
      ({ data, error: sessionError }) => {
        if (!active || receivedAuthEvent) return;
        setAuthQueryIdentity(data.session?.user.id ?? null);
        setWidgetDebugIdentity(data.session?.user.id ?? null);
        setSession(data.session);
        setError(sessionError);
        setIsLoading(false);
      },
      (reason: unknown) => {
        if (!active || receivedAuthEvent) return;
        setError(reason instanceof Error ? reason : new Error(String(reason)));
        setIsLoading(false);
      },
    );

    // Also catches the return from Google, since detectSessionInUrl emits here.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      receivedAuthEvent = true;
      setAuthQueryIdentity(next?.user.id ?? null);
      setWidgetDebugIdentity(next?.user.id ?? null);
      setSession(next);
      setError(null);
      setIsLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <SessionContext.Provider value={{ session, isLoading, error }}>
      {/* A new identity gets a new cache; old in-flight work only sees its old client. */}
      <AuthQueryScope key={session?.user.id ?? "signed-out"}>
        {children}
      </AuthQueryScope>
    </SessionContext.Provider>
  );
}
