import { Outlet } from "react-router";
import { useSession } from "./session";
import { SignInScreen } from "./sign-in-screen";

/**
 * The route guard. It wraps everything that needs a `user_id`.
 *
 * It does not redirect to /login: the app is single-user and nothing is
 * public, so the sign-in screen takes the content's place. That also avoids
 * the flicker of a navigation at startup.
 */
export function RequireAuth() {
  const { session, isLoading } = useSession();

  // Without this the sign-in screen would flash every time you reload with a
  // valid session, because reading storage isn't synchronous.
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ground">
        <p className="text-sm text-muted" role="status">
          Cargando…
        </p>
      </div>
    );
  }

  if (!session) return <SignInScreen />;

  return <Outlet />;
}
