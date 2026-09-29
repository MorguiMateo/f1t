import { Outlet } from "react-router";
import { PageSkeleton } from "../../components/skeleton";
import { ErrorNote } from "../../components/status";
import { useSession } from "./session";
import { SignInScreen } from "./sign-in-screen";

// No redirect to /login: nothing is public, so the sign-in screen replaces
// the content, avoiding a navigation flicker at startup.
export function RequireAuth() {
  const { session, isLoading, error } = useSession();

  // Reading storage is async; without this the sign-in screen flashes on
  // every reload. The wrapper mirrors `AppLayout`'s `<main>`.
  if (isLoading) {
    return (
      <div className="min-h-dvh bg-ground">
        <div className="mx-auto w-full max-w-lg px-4">
          <PageSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-ground px-4 pt-8">
        <div className="mx-auto w-full max-w-lg">
          <ErrorNote error={error} title="No se pudo verificar la sesión" />
        </div>
      </div>
    );
  }

  if (!session) return <SignInScreen />;

  return <Outlet />;
}
