import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorNote } from "./status";

describe("ErrorNote", () => {
  it("uses an operation-neutral default and accepts a contextual title", () => {
    expect(renderToStaticMarkup(<ErrorNote error={new Error("offline")} />))
      .toContain("No se pudo completar la operación");
    expect(renderToStaticMarkup(<ErrorNote error="offline" title="No se pudo guardar" />))
      .toContain("No se pudo guardar");
  });
});
