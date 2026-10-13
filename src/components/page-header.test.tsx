import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ navigate: vi.fn(), back: undefined as (() => void) | undefined }));
vi.mock("react-router", async (original) => ({
  ...await original<typeof import("react-router")>(), useNavigate: () => mock.navigate,
}));
import { PageHeader } from "./page-header";
import { useAppBack } from "./use-app-back";

function Probe({ fallback, onBack, beforeBack }: { fallback?: string; onBack?: () => void; beforeBack?: (proceed: () => void) => void }) {
  // eslint-disable-next-line react/immutability -- Capture the actual hook handler in a test without a DOM runtime.
  mock.back = useAppBack(fallback, onBack, beforeBack);
  return null;
}
function renderProbe(path: string, state?: unknown, fallback?: string, onBack?: () => void, beforeBack?: (proceed: () => void) => void) {
  renderToStaticMarkup(<MemoryRouter initialEntries={[{ pathname: path, state }]}><Probe fallback={fallback} onBack={onBack} beforeBack={beforeBack} /></MemoryRouter>);
}

beforeEach(() => { mock.navigate.mockClear(); mock.back = undefined; });
afterEach(() => vi.unstubAllGlobals());

describe("header and navigation back behavior", () => {
  it("passes the safe direct-entry fallback through an explicit workout guard", () => {
    vi.stubGlobal("window", { history: { state: { idx: 0 } } });
    let approved: (() => void) | undefined;
    const guard = vi.fn((proceed: () => void) => { approved = proceed; });
    renderProbe("/entrenar", undefined, "/", undefined, guard);
    mock.back?.();
    expect(guard).toHaveBeenCalledTimes(1);
    expect(mock.navigate).not.toHaveBeenCalled();
    approved?.();
    expect(mock.navigate).toHaveBeenCalledWith("/", { replace: true });
  });
  it("opens exploratory catalog with an explicit return to its owner, without adding back to root tabs", () => {
    const catalog = renderToStaticMarkup(<MemoryRouter initialEntries={["/ejercicios"]}><PageHeader title="Ejercicios" /></MemoryRouter>);
    expect(catalog).toContain('aria-label="Volver"');
    for (const path of ["/", "/progreso", "/rutinas", "/progreso", "/perfil"]) {
      expect(renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><PageHeader title="Sección" /></MemoryRouter>)).not.toContain('aria-label="Volver"');
    }
  });
  it("uses the routine hierarchy for direct entry even when the browser has external history", () => {
    vi.stubGlobal("window", { history: { length: 40, state: { idx: 0 } } });
    const legacyBack = vi.fn();
    renderProbe("/rutinas/r/dias/d", undefined, undefined, legacyBack);
    mock.back?.();
    expect(mock.navigate).toHaveBeenCalledWith("/rutinas/r", { replace: true });
    expect(legacyBack).not.toHaveBeenCalled();
  });
  it("preserves caller back behavior when an app-owned previous entry exists", () => {
    vi.stubGlobal("window", { history: { state: { idx: 2 } } });
    const legacyBack = vi.fn();
    renderProbe("/rutinas/r/dias/d", undefined, undefined, legacyBack);
    mock.back?.();
    expect(legacyBack).toHaveBeenCalledTimes(1);
    expect(mock.navigate).not.toHaveBeenCalled();
    renderProbe("/rutinas/r/dias/d"); mock.back?.();
    expect(mock.navigate).toHaveBeenCalledWith(-1);
  });
  it("honors an internal source fallback and rejects an external source", () => {
    vi.stubGlobal("window", { history: { state: { idx: 0 } } });
    renderProbe("/entrenar", { section: "/progreso", returnTo: "/progreso?fecha=2026-10-01" });
    mock.back?.();
    expect(mock.navigate).toHaveBeenCalledWith("/progreso?fecha=2026-10-01", { replace: true });
    mock.navigate.mockClear();
    renderProbe("/entrenar", { returnTo: "https://evil.test" }); mock.back?.();
    expect(mock.navigate).toHaveBeenCalledWith("/", { replace: true });
  });
});
