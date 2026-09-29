import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WeightEntry } from "./weight";

const { builder, from, limit } = vi.hoisted(() => {
  const limit = vi.fn();
  const builder = {
    select: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit,
  };
  const from = vi.fn().mockReturnValue(builder);
  return { builder, from, limit };
});

vi.mock("../../lib/supabase", () => ({ supabase: { from } }));

import { fetchWeightEntries, WEIGHT_PAGE_SIZE } from "./weight-api";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchWeightEntries", () => {
  it("reads every page in deterministic newest-first order", async () => {
    const entries: WeightEntry[] = Array.from({ length: WEIGHT_PAGE_SIZE * 2 + 1 }, (_, i) => ({
      id: String(i),
      user_id: "user-1",
      measured_on: new Date(Date.UTC(2026, 8, 29 - i)).toISOString().slice(0, 10),
      weight_kg: 80,
    }));
    let cursor: string | null = null;
    builder.lt.mockImplementation((_column: string, before: string) => {
      cursor = before;
      return builder;
    });
    limit.mockImplementation(async (size: number) => ({
      data: entries.filter((entry) => !cursor || entry.measured_on < cursor).slice(0, size),
      error: null,
    }));

    expect(await fetchWeightEntries()).toEqual(entries);
    expect(limit.mock.calls).toEqual([
      [WEIGHT_PAGE_SIZE],
      [WEIGHT_PAGE_SIZE],
      [WEIGHT_PAGE_SIZE],
    ]);
    expect(builder.lt.mock.calls).toEqual([
      ["measured_on", entries[WEIGHT_PAGE_SIZE - 1].measured_on],
      ["measured_on", entries[WEIGHT_PAGE_SIZE * 2 - 1].measured_on],
    ]);
    expect(builder.order.mock.calls).toEqual([
      ["measured_on", { ascending: false }],
      ["id", { ascending: false }],
      ["measured_on", { ascending: false }],
      ["id", { ascending: false }],
      ["measured_on", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(from).toHaveBeenCalledWith("weight_entries");
  });

  it("rejects a failed later page instead of exposing partial history", async () => {
    limit
      .mockResolvedValueOnce({
        data: Array.from({ length: WEIGHT_PAGE_SIZE }, (_, i) => ({ id: String(i) })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "page failed", code: "500", details: "", hint: "" },
      });

    await expect(fetchWeightEntries()).rejects.toThrow("page failed");
  });
});
