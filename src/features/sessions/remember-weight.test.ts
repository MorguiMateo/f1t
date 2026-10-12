import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rememberRoutineExerciseWeight: vi.fn() }));

vi.mock("../routines/api", () => mocks);

import { rememberLoggedWeight } from "./remember-weight";

beforeEach(() => { mocks.rememberRoutineExerciseWeight.mockReset(); });

describe("rememberLoggedWeight", () => {
  it("stores the first logged weight when the routine has none", async () => {
    mocks.rememberRoutineExerciseWeight.mockResolvedValue(true);
    await expect(
      rememberLoggedWeight({
        routineExercise: { id: "re-1", targetWeightKg: null },
        weightKg: 62.5,
      }),
    ).resolves.toBe(true);
    expect(mocks.rememberRoutineExerciseWeight).toHaveBeenCalledExactlyOnceWith("re-1", 62.5);
  });

  it("learns zero, but preserves an explicit default", async () => {
    mocks.rememberRoutineExerciseWeight.mockResolvedValue(true);
    await rememberLoggedWeight({ routineExercise: { id: "re-1", targetWeightKg: null }, weightKg: 0 });
    expect(mocks.rememberRoutineExerciseWeight).toHaveBeenCalledWith("re-1", 0);
    mocks.rememberRoutineExerciseWeight.mockClear();
    await rememberLoggedWeight({ routineExercise: { id: "re-1", targetWeightKg: 60 }, weightKg: 70 });
    expect(mocks.rememberRoutineExerciseWeight).not.toHaveBeenCalled();
  });

  it("writes nothing when the weight is unchanged, empty or there is no routine row", async () => {
    await expect(
      rememberLoggedWeight({
        routineExercise: { id: "re-1", targetWeightKg: 60 },
        weightKg: 60,
      }),
    ).resolves.toBe(false);
    await expect(
      rememberLoggedWeight({
        routineExercise: { id: "re-1", targetWeightKg: 60 },
        weightKg: null,
      }),
    ).resolves.toBe(false);
    await expect(
      rememberLoggedWeight({ routineExercise: null, weightKg: 50 }),
    ).resolves.toBe(false);
    expect(mocks.rememberRoutineExerciseWeight).not.toHaveBeenCalled();
  });

  it("reports a default failure independently of the saved set", async () => {
    mocks.rememberRoutineExerciseWeight.mockRejectedValue(new Error("network"));
    await expect(
      rememberLoggedWeight({
        routineExercise: { id: "re-1", targetWeightKg: null },
        weightKg: 40,
      }),
    ).rejects.toMatchObject({ message: "network" });
  });
});
