import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: mocks }));
import { moveRoutineDay } from "./api";
beforeEach(() => mocks.from.mockReset());
const input = { dayId: "day", routineId: "routine", fromWeekday: 1, weekday: 3 };
describe("move a routine day without recreating its identity", () => {
  function chain(result: unknown) {
    const update = vi.fn().mockReturnThis(), eq = vi.fn().mockReturnThis();
    const query = { update, eq, select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue(result) };
    mocks.from.mockReturnValue(query);
    return query;
  }
  it("uses a conditional update, retaining the day ID and all exercise/history links", async () => {
    const row = { id: "day", routine_id: "routine", weekday: 3 };
    const query = chain({ data: row, error: null });
    await expect(moveRoutineDay(input)).resolves.toEqual(row);
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("routine_days");
    expect(query.update).toHaveBeenCalledExactlyOnceWith({ weekday: 3 });
    expect(query.eq.mock.calls).toEqual([["id", "day"], ["routine_id", "routine"], ["weekday", 1]]);
  });
  it("does not report a stale or unauthorized zero-row update as saved", async () => {
    chain({ data: null, error: null });
    await expect(moveRoutineDay(input)).rejects.toThrow("La base no devolvió la fila escrita.");
  });
  it("propagates an occupied-weekday conflict without deleting or replacing anything", async () => {
    chain({ data: null, error: { code: "23505", message: "routine_days_unique_weekday" } });
    await expect(moveRoutineDay(input)).rejects.toThrow("routine_days_unique_weekday");
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid weekdays before touching the database", async () => {
    await expect(moveRoutineDay({ ...input, weekday: 7 })).rejects.toThrow();
    await expect(moveRoutineDay({ ...input, fromWeekday: 1.5 })).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
