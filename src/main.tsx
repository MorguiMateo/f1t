import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Capacitor } from "@capacitor/core";
import { appRoutes } from "./app";
import { SessionProvider } from "./features/auth/session-provider";
import { initializeNativeAuth } from "./features/auth/native-oauth";
import "./index.css";

async function bootstrap() {
  if (Capacitor.isNativePlatform()) {
    await initializeNativeAuth();
  }

  // Create once outside React/StrictMode. BrowserRouter cannot support useBlocker.
  const router = createBrowserRouter(appRoutes);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </StrictMode>,
  );

  if (!Capacitor.isNativePlatform()) {
    // Keep the PWA on the web, but never register its SW in Capacitor.
    void import("virtual:pwa-register").then(({ registerSW }) => {
      registerSW({ immediate: true });
    });
  }
}

void bootstrap();
