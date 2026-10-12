import { describe, expect, it } from "vitest";
import { prepareWeightSubmission } from "./weight-submission";
import type { WeightEntry } from "./weight";
const entry: WeightEntry = { id: "w1", user_id: "owner", measured_on: "2026-10-09", weight_kg: 80 };
const today = "2026-10-10";

describe("weight submission", () => {
  it.each(["", "900", "19", "400.1", "-80", "1e2", "81,34", "peso"])("does not prepare a write for invalid input %s", (raw) => {
    expect(prepareWeightSubmission(raw, today, [], today).status).toBe("invalid");
  });
  it.each(["2026-10-11", "2026-02-30", "", "09/10/2026"])("rejects an invalid or future date %s", (date) => {
    expect(prepareWeightSubmission("81,5", date, [], today).status).toBe("invalid");
  });
  it("identifies the exact original measurement that must be confirmed", () => {
    expect(prepareWeightSubmission("81,5", entry.measured_on, [entry], today)).toEqual({ status: "ready", measuredOn: entry.measured_on, weightKg: 81.5, previous: entry });
  });
  it("does not rewrite an unchanged measurement", () => {
    expect(prepareWeightSubmission("80,0", entry.measured_on, [entry], today)).toEqual({ status: "unchanged" });
  });
  it("prepares a new day with the exact accepted value", () => {
    expect(prepareWeightSubmission("81,5", today, [entry], today)).toEqual({ status: "ready", measuredOn: today, weightKg: 81.5, previous: null });
  });
});
