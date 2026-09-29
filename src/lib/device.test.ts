import { afterEach, describe, expect, it, vi } from "vitest";
import { device, setWidgetDebugIdentity, type WidgetPayload } from "./device";

const DEBUG_KEY = "f1t:widget-payload";
const payload: WidgetPayload = {
  levels: [1, 2],
  todayLabel: "Empuje",
  todayExercises: [{ name: "Press", detail: "3 × 8" }],
  streak: 2,
};

function stubStorage() {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  });
  return entries;
}

afterEach(() => vi.unstubAllGlobals());

describe("web widget debug payload", () => {
  it("clears a legacy or previous-account payload on identity change and sign-out", async () => {
    const storage = stubStorage();
    storage.set(DEBUG_KEY, JSON.stringify(payload));
    setWidgetDebugIdentity("widget-user-a");
    expect(storage.has(DEBUG_KEY)).toBe(false);

    await device.syncWidget(payload, "widget-user-a");
    expect(storage.get(DEBUG_KEY)).toBe(JSON.stringify(payload));

    setWidgetDebugIdentity("widget-user-b");
    expect(storage.has(DEBUG_KEY)).toBe(false);
    await device.syncWidget(payload, "widget-user-b");
    setWidgetDebugIdentity(null);
    expect(storage.has(DEBUG_KEY)).toBe(false);
  });

  it("rejects an old owner's sync scheduled after the account changed", async () => {
    const storage = stubStorage();
    setWidgetDebugIdentity("widget-user-c");
    const lateSync = Promise.resolve().then(() =>
      device.syncWidget(payload, "widget-user-c"),
    );
    setWidgetDebugIdentity("widget-user-d");
    await lateSync;
    expect(storage.has(DEBUG_KEY)).toBe(false);

    await device.syncWidget(payload, "widget-user-d");
    expect(storage.get(DEBUG_KEY)).toBe(JSON.stringify(payload));
    setWidgetDebugIdentity(null);
  });
});
