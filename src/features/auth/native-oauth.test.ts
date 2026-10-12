import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: true,
  appUrlOpen: undefined as ((event: { url: string }) => void) | undefined,
  browserFinished: undefined as (() => void) | undefined,
  getLaunchUrl: vi.fn(async () => undefined as { url: string } | undefined),
  open: vi.fn(async (_options: { url: string }) => undefined),
  close: vi.fn(async () => undefined),
  signInWithOAuth: vi.fn(async (_options: unknown) => ({
    data: { url: "https://example.test/oauth" },
    error: null,
  })),
  exchangeCodeForSession: vi.fn(async (_code: string) => ({ error: null })),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
}));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (_name: string, listener: typeof mocks.appUrlOpen) => {
      mocks.appUrlOpen = listener;
      return { remove: vi.fn() };
    }),
    getLaunchUrl: mocks.getLaunchUrl,
  },
}));
vi.mock("@capacitor/browser", () => ({
  Browser: {
    addListener: vi.fn(async (_name: string, listener: typeof mocks.browserFinished) => {
      mocks.browserFinished = listener;
      return { remove: vi.fn() };
    }),
    open: mocks.open,
    close: mocks.close,
  },
}));
vi.mock("../../lib/supabase", () => ({
  supabase: { auth: {
    signInWithOAuth: mocks.signInWithOAuth,
    exchangeCodeForSession: mocks.exchangeCodeForSession,
  } },
}));

import { initializeNativeAuth, startGoogleSignIn } from "./native-oauth";
import { takeOAuthDestination } from "./oauth-destination";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native = true;
  mocks.getLaunchUrl.mockResolvedValue(undefined);
});

describe("native Google OAuth", () => {
  it("opens the system browser with the app callback and exchanges a matching code", async () => {
    await initializeNativeAuth();
    await startGoogleSignIn();
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "f1t://auth/callback", skipBrowserRedirect: true },
    });
    expect(mocks.open).toHaveBeenCalledWith({ url: "https://example.test/oauth" });

    mocks.appUrlOpen?.({ url: "https://example.test/?code=wrong" });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    mocks.appUrlOpen?.({ url: "f1t://auth/callback?code=right" });
    await vi.waitFor(() => {
      expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("right");
    });
  });

  it("keeps web OAuth as a normal browser redirect", async () => {
    mocks.native = false;
    vi.stubGlobal("window", { location: { origin: "https://example.test" } });
    await startGoogleSignIn();
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://example.test", skipBrowserRedirect: false },
    });
    expect(mocks.open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("stores a validated full web destination while keeping the allowlisted root callback", async () => {
    mocks.native = false;
    const values = new Map<string, string>();
    const sessionStorage = {
      setItem: (key: string, value: string) => { values.set(key, value); },
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key); },
    };
    vi.stubGlobal("window", { location: { origin: "https://example.test" }, sessionStorage });
    try {
      await startGoogleSignIn("/ejercicios?rutina=r&dia=d");
      expect(mocks.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "https://example.test", skipBrowserRedirect: false } });
      expect(takeOAuthDestination(sessionStorage)).toBe("/ejercicios?rutina=r&dia=d");
      await startGoogleSignIn("//evil.test");
      expect(takeOAuthDestination(sessionStorage)).toBe("/");
      expect(mocks.open).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not touch web destination storage in native OAuth", async () => {
    vi.stubGlobal("window", { get sessionStorage() { throw new Error("must not read native storage"); } });
    try {
      await startGoogleSignIn("/comidas?fecha=2026-10-01");
      expect(mocks.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "f1t://auth/callback", skipBrowserRedirect: true } });
      expect(mocks.open).toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("handles a cold-start callback only once", async () => {
    mocks.getLaunchUrl.mockResolvedValue({ url: "f1t://auth/callback?code=cold" });
    await initializeNativeAuth();
    mocks.appUrlOpen?.({ url: "f1t://auth/callback?code=cold" });
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });
});
