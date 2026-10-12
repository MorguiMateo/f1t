import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthQueryClient, setAuthQueryIdentity } from "../auth/auth-query-client";

const mocks = vi.hoisted(() => ({ ensureSession: vi.fn(), logSet: vi.fn(), rememberLoggedWeight: vi.fn() }));
vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), ...mocks }));
vi.mock("./remember-weight", () => ({ rememberLoggedWeight: mocks.rememberLoggedWeight }));
vi.mock("../../lib/supabase", () => ({ supabase: {} }));

import { logWorkoutSet, type LogSetInput } from "./queries";
import { routineKeys } from "../routines/queries";

const input: LogSetInput = {
  sessionId: "session", performedOn: "2026-10-07", routineDayId: "day", exerciseId: "bench",
  setIndex: 0, reps: 8, weightKg: 62.5, routineExercise: { id: "row", targetWeightKg: null },
};
const saved = { id: "set", session_id: "session", user_id: "a", exercise_id: "bench", set_index: 0, reps: 8, weight_kg: 62.5 };

beforeEach(() => {
  vi.resetAllMocks(); setAuthQueryIdentity("a");
  mocks.logSet.mockResolvedValue(saved);
  mocks.rememberLoggedWeight.mockResolvedValue(true);
});

describe("saved set and learned default", () => {
  it("learns the actual stored weight and invalidates routine views", async () => {
    const client = createAuthQueryClient(); client.setQueryData(routineKeys.active(), {});
    await expect(logWorkoutSet(client, input)).resolves.toEqual(saved);
    expect(mocks.rememberLoggedWeight).toHaveBeenCalledWith({ routineExercise: input.routineExercise, weightKg: saved.weight_kg });
    expect(client.getQueryState(routineKeys.active())?.isInvalidated).toBe(true);
  });
  it("keeps the set successful but explicitly warns when the default fails", async () => {
    mocks.rememberLoggedWeight.mockRejectedValue(new Error("offline"));
    const result = await logWorkoutSet(createAuthQueryClient(), input);
    expect(result.id).toBe(saved.id);
    expect(result.defaultWeightError).toContain("La serie se guardó");
  });
  it("never starts a routine write under a replacement account after a set response", async () => {
    mocks.logSet.mockImplementation(async () => { setAuthQueryIdentity("b"); return saved; });
    await logWorkoutSet(createAuthQueryClient(), input);
    expect(mocks.rememberLoggedWeight).not.toHaveBeenCalled();
  });
  it("never starts a set write under a replacement account after session creation", async () => {
    mocks.ensureSession.mockImplementation(async () => { setAuthQueryIdentity("b"); return { id: "session" }; });
    await expect(logWorkoutSet(createAuthQueryClient(), { ...input, sessionId: null })).rejects.toThrow("La sesión cambió");
    expect(mocks.logSet).not.toHaveBeenCalled();
    expect(mocks.rememberLoggedWeight).not.toHaveBeenCalled();
  });
});
