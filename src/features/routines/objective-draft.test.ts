import { describe, expect, it } from "vitest";
import { validateObjectiveDraft } from "./objective-draft";

const draft = { sets: "3", reps: "8–12", weight: "82,5", notes: "  Sin rebote  " };
describe("explicit objective drafts", () => {
  it("validates one complete patch and preserves decimal comma, ranges and notes", () => {
    expect(validateObjectiveDraft(draft)).toEqual({ target_sets: 3, target_reps: "8–12", target_weight_kg: 82.5, notes: "Sin rebote" });
  });
  it("distinguishes empty goals from a real zero load", () => {
    expect(validateObjectiveDraft({ sets: "", reps: "", weight: "", notes: "" })).toEqual({ target_sets: null, target_reps: null, target_weight_kg: null, notes: null });
    expect(validateObjectiveDraft({ ...draft, weight: "0" }).target_weight_kg).toBe(0);
  });
  it.each(["0", "51", "1.5", "-2", "1e1", "abc"])("does not round or clamp invalid sets %s", (sets) => {
    expect(() => validateObjectiveDraft({ ...draft, sets })).toThrow();
  });
  it.each(["99999", "1,239", "-5", "5kg", "1e3"])("does not round, clamp or clear invalid weight %s", (weight) => {
    expect(() => validateObjectiveDraft({ ...draft, weight })).toThrow();
  });
  it.each(["12–8", "0", "0 s", "8-0", "8-12-15", "1.5", "-30 s"])("rejects malformed or descending rep targets %s", (reps) => {
    expect(() => validateObjectiveDraft({ ...draft, reps })).toThrow();
  });
  it.each(["30 s", "al fallo", "8-12 reps", "1,5 min"])("retains duration and free text %s", (reps) => {
    expect(validateObjectiveDraft({ ...draft, reps }).target_reps).toBe(reps);
  });
});
