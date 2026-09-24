import { Outlet } from "react-router";
import { PageSkeleton } from "../../components/skeleton";
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
  // valid session, because reading storage isn't synchronous. The frame is
  // `AppLayout`'s `<main>`, so the skeleton sits where the first tab will.
  if (isLoading) {
    return (
      <div className="min-h-dvh bg-ground">
        <div className="mx-auto w-full max-w-lg px-4">
          <PageSkeleton />
        </div>
      </div>
    );
  }

  if (!session) return <SignInScreen />;

  return <Outlet />;
}
