import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));

import { invalidateSessionViews, sessionKeys } from "./queries";

function seededClient() {
  const client = new QueryClient();
  const keys = {
    days: sessionKeys.days("2026-01-01"),
    date: sessionKeys.onDate("2026-09-29"),
    previous: sessionKeys.previous("day-1", "2026-09-29"),
  };
  for (const key of Object.values(keys)) client.setQueryData(key, []);
  return { client, keys };
}

describe("session invalidation", () => {
  it("set writes invalidate current views without refetching previous workouts", async () => {
    const { client, keys } = seededClient();
    await invalidateSessionViews(client);
    expect(client.getQueryState(keys.days)?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.date)?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.previous)?.isInvalidated).toBe(false);
    client.clear();
  });

  it("session deletion also invalidates historical suggestions", async () => {
    const { client, keys } = seededClient();
    await invalidateSessionViews(client, true);
    expect(client.getQueryState(keys.days)?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.date)?.isInvalidated).toBe(true);
    expect(client.getQueryState(keys.previous)?.isInvalidated).toBe(true);
    client.clear();
  });
});
