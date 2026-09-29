import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImageLightbox } from "./image-lightbox";

describe("ImageLightbox", () => {
  it("renders a native named modal with an explicit close control", () => {
    const html = renderToStaticMarkup(
      <ImageLightbox src="/exercise.webp" alt="Sentadilla: inicio" onClose={() => {}} />,
    );
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-label="Sentadilla: inicio"');
    expect(html).toContain('aria-label="Cerrar"');
    expect(html).toContain('src="/exercise.webp"');
  });
});
