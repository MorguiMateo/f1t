import { describe, expect, it } from "vitest";
import { formatDelta, formatKg, latestWeight, withDeltas } from "./weight";

const entry = (measured_on: string, weight_kg: number) => ({
  measured_on,
  weight_kg,
});

describe("withDeltas", () => {
  it("subtracts the previous (older) measurement", () => {
    const rows = withDeltas([
      entry("2026-09-22", 80.5),
      entry("2026-09-20", 81.0),
    ]);
    expect(rows[0].delta).toBe(-0.5);
  });

  it("leaves the oldest entry without a delta", () => {
    const rows = withDeltas([entry("2026-09-20", 81.0)]);
    expect(rows[0].delta).toBeNull();
  });

  it("rounds away floating-point tails", () => {
    const rows = withDeltas([
      entry("2026-09-22", 81.3),
      entry("2026-09-20", 80.9),
    ]);
    expect(rows[0].delta).toBe(0.4);
  });

  it("has nothing to pair on an empty series", () => {
    expect(withDeltas([])).toEqual([]);
  });
});

describe("latestWeight", () => {
  it("is the newest measurement", () => {
    expect(
      latestWeight([entry("2026-09-22", 80.5), entry("2026-09-20", 81.0)]),
    ).toBe(80.5);
  });

  it("is null before there is one", () => {
    expect(latestWeight([])).toBeNull();
  });
});

describe("formatKg", () => {
  it("drops a trailing zero but keeps a real decimal", () => {
    expect(formatKg(81)).toBe("81");
    expect(formatKg(81.5)).toBe("81,5");
  });
});

describe("formatDelta", () => {
  it("signs the change and uses a real minus sign", () => {
    expect(formatDelta(0.4)).toBe("+0,4");
    expect(formatDelta(-0.5)).toBe("−0,5");
    expect(formatDelta(0)).toBe("±0");
  });
});
