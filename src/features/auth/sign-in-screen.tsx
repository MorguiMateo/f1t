import { useEffect, useState } from "react";
import { GoogleMark } from "./google-mark";
import { getNativeAuthError, startGoogleSignIn } from "./native-oauth";
import { pendingOAuthDestination, webOAuthError } from "./oauth-destination";
import { ErrorNote } from "../../components/status";
import { Button } from "../../components/button";

export function SignInScreen({ sessionError, retrySession }: { sessionError?: Error; retrySession?: () => void }) {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(() => getNativeAuthError() ?? webOAuthError());

  useEffect(() => {
    const onAuthError = (event: Event) => {
      setError((event as CustomEvent<string>).detail);
      setIsRedirecting(false);
    };
    window.addEventListener("f1t:auth-error", onAuthError);
    return () => window.removeEventListener("f1t:auth-error", onAuthError);
  }, []);

  async function signIn() {
    setIsRedirecting(true);
    setError(null);

    try {
      await startGoogleSignIn(pendingOAuthDestination() ?? undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setIsRedirecting(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col justify-between bg-ground px-6" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <h1 className="text-5xl font-bold tracking-tight">F1t</h1>
        <p className="mt-3 max-w-[28ch] text-pretty text-muted">
          Tus entrenamientos, tus comidas y tu progreso, en un solo lugar.
        </p>

        {sessionError ? <div className="mt-6 w-full max-w-sm text-left">
          <ErrorNote error={sessionError} title="No se pudo verificar la sesión" />
          {retrySession ? <Button onClick={retrySession} className="mt-3 w-full">Reintentar sesión</Button> : null}
        </div> : null}

        <button
          type="button"
          onClick={signIn}
          disabled={isRedirecting}
          className="mt-8 flex min-h-11 w-full max-w-xs items-center justify-center gap-3 rounded-xl border border-control bg-surface px-5 py-3.5 font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          <GoogleMark className="size-5 shrink-0" />
          {isRedirecting ? "Abriendo Google…" : error ? "Reintentar con Google" : "Continuar con Google"}
        </button>

        {error ? (
          <div className="mt-4 w-full max-w-sm text-left"><ErrorNote error={error} title="No se pudo iniciar sesión" /></div>
        ) : null}
      </div>

      <p
        className="pb-8 text-center text-xs text-muted"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}
      >
        Accedés con Google; F1t no guarda tu contraseña. Tus registros se vinculan a tu cuenta y se sincronizan entre la web y la app iOS. No hay perfiles públicos en F1t.
      </p>
    </main>
  );
}
