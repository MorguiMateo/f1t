import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: mocks,
}));

import {
  activateRoutine,
  addExerciseToDay,
  swapExercisePositions,
} from "./api";

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.from.mockReset();
});

describe("transactional routine operations", () => {
  it("activates with one RPC and propagates its error", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: undefined, error: null });
    await activateRoutine("routine-1");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("activate_routine", {
      p_routine_id: "routine-1",
    });
    expect(mocks.from).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0002", message: "Routine not found for this user." },
    });
    await expect(activateRoutine("stale-id")).rejects.toThrow(
      "Routine not found for this user.",
    );
  });

  it("swaps the expected positions with one RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: undefined, error: null });
    await swapExercisePositions({
      a: { id: "first", position: 2 },
      b: { id: "second", position: 3 },
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "swap_routine_exercise_positions",
      {
        p_a_id: "first",
        p_a_position: 2,
        p_b_id: "second",
        p_b_position: 3,
      },
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("duplicate exercise add", () => {
  it("gives the picker a useful error for the new day/exercise constraint", async () => {
    const last = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { position: 1 }, error: null }),
    };
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "routine_exercises_day_exercise_key"',
      },
    });
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    });
    mocks.from.mockReturnValueOnce(last).mockReturnValueOnce({ insert });

    await expect(
      addExerciseToDay({ dayId: "day-1", exerciseId: "bench" }),
    ).rejects.toThrow("Este ejercicio ya está agregado a este día.");
    expect(insert).toHaveBeenCalledWith({
      routine_day_id: "day-1",
      exercise_id: "bench",
      position: 2,
    });
  });
});
