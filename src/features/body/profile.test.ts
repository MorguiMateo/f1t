import { describe, expect, it } from "vitest";
import {
  ageOn,
  HEIGHT_RANGE,
  isGoal,
  parseBirthDate,
  parseMeasure,
  toGoal,
  toSex,
  WEIGHT_RANGE,
} from "./profile";

const NOW = new Date(2026, 8, 22); // 2026-09-22, local time.

describe("parseMeasure", () => {
  it("rounds to the decimals the column holds", () => {
    expect(parseMeasure("178.6", HEIGHT_RANGE)).toBe(179);
    expect(parseMeasure("81.34", WEIGHT_RANGE)).toBe(81.3);
  });

  it("clamps instead of letting the database bounce the write", () => {
    expect(parseMeasure("9", HEIGHT_RANGE)).toBe(HEIGHT_RANGE.min);
    expect(parseMeasure("900", HEIGHT_RANGE)).toBe(HEIGHT_RANGE.max);
  });

  it("reads a comma as a decimal separator", () => {
    // Spanish keyboards put the comma under the thumb on the numeric pad.
    expect(parseMeasure("81,5", WEIGHT_RANGE)).toBe(81.5);
  });

  it("treats an empty field as cleared, not as invalid", () => {
    expect(parseMeasure("", HEIGHT_RANGE)).toBeNull();
    expect(parseMeasure("   ", HEIGHT_RANGE)).toBeNull();
  });

  it("returns undefined for text that isn't a number", () => {
    expect(parseMeasure("alto", HEIGHT_RANGE)).toBeUndefined();
    expect(parseMeasure("1.7.8", HEIGHT_RANGE)).toBeUndefined();
  });
});

describe("parseBirthDate", () => {
  it("accepts a date the column can store", () => {
    expect(parseBirthDate("1992-03-14", NOW)).toBe("1992-03-14");
  });

  it("accepts today", () => {
    expect(parseBirthDate("2026-09-22", NOW)).toBe("2026-09-22");
  });

  it("rejects the future rather than clamping it to today", () => {
    expect(parseBirthDate("2026-09-23", NOW)).toBeUndefined();
  });

  it("rejects what the check constraint would reject", () => {
    expect(parseBirthDate("1899-12-31", NOW)).toBeUndefined();
  });

  it("rejects anything that isn't YYYY-MM-DD", () => {
    expect(parseBirthDate("14/03/1992", NOW)).toBeUndefined();
  });

  it("treats an empty field as cleared", () => {
    expect(parseBirthDate("", NOW)).toBeNull();
  });
});

describe("ageOn", () => {
  it("counts completed years", () => {
    expect(ageOn("1992-03-14", NOW)).toBe(34);
  });

  it("does not count a birthday that hasn't arrived this year", () => {
    expect(ageOn("1992-12-01", NOW)).toBe(33);
  });

  it("counts the birthday itself", () => {
    expect(ageOn("1992-09-22", NOW)).toBe(34);
  });

  it("does not count the day before the birthday", () => {
    expect(ageOn("1992-09-23", NOW)).toBe(33);
  });

  it("lands on the right day across a leap year", () => {
    // Dividing milliseconds by 365.25 days gets this one wrong.
    expect(ageOn("2000-02-29", new Date(2026, 1, 28))).toBe(25);
    expect(ageOn("2000-02-29", new Date(2026, 2, 1))).toBe(26);
  });

  it("has nothing to say without a date", () => {
    expect(ageOn(null, NOW)).toBeNull();
  });
});

describe("the database columns are text", () => {
  it("falls back to the column default instead of casting", () => {
    expect(toGoal("lose")).toBe("lose");
    expect(toGoal("adelgazar")).toBe("maintain");
    expect(toGoal(null)).toBe("maintain");
  });

  it("leaves an unknown sex unset, because the equation has no coefficient", () => {
    expect(toSex("female")).toBe("female");
    expect(toSex("otro")).toBeNull();
    expect(toSex(null)).toBeNull();
  });

  it("guards narrow the type", () => {
    expect(isGoal("gain")).toBe(true);
    expect(isGoal("ganar")).toBe(false);
  });
});
