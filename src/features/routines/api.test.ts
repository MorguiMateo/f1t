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
  updateRoutineExercise,
  rememberRoutineExerciseWeight,
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

describe("routine exercise weight update", () => {
  function updateChain(result: unknown) {
    const eq = vi.fn().mockReturnThis();
    const chain = { eq, select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue(result) };
    const update = vi.fn().mockReturnValue(chain);
    mocks.from.mockReturnValueOnce({ update });
    return { update, eq };
  }

  it("updates only the given row and sends 0 and null as they are", async () => {
    const zero = updateChain({ data: { id: "re-1" }, error: null });
    await updateRoutineExercise({ id: "re-1", patch: { target_weight_kg: 0 } });
    expect(mocks.from).toHaveBeenCalledWith("routine_exercises");
    expect(zero.update).toHaveBeenCalledWith({ target_weight_kg: 0 });
    expect(zero.eq).toHaveBeenCalledWith("id", "re-1");

    const cleared = updateChain({ data: { id: "re-1" }, error: null });
    await updateRoutineExercise({ id: "re-1", patch: { target_weight_kg: null } });
    expect(cleared.update).toHaveBeenCalledWith({ target_weight_kg: null });
  });

  it("propagates database errors", async () => {
    updateChain({ data: null, error: { code: "23514", message: "check violation" } });
    await expect(
      updateRoutineExercise({ id: "re-1", patch: { target_weight_kg: 1 } }),
    ).rejects.toThrow("check violation");
  });
});

describe("first-weight learning", () => {
  it("uses an atomic null filter so a concurrently edited default cannot be overwritten", async () => {
    const chain = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "re-1" }, error: null }) };
    mocks.from.mockReturnValue(chain);
    await expect(rememberRoutineExerciseWeight("re-1", 0)).resolves.toBe(true);
    expect(chain.update).toHaveBeenCalledWith({ target_weight_kg: 0 });
    expect(chain.eq).toHaveBeenCalledWith("id", "re-1");
    expect(chain.is).toHaveBeenCalledWith("target_weight_kg", null);
  });
  it("rejects a routine edit when no owned row was returned", async () => {
    const chain = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: null }) };
    mocks.from.mockReturnValue(chain);
    await expect(updateRoutineExercise({ id: "missing", patch: { target_weight_kg: 50 } })).rejects.toThrow("La base no devolvió la fila escrita.");
  });
  it("confirms a concurrently saved default instead of replacing it", async () => {
    const chain = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: { target_weight_kg: 0 }, error: null }) };
    mocks.from.mockReturnValue(chain);
    await expect(rememberRoutineExerciseWeight("re-1", 50)).resolves.toBe(false);
    expect(chain.update).toHaveBeenCalledTimes(1);
  });
  it("does not report a removed or unauthorized row as remembered", async () => {
    const chain = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    mocks.from.mockReturnValue(chain);
    await expect(rememberRoutineExerciseWeight("missing", 50)).rejects.toThrow("La base no devolvió la fila escrita.");
  });
});
