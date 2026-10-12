import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { Capacitor } from "@capacitor/core";
import { PageSkeleton } from "../../components/skeleton";
import { useSession } from "./session";
import { SignInScreen } from "./sign-in-screen";
import { pendingOAuthDestination, takeOAuthDestination } from "./oauth-destination";

// No redirect to /login: nothing is public, so the sign-in screen replaces
// the content, avoiding a navigation flicker at startup.
export function RequireAuth() {
  const { session, isLoading, error, retrySession } = useSession();
  const navigate = useNavigate();
  const [pending, setPending] = useState(() => Capacitor.isNativePlatform() ? null : pendingOAuthDestination());

  useEffect(() => {
    if (!session || !pending || isLoading || error) return;
    let destination: string | null = null;
    try { destination = takeOAuthDestination(window.sessionStorage); } catch { /* Unavailable storage must not block access. */ }
    // Consuming browser storage must also release the temporary restoration screen.
    // eslint-disable-next-line react/set-state-in-effect
    setPending(null);
    if (destination) navigate(destination, { replace: true });
  }, [session, pending, isLoading, error, navigate]);

  // Reading storage is async; without this the sign-in screen flashes on
  // every reload. The wrapper mirrors `AppLayout`'s `<main>`.
  if (isLoading || (session && pending && !error)) {
    return (
      <div className="min-h-dvh bg-ground">
        <main className="mx-auto w-full max-w-lg px-4" aria-label="Cargando aplicación" aria-busy="true">
          <PageSkeleton />
        </main>
      </div>
    );
  }

  if (error) {
    return <SignInScreen sessionError={error} retrySession={retrySession} />;
  }

  if (!session) return <SignInScreen />;

  return <Outlet />;
}
