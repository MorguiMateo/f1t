import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../../lib/supabase";
import { rememberOAuthDestination } from "./oauth-destination";

// Must match the URL scheme registered in ios/App/App/Info.plist and Supabase.
export const NATIVE_AUTH_CALLBACK = "f1t://auth/callback";

let lastAuthError: string | null = null;
let nativeLoginPending = false;
let lastHandledAuthUrl: string | null = null;

export function getNativeAuthError() {
  return lastAuthError;
}

function reportAuthError(message: string) {
  lastAuthError = message;
  window.dispatchEvent(new CustomEvent<string>("f1t:auth-error", { detail: message }));
}

async function handleAuthUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }

  // Never consume links for other apps or routes.
  if (`${url.protocol}//${url.host}${url.pathname}` !== NATIVE_AUTH_CALLBACK) return;
  // Cold launches can deliver the same one-use PKCE code twice.
  if (rawUrl === lastHandledAuthUrl) return;
  lastHandledAuthUrl = rawUrl;

  nativeLoginPending = false;
  await Browser.close().catch(() => undefined);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const callbackError = url.searchParams.get("error_description") ??
    fragment.get("error_description") ??
    url.searchParams.get("error") ??
    fragment.get("error");
  if (callbackError) {
    reportAuthError(callbackError);
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    reportAuthError("Google no devolvió un código de acceso. Intentá de nuevo.");
    return;
  }

  // The verifier remains in Supabase's WKWebView localStorage across Safari.
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) reportAuthError(error.message);
  else lastAuthError = null;
}

export async function initializeNativeAuth() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await App.addListener("appUrlOpen", ({ url }) => {
      void handleAuthUrl(url).catch((error: unknown) => {
        reportAuthError(error instanceof Error ? error.message : String(error));
      });
    });
    await Browser.addListener("browserFinished", () => {
      if (nativeLoginPending) {
        nativeLoginPending = false;
        reportAuthError("Inicio de sesión cancelado.");
      }
    });
    const launch = await App.getLaunchUrl();
    if (launch?.url) await handleAuthUrl(launch.url);
  } catch (error) {
    reportAuthError(error instanceof Error ? error.message : String(error));
  }
}

export async function startGoogleSignIn(destination?: string) {
  lastAuthError = null;
  const native = Capacitor.isNativePlatform();
  if (!native) {
    const current = destination ?? `${window.location.pathname ?? "/"}${window.location.search ?? ""}${window.location.hash ?? ""}`;
    try {
      rememberOAuthDestination(current, window.sessionStorage);
    } catch {
      // Root entry needs no restoration. Do not silently lose a requested deep link.
      if (current !== "/") throw new Error("No pudimos conservar la pantalla de destino. Permití el almacenamiento del navegador y volvé a intentar.");
    }
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: native ? NATIVE_AUTH_CALLBACK : window.location.origin,
      skipBrowserRedirect: native,
    },
  });
  if (error) throw error;
  if (native) {
    if (!data.url) throw new Error("Google no devolvió una URL de acceso.");
    nativeLoginPending = true;
    try {
      await Browser.open({ url: data.url });
    } catch (reason) {
      nativeLoginPending = false;
      throw reason;
    }
  }
}
