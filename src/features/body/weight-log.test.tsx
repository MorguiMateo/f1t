import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WeightLog } from "./weight-log";

vi.mock("./queries", () => ({
  useWeightEntries: () => ({
    data: [{ id: "weight-1", measured_on: "2026-09-28", weight_kg: 80 }],
    isPending: false,
    error: null,
  }),
  useSaveWeight: () => ({ isPending: false, error: new Error("offline"), mutate: vi.fn() }),
  useDeleteWeight: () => ({ isPending: false, error: new Error("offline"), mutate: vi.fn() }),
}));

describe("WeightLog write errors", () => {
  it("shows save and delete failures while leaving the entry form available", () => {
    const html = renderToStaticMarkup(<WeightLog />);
    expect(html).toContain("No se guardó el peso");
    expect(html).toContain("No se borró el peso");
    expect(html).toContain("Anotar");
  });
});
