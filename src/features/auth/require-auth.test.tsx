import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  state: { session: null, isLoading: false, error: new Error("Failed to fetch"), retrySession: vi.fn() },
  retry: undefined as (() => void) | undefined,
}));
vi.mock("./session", () => ({ useSession: () => mock.state }));
vi.mock("./native-oauth", () => ({ getNativeAuthError: () => null, startGoogleSignIn: vi.fn() }));
vi.mock("./oauth-destination", () => ({ pendingOAuthDestination: () => null, takeOAuthDestination: () => null, webOAuthError: () => null }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("../../components/button", async (original) => {
  const { Button } = await original<typeof import("../../components/button")>();
  return { Button: (props: Parameters<typeof Button>[0]) => {
    if (props.children === "Reintentar sesión") mock.retry = props.onClick as (() => void) | undefined;
    return <Button {...props} />;
  } };
});
import { RequireAuth } from "./require-auth";

beforeEach(() => {
  mock.state.isLoading = false;
  mock.state.error = new Error("Failed to fetch");
  mock.state.retrySession.mockClear(); mock.retry = undefined;
});
function render() { return renderToStaticMarkup(<MemoryRouter><RequireAuth /></MemoryRouter>); }

describe("auth recovery screen", () => {
  it("exposes real session retry and Google recovery, instead of a dead-end alert", () => {
    const html = render();
    expect(html).toContain("No se pudo verificar la sesión");
    expect(html).toContain("Revisá tu conexión");
    expect(html).toContain("Reintentar sesión");
    expect(html).toContain("Continuar con Google");
    mock.retry?.();
    expect(mock.state.retrySession).toHaveBeenCalledTimes(1);
    expect(html).toContain("<main");
    expect(html).toContain("tu progreso");
    expect(html).toContain("F1t no guarda tu contraseña");
  });
  it("announces session restoration as busy within a main landmark", () => {
    mock.state.isLoading = true;
    const html = render();
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("<main");
    expect(html).not.toContain("Continuar con Google");
  });
});
