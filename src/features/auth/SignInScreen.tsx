import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { GoogleMark } from "./GoogleMark";

export function SignInScreen() {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setIsRedirecting(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Vuelve a la raíz de donde salió: sirve igual en localhost, en Vercel
      // y más adelante bajo el esquema de Capacitor. Tiene que estar en el
      // allowlist de Authentication → URL Configuration.
      options: { redirectTo: window.location.origin },
    });

    // Si salió bien el navegador ya se está yendo a Google y esto no corre.
    if (error) {
      setError(error.message);
      setIsRedirecting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col justify-between bg-ground px-6">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <h1 className="text-5xl font-bold tracking-tight">F1t</h1>
        <p className="mt-3 max-w-[28ch] text-pretty text-muted">
          Tus rutinas, tu calendario de actividad y tu progreso, en un solo
          lugar.
        </p>

        <button
          type="button"
          onClick={signIn}
          disabled={isRedirecting}
          className="mt-10 flex w-full max-w-xs items-center justify-center gap-3 rounded-xl border border-line-strong bg-surface px-5 py-3.5 font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          <GoogleMark className="size-5 shrink-0" />
          {isRedirecting ? "Abriendo Google…" : "Continuar con Google"}
        </button>

        {error ? (
          <p
            role="alert"
            className="mt-4 max-w-[32ch] text-sm text-[var(--accent)]"
          >
            No se pudo iniciar sesión: {error}
          </p>
        ) : null}
      </div>

      <p
        className="pb-8 text-center text-xs text-muted"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}
      >
        Una cuenta, un solo usuario. Tus datos son solo tuyos.
      </p>
    </div>
  );
}
