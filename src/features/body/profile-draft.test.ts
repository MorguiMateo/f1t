import { describe, expect, it } from "vitest";
import { resolveProfileDraft } from "./profile-draft";

describe("profile drafts and acknowledgements", () => {
  const local = { raw: "81,5", acknowledged: "80" };
  it("does not replace newer typing with an older successful acknowledgement", () => {
    expect(resolveProfileDraft("81", local, { value: 81, status: "saved" }, 81.5)).toEqual({ raw: "81,5", status: "Sin guardar" });
  });
  it("retains an invalid draft instead of reverting to stored data", () => {
    expect(resolveProfileDraft("80", { ...local, raw: "900" }, { value: 80, status: "saved" }, undefined)).toEqual({ raw: "900", status: "Sin guardar" });
  });
  it("shows saving only for the submitted value, not newer typing", () => {
    expect(resolveProfileDraft("80", local, { value: 81.5, status: "pending" }, 81.5).status).toBe("Guardando…");
    expect(resolveProfileDraft("80", local, { value: 81, status: "pending" }, 81.5).status).toBe("Sin guardar");
  });
  it("preserves failed drafts through refetch and permits explicit retry", () => {
    expect(resolveProfileDraft("80", local, { value: 81.5, status: "failed" }, 81.5)).toEqual({ raw: "81,5", status: "Sin guardar" });
  });
  it("lets an acknowledged field follow a later remote update without calling it unsaved", () => {
    expect(resolveProfileDraft("82", local, { value: 81.5, status: "saved" }, 81.5)).toEqual({ raw: "82", status: "Guardado" });
  });
  it("distinguishes explicit clearing from invalid input", () => {
    expect(resolveProfileDraft("", { raw: "", acknowledged: "80" }, { value: null, status: "saved" }, null).status).toBe("Guardado");
  });
});
