import { describe, expect, it } from "vitest";
import { chartSampleCount, hasWeightGaps } from "./weight-context";

describe("weight chart evidence", () => {
  it("counts measurements in the seven calendar days ending at a point, not the seven latest entries", () => {
    const entries = ["2026-09-30", "2026-10-01", "2026-10-07", "2026-10-08"].map((measured_on) => ({ measured_on, weight_kg: 80 }));
    expect(chartSampleCount(entries, "2026-10-07")).toBe(2);
    expect(chartSampleCount(entries, "2026-10-01")).toBe(2);
  });
  it("distinguishes a seven-day interval from an unmeasured gap", () => {
    expect(hasWeightGaps(["2026-10-08", "2026-10-01"])).toBe(false);
    expect(hasWeightGaps(["2026-10-09", "2026-10-01"])).toBe(true);
    expect(hasWeightGaps(["2026-10-09"])).toBe(false);
  });
});
