import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorNote } from "./status";

describe("ErrorNote", () => {
  it("offers a Spanish recovery message with raw server detail collapsed", () => {
    const html = renderToStaticMarkup(<ErrorNote error={{ message: "JWT expired" }} />);
    expect(html).toContain("Volvé a iniciar sesión con Google");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Detalle técnico");
    expect(html).toContain("JWT expired");
    expect(html).not.toContain("[object Object]");
  });
  it("preserves actionable Spanish product validation without duplicate technical detail", () => {
    const html = renderToStaticMarkup(<ErrorNote error="Elegí una fecha válida." />);
    expect(html).toContain("Elegí una fecha válida.");
    expect(html).not.toContain("<details");
  });
  it("uses an operation-neutral default and accepts a contextual title", () => {
    expect(renderToStaticMarkup(<ErrorNote error={new Error("offline")} />))
      .toContain("No se pudo completar la operación");
    expect(renderToStaticMarkup(<ErrorNote error="offline" title="No se pudo guardar" />))
      .toContain("No se pudo guardar");
  });
});
