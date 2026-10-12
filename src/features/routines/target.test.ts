import { describe, expect, it } from "vitest";
import { parseTargetWeight, weightLabel } from "./target";

describe("parseTargetWeight", () => {
  it("an empty field means no weight chosen, not zero", () => {
    expect(parseTargetWeight("")).toBeNull();
    expect(parseTargetWeight("   ")).toBeNull();
  });

  it("keeps 0 as a real weight", () => {
    expect(parseTargetWeight("0")).toBe(0);
    expect(parseTargetWeight("0,0")).toBe(0);
  });

  it("accepts integers and decimals with a comma or a dot", () => {
    expect(parseTargetWeight("60")).toBe(60);
    expect(parseTargetWeight("82,5")).toBe(82.5);
    expect(parseTargetWeight("82.5")).toBe(82.5);
    expect(parseTargetWeight(".5")).toBe(0.5);
    expect(parseTargetWeight("12,")).toBe(12);
  });

  it("rounds to two decimals and clamps to the column range", () => {
    expect(parseTargetWeight("1,239")).toBe(1.24);
    expect(parseTargetWeight("99999")).toBe(9999.99);
  });

  it("flags invalid text so a typo never clears the saved weight", () => {
    for (const raw of ["abc", "-5", "1e3", "0x10", "1,2,3", "5kg", "Infinity"]) {
      expect(parseTargetWeight(raw)).toBeUndefined();
    }
  });
});

describe("weightLabel", () => {
  it("formats with a decimal comma", () => {
    expect(weightLabel(82.5)).toBe("82,5 kg");
    expect(weightLabel(60)).toBe("60 kg");
  });

  it("shows 0 kg but nothing for no weight", () => {
    expect(weightLabel(0)).toBe("0 kg");
    expect(weightLabel(null)).toBeNull();
    expect(weightLabel(undefined)).toBeNull();
  });
});
