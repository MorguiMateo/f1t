import { beforeEach, describe, expect, it } from "vitest";
import { readOAuthDestination, rememberOAuthDestination, takeOAuthDestination } from "./oauth-destination";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
beforeEach(() => values.clear());

describe("OAuth return destination", () => {
  it("restores the full deep link and query once without storing credentials", () => {
    const destination = "/entrenar?dia=day-1&fecha=2026-10-01";
    rememberOAuthDestination(destination, storage, 1000);
    expect(readOAuthDestination(storage, 2000)).toBe(destination);
    expect(takeOAuthDestination(storage, 2000)).toBe(destination);
    expect(takeOAuthDestination(storage, 2000)).toBeNull();
  });
  it.each(["//evil.test", "https://evil.test", "/?code=secret", "/perfil#refresh_token=secret"])("replaces an unsafe return request with Hoy: %s", (path) => {
    expect(rememberOAuthDestination(path, storage, 1000)).toBe("/");
    expect(takeOAuthDestination(storage, 2000)).toBe("/");
  });
  it("rejects expired, future, malformed and tampered destinations", () => {
    rememberOAuthDestination("/progreso", storage, 1000);
    expect(readOAuthDestination(storage, 1000 + 16 * 60_000)).toBeNull();
    expect(values.size).toBe(0);
    rememberOAuthDestination("/progreso", storage, 2000);
    expect(readOAuthDestination(storage, 1000)).toBeNull();
    rememberOAuthDestination("/progreso", storage, 1000);
    const key = [...values.keys()][0];
    values.set(key, JSON.stringify({ path: "//evil.test", createdAt: 1000 }));
    expect(takeOAuthDestination(storage, 2000)).toBeNull();
    values.set(key, "not JSON");
    expect(takeOAuthDestination(storage, 2000)).toBeNull();
  });
  it("does not block session restoration when browser storage is unavailable", () => {
    const blocked = { getItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    expect(takeOAuthDestination(blocked)).toBeNull();
  });
});
